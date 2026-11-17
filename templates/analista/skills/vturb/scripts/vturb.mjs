// VTurb Analytics API (https://docs.vturb.com/en/docs/reference/analytics): retenção, pitch, play rate e conversão.
// Chave em VTURB_API_KEY (Conectores → VTurb no Claude Flow). Só leitura.
//
//   node vturb.mjs players [--nome texto]                       lista os players (id, nome, duração, pitch)
//   node vturb.mjs relatorio --player <id|nome> --de AAAA-MM-DD [--ate AAAA-MM-DD] [--pitch segundos]
//        → views, plays, play rate, engajamento, retenção no 1º minuto, retenção no pitch, cliques, conversões,
//          taxa de conversão e faturamento (R$) no período (fuso America/Sao_Paulo)
//   node vturb.mjs dias --player <id|nome> --de … --ate …      os mesmos números dia a dia (sem somar taxas)
//   node vturb.mjs cota                                         uso da cota da API
const BASE = 'https://analytics.vturb.com';
const FUSO = 'America/Sao_Paulo';
const KEY = process.env.VTURB_API_KEY;

function args(argv) {
  const pos = [], o = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) { const v = argv[i + 1]; if (v === undefined || v.startsWith('--')) o[argv[i].slice(2)] = true; else { o[argv[i].slice(2)] = v; i++; } }
    else pos.push(argv[i]);
  }
  return { pos, o };
}

async function api(metodo, caminho, corpo, tentativa = 0) {
  if (!KEY) throw new Error('falta a chave da VTurb: Conectores → VTurb no Claude Flow (VTURB_API_KEY)');
  const r = await fetch(BASE + caminho, {
    method: metodo,
    headers: { 'X-Api-Token': KEY, 'X-Api-Version': 'v1', 'User-Agent': 'claude-flow-analista/1.0', ...(corpo ? { 'Content-Type': 'application/json' } : {}) },
    body: corpo ? JSON.stringify(corpo) : undefined,
    signal: AbortSignal.timeout(70000),
  });
  if ((r.status === 429 || r.status === 503) && tentativa < 4) {
    const j = await r.json().catch(() => ({}));
    const espera = j?.details?.resets_at ? Math.max(1000, new Date(j.details.resets_at) - Date.now()) : 1500 * 2 ** tentativa;
    await new Promise((ok) => setTimeout(ok, Math.min(espera, 60000)));
    return api(metodo, caminho, corpo, tentativa + 1);
  }
  const txt = await r.text();
  let j; try { j = JSON.parse(txt); } catch { j = txt; }
  if (!r.ok) {
    const cod = j?.code ? ` (código ${j.code})` : '';
    const dica = { 401: 'chave inválida, sem assinatura ativa ou plano sem acesso à API', 403: 'a chave não pode ler esses dados (ou falta User-Agent)', 404: 'rota não encontrada (versão da API?)', 504: 'consulta longa demais: diminua o período' }[r.status] || '';
    throw new Error(`VTurb ${caminho}: HTTP ${r.status}${cod}${dica ? ' — ' + dica : ''} ${typeof j === 'string' ? j.slice(0, 200) : JSON.stringify(j).slice(0, 300)}`);
  }
  return j;
}

const num = (x) => (x === null || x === undefined || x === '' ? null : Number(x));
const pct = (x) => (x === null || !Number.isFinite(x) ? null : Math.round(x * 100) / 100);
const periodo = (o) => {
  if (!o.de) throw new Error('faltou --de AAAA-MM-DD');
  return { start_date: `${o.de} 00:00:00`, end_date: `${o.ate || o.de} 23:59:59`, timezone: FUSO };
};

async function players(o = {}) {
  const q = new URLSearchParams();
  if (o.nome && String(o.nome).length >= 3) { q.set('name', o.nome); q.set('name_match', 'contains'); }
  const l = await api('GET', '/players/list' + (q.size ? '?' + q : ''));
  return (Array.isArray(l) ? l : l?.players || []).map((p) => ({ id: p.id, nome: p.name, duracao_s: p.duration, pitch_s: p.pitch_time, criado: p.created_at }));
}

async function acharPlayer(ref) {
  if (!ref) throw new Error('faltou --player <id ou parte do nome>');
  const todos = await players(String(ref).length >= 3 && !/^[a-f0-9]{20,}$/i.test(ref) ? { nome: ref } : {});
  const p = todos.find((x) => String(x.id) === String(ref)) || todos.find((x) => x.nome?.toLowerCase() === String(ref).toLowerCase()) || (todos.length === 1 ? todos[0] : null);
  if (!p) throw new Error(todos.length ? `mais de um player com "${ref}": ${todos.slice(0, 8).map((x) => `${x.nome} (${x.id})`).join('; ')}` : `nenhum player "${ref}"`);
  return p;
}

// retenção no segundo s: (total - quem saiu antes de s) / total. grouped_timed = onde cada sessão parou (baldes de 5 s)
function retencaoEm(curva, s) {
  const g = curva?.grouped_timed || [];
  const total = g.reduce((a, x) => a + (x.total_users || 0), 0);
  if (!total) return null;
  const sairam = g.filter((x) => x.timed < s).reduce((a, x) => a + (x.total_users || 0), 0);
  return pct(((total - sairam) / total) * 100);
}

async function relatorio(o) {
  const p = await acharPlayer(o.player);
  const per = periodo(o);
  const pitch = o.pitch ? Number(o.pitch) : p.pitch_s || 0;
  const st = await api('POST', '/sessions/stats', { player_id: p.id, ...per, ...(pitch ? { pitch_time: pitch } : {}), ...(p.duracao_s ? { video_duration: p.duracao_s } : {}) });
  let curva = null;
  try { curva = await api('POST', '/times/user_engagement', { player_id: p.id, video_duration: p.duracao_s || 0, ...per }); } catch (e) { curva = { erro: e.message }; }
  const r1min = curva?.erro ? null : retencaoEm(curva, 60);
  const rPitchCurva = curva?.erro || !pitch ? null : retencaoEm(curva, pitch);
  return {
    player: p.nome, player_id: p.id, periodo: `${per.start_date.slice(0, 10)} a ${per.end_date.slice(0, 10)}`, duracao_s: p.duracao_s, pitch_s: pitch || null,
    views: num(st.total_viewed_device_uniq), plays: num(st.total_started_device_uniq), play_rate: pct(num(st.play_rate)),
    engajamento_medio: pct(num(st.engagement_rate)),
    retencao_1min: r1min,
    retencao_pitch: pitch ? pct(num(st.over_pitch_rate)) : null,
    retencao_pitch_pela_curva: rPitchCurva,
    chegaram_no_pitch: num(st.total_over_pitch),
    cliques_cta: num(st.total_clicked_device_uniq),
    conversoes: num(st.total_conversions),
    conversao: pct(num(st.overall_conversion_rate)),
    faturamento_brl: st.total_amount_brl != null ? Math.round(num(st.total_amount_brl)) / 100 : null,
    avisos: [!pitch ? 'player sem pitch configurado: retenção no pitch não calculada (passe --pitch <segundos>)' : null, curva?.erro ? 'curva de retenção: ' + curva.erro : null].filter(Boolean),
  };
}

async function dias(o) {
  const p = await acharPlayer(o.player);
  const l = await api('POST', '/sessions/stats_by_day', { player_id: p.id, ...periodo(o), ...(p.pitch_s ? { pitch_time: p.pitch_s } : {}) });
  return { player: p.nome, dias: (Array.isArray(l) ? l : l?.data || []).map((d) => ({ dia: d.date_key, views: num(d.total_viewed_device_uniq), plays: num(d.total_started_device_uniq),
    play_rate: pct(num(d.play_rate)), retencao_pitch: pct(num(d.over_pitch_rate)), conversoes: num(d.total_conversions), conversao: pct(num(d.overall_conversion_rate)),
    faturamento_brl: d.total_amount_brl != null ? Math.round(num(d.total_amount_brl)) / 100 : null })) };
}

const { pos, o } = args(process.argv.slice(2));
try {
  const cmd = pos[0];
  const out = cmd === 'players' ? await players(o) : cmd === 'relatorio' ? await relatorio(o) : cmd === 'dias' ? await dias(o) : cmd === 'cota' ? await api('GET', '/quota/usage') : null;
  if (out === null) { console.error('comandos: players | relatorio | dias | cota (veja o começo do arquivo)'); process.exit(2); }
  console.log(JSON.stringify(out, null, 1));
} catch (e) {
  console.error('erro: ' + e.message);
  process.exit(1);
}
