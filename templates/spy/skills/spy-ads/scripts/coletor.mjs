// Coletor do Spy: Biblioteca de Anúncios da Meta (página pública, sem login), num Chromium próprio.
// Lê os anúncios dos dados que a própria página carrega (HTML inicial + GraphQL ao rolar): cada anúncio já traz
// page_id, nome da página, link de destino, vídeo, data de início e quantos anúncios usam o mesmo criativo.
//
//   node coletor.mjs buscar --palavras "emagrecer+receita;truque+glicemia" [--pais BR] [--min-anuncios 20]
//        [--min-dias 10] [--max 15] [--nicho Emagrecimento] [--rolagens 6] [--midia video|all]
//        [--todos-destinos] [--sem-destino] [--repetir]
//   node coletor.mjs biblioteca <link da biblioteca | page_id> [--pais BR]
//   node coletor.mjs monitorar [--lista <json>] [--pais BR]
//   node coletor.mjs darklist --page_id X --pagina "Nome" [--motivo …]   ·   monitorada --page_id X --pagina "Nome" --nicho N
//   node coletor.mjs baixar <id do anúncio> [<id>...] [--pasta <dir>]   (vídeo direto do servidor da Meta, ~10 s cada)
//
// Tudo o que gera fica em $FLOW_TRABALHO/spy: buscas/<data>-<nicho>/resultado.json, darklist.json (anunciantes que
// nunca entram), vistos.json (bibliotecas já mostradas ao usuário: não voltam, a não ser com --repetir),
// monitoradas.json + historico.json (monitoramento). Progresso no stderr; resumo JSON no stdout.
// A Meta bloqueia por ~20 min depois de uns 10 mil anúncios seguidos: o coletor para sozinho e grava o que já tinha.
import fs from 'node:fs';
import path from 'node:path';
import { novaAba, fechar, esperar, lerArgs, log, saida, lerJSON, gravarJSON, PASTA_SPY } from './navegador.mjs';
import { classificar, limparLink } from './destino.mjs';

const MARCAS = /resultados|Nenhum an[uú]ncio corresponde|Identifica[cç][aã]o da biblioteca|results|No ads match/i;
// Aba Spy do squad (o Claude Flow passa o caminho em FLOW_SPY): monitoradas e blacklist. Fora do Claude Flow, usa os
// arquivos locais de $FLOW_TRABALHO/spy.
const SPY = process.env.FLOW_SPY || '';
const dadosSpy = () => (SPY ? lerJSON(SPY, {}) : {});
// fala com o Claude Flow pelas mesmas ferramentas dos bots (token do bot)
async function flow(ferramenta, args) {
  if (!process.env.FLOW_URL || !process.env.FLOW_TOKEN) return null;
  const r = await fetch(`${process.env.FLOW_URL}/api/interno/ferramenta/${ferramenta}`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-flow-token': process.env.FLOW_TOKEN }, body: JSON.stringify({ args }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.erro) throw new Error(j.erro || `Claude Flow respondeu ${r.status}`);
  return j.texto ?? '';
}
const ARQ = {
  darklist: path.join(PASTA_SPY, 'darklist.json'),
  vistos: path.join(PASTA_SPY, 'vistos.json'),
  monitoradas: path.join(PASTA_SPY, 'monitoradas.json'),
  historico: path.join(PASTA_SPY, 'historico.json'),
};
const hoje = () => new Date().toISOString().slice(0, 10);
const norm = (x) => String(x || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// ---------- URLs da Biblioteca ----------
function urlBusca(palavra, pais, midia) {
  const combo = /\+/.test(palavra);
  const p = new URLSearchParams({ active_status: 'active', ad_type: 'all', country: pais, is_targeted_country: 'false',
    media_type: midia, q: palavra.replace(/\s*\+\s*/g, '+'),
    // "emagrecer+receita": todas as palavras no anúncio, em qualquer ordem (o + da própria Biblioteca).
    // Sem +: a expressão exata ("pink salt", nome chiclete da oferta).
    search_type: combo ? 'keyword_unordered' : 'keyword_exact_phrase' });
  p.set('sort_data[mode]', 'total_impressions');
  p.set('sort_data[direction]', 'desc');
  return 'https://www.facebook.com/ads/library/?' + p.toString();
}
export function urlPagina(pid, pais, midia = 'video') {
  return 'https://www.facebook.com/ads/library/?' + new URLSearchParams({ active_status: 'active', ad_type: 'all', country: pais,
    is_targeted_country: 'false', media_type: midia, search_type: 'page', view_all_page_id: pid }).toString();
}
const urlAnuncio = (id) => 'https://www.facebook.com/ads/library/?id=' + id;

// ---------- anúncios a partir do JSON da página ----------
function objetosAnuncio(t) {
  const out = []; const re = /"ad_archive_id":"(\d+)"/g; let m;
  while ((m = re.exec(t))) {
    let d = 0, s = m.index;
    for (; s >= 0; s--) { const c = t[s]; if (c === '}') d++; else if (c === '{') { if (d === 0) break; d--; } }
    if (s < 0) continue;
    let e = s, dd = 0, str = false;
    for (; e < t.length; e++) {
      const c = t[e];
      if (str) { if (c === '\\') e++; else if (c === '"') str = false; continue; }
      if (c === '"') str = true; else if (c === '{') dd++; else if (c === '}') { dd--; if (dd === 0) break; }
    }
    try { const o = JSON.parse(t.slice(s, e + 1)); if (o.ad_archive_id && o.snapshot) out.push(o); } catch {}
    re.lastIndex = Math.max(e, m.index + 1);
  }
  return out;
}
function anuncio(o) {
  const s = o.snapshot || {};
  const card = (s.cards || [])[0] || {};
  const video = (s.videos || [])[0] || {};
  const inicio = o.start_date ? new Date(o.start_date * 1000) : null;
  const texto = (s.body?.text || card.body || '').replace(/\s+/g, ' ').trim();
  return {
    id: String(o.ad_archive_id),
    page_id: String(o.page_id || s.page_id || ''),
    pagina: o.page_name || s.page_name || '',
    inicio: inicio ? inicio.toISOString().slice(0, 10) : null,
    dias: inicio ? Math.max(0, Math.floor((Date.now() - inicio.getTime()) / 86400000)) : null,
    copias: o.collation_count || 1,                       // anúncios com o mesmo criativo e texto
    destino: limparLink(s.link_url || card.link_url || ''),
    dominio: (s.caption || '').toLowerCase(),
    cta: s.cta_text || card.cta_text || '',
    video: video.video_hd_url || video.video_sd_url || card.video_hd_url || card.video_sd_url || '',
    plataformas: o.publisher_platform || [],
    texto: texto.slice(0, 500),
    titulo: (s.title || card.title || '').slice(0, 150),
    link: urlAnuncio(o.ad_archive_id),
  };
}

// ---------- página da Biblioteca: abre, espera, rola, junta os anúncios ----------
class Bloqueio extends Error {}
let anunciosLidos = 0;
async function carregar(url, { rolagens = 0, alvo = 60 } = {}) {
  const p = await novaAba();
  const vistos = new Map();
  const juntar = (t) => { for (const o of objetosAnuncio(t)) { const a = anuncio(o); if (!vistos.has(a.id)) vistos.set(a.id, a); } };
  p.on('response', async (r) => {
    if (!r.url().includes('/api/graphql')) return;
    const t = await r.text().catch(() => '');
    if (t.includes('ad_archive_id')) juntar(t);
  });
  try {
    await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
    let texto = '';
    const limite = Date.now() + 20000;
    while (Date.now() < limite) {
      texto = await p.evaluate(() => document.body?.innerText || '').catch(() => '');
      if (MARCAS.test(texto)) break;
      await esperar(800);
    }
    if (!MARCAS.test(texto)) {
      throw new Bloqueio('A Meta não mostrou os resultados (bloqueio temporário, aviso de cookies ou verificação).');
    }
    await esperar(1200);
    juntar(await p.content().catch(() => ''));
    for (let r = 0; r < rolagens && vistos.size < alvo; r++) {
      const antes = vistos.size;
      await p.mouse.wheel(0, 5000).catch(() => {});
      await esperar(1800);
      if (vistos.size === antes) { await esperar(1500); if (vistos.size === antes) break; }
    }
    texto = await p.evaluate(() => document.body?.innerText || '').catch(() => texto);
    anunciosLidos += vistos.size;
    return { texto, anuncios: [...vistos.values()], contagem: contagem(texto) };
  } finally { await p.close().catch(() => {}); }
}
function contagem(texto) {
  if (/Nenhum an[uú]ncio corresponde|No ads match/i.test(texto)) return 0;
  const m = texto.match(/~?\s*([\d.,]+)\s*(mil)?\s+(resultados?|results?)/i);
  if (!m) return null;
  let n = Number(m[1].replace(/[^\d]/g, ''));
  if (m[2]) n *= 1000;
  return Number.isFinite(n) ? n : null;
}

// ---------- uma biblioteca (página anunciante) ----------
async function lerBiblioteca(pid, pais, midia) {
  const { anuncios, contagem: ativos } = await carregar(urlPagina(pid, pais, midia), { rolagens: 2, alvo: 40 });
  const meus = anuncios.filter((a) => a.page_id === pid);
  const lista = meus.length ? meus : anuncios;
  const diasMax = lista.reduce((m, a) => Math.max(m, a.dias ?? 0), 0);
  // destino mais comum (é o funil principal da oferta)
  const freq = new Map();
  for (const a of lista) if (a.destino) freq.set(a.destino, (freq.get(a.destino) || 0) + a.copias);
  const destinos = [...freq.entries()].sort((a, b) => b[1] - a[1]).map(([u]) => u);
  const exemplos = [...lista].sort((a, b) => (b.copias - a.copias) || ((b.dias ?? 0) - (a.dias ?? 0))).slice(0, 5);
  return { ativos, dias_max: diasMax, destinos: destinos.slice(0, 3), exemplos, pagina: lista[0]?.pagina || '' };
}

const passaEscala = (b, c) => (b.ativos ?? 0) >= c.minAnuncios || (b.dias_max ?? 0) >= c.minDias;

function resumoExemplo(a) {
  return { id: a.id, link: a.link, inicio: a.inicio, dias: a.dias, copias: a.copias, destino: a.destino, texto: a.texto.slice(0, 220) };
}

// ---------- buscar ----------
async function buscar(o) {
  const palavras = String(o.palavras || '').split(/[;\n]+/).map((x) => x.trim()).filter(Boolean);
  if (o.arquivo) palavras.push(...fs.readFileSync(o.arquivo, 'utf8').split(/\r?\n/).map((x) => x.trim()).filter((x) => x && !x.startsWith('#')));
  if (!palavras.length) throw new Error('faltou --palavras "termo+termo;termo+termo"');
  const c = {
    pais: String(o.pais || 'BR').toUpperCase(), midia: o.midia === 'all' ? 'all' : 'video',
    minAnuncios: Number(o['min-anuncios'] ?? 20), minDias: Number(o['min-dias'] ?? 10),
    max: Number(o.max ?? 15), rolagens: Number(o.rolagens ?? 6), nicho: o.nicho || 'Sem nicho',
  };
  const spyDados = dadosSpy();
  const dark = [...lerJSON(ARQ.darklist, []), ...(spyDados.blacklist || [])];
  // já monitoradas na aba Spy: não voltam como novidade
  const monitoradasId = new Set((spyDados.monitoradas || []).map((m) => String(m.page_id)));
  const darkId = new Set(dark.map((d) => String(d.page_id || '')).filter(Boolean));
  const darkNome = new Set(dark.map((d) => norm(d.pagina)).filter(Boolean));
  const vistosAntes = o.repetir ? [] : lerJSON(ARQ.vistos, []);
  const jaVisto = new Set(vistosAntes.map((v) => String(v.page_id)));
  const pasta = path.join(PASTA_SPY, 'buscas', `${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}-${norm(c.nicho).replace(/ /g, '-') || 'busca'}`);
  fs.mkdirSync(pasta, { recursive: true });

  const paginas = new Map();      // page_id -> candidato
  const descartes = { darklist: 0, ja_vistos: 0, escala: 0, destino: 0, erro: 0 };
  const aprovados = [];
  const porPalavra = [];
  let bloqueio = null;

  const gravar = () => gravarJSON(path.join(pasta, 'resultado.json'), { consulta: { ...c, palavras }, quando: new Date().toISOString(),
    aprovados, descartes, por_palavra: porPalavra, bloqueio, anuncios_lidos: anunciosLidos,
    descartados: [...paginas.values()].filter((p) => p.estado !== 'aprovado').map(({ exemplos, ...r }) => r) });

  try {
    for (const palavra of palavras) {
      if (aprovados.length >= c.max) break;
      log(`\n[busca] ${palavra}`);
      const r = await carregar(urlBusca(palavra, c.pais, c.midia), { rolagens: c.rolagens, alvo: 60 });
      porPalavra.push({ palavra, resultados: r.contagem, lidos: r.anuncios.length });
      log(`  ${r.contagem ?? '?'} resultados, ${r.anuncios.length} anúncios lidos`);
      // anunciantes desta palavra, na ordem de impressões
      const grupo = new Map();
      for (const a of r.anuncios) {
        if (!a.page_id) continue;
        if (!grupo.has(a.page_id)) grupo.set(a.page_id, []);
        grupo.get(a.page_id).push(a);
      }
      for (const [pid, ads] of grupo) {
        if (aprovados.length >= c.max) break;
        const ja = paginas.get(pid);
        if (ja) { if (!ja.palavras.includes(palavra)) ja.palavras.push(palavra); continue; }
        const nome = ads[0].pagina;
        const cand = { page_id: pid, pagina: nome, biblioteca: urlPagina(pid, c.pais), palavras: [palavra], estado: 'novo' };
        paginas.set(pid, cand);
        if (darkId.has(pid) || darkNome.has(norm(nome))) { cand.estado = 'darklist'; descartes.darklist++; continue; }
        if (jaVisto.has(pid) || monitoradasId.has(pid)) { cand.estado = monitoradasId.has(pid) ? 'ja_monitorada' : 'ja_visto'; descartes.ja_vistos++; continue; }
        // conta rápida pela própria busca: se nem o anúncio mais velho nem as cópias indicam escala, ainda assim
        // abre a biblioteca (a contagem certa só vem de lá)
        log(`  · ${nome}`);
        let b;
        try { b = await lerBiblioteca(pid, c.pais, c.midia); }
        catch (e) { if (e instanceof Bloqueio) throw e; cand.estado = 'erro'; cand.motivo = String(e.message).slice(0, 120); descartes.erro++; continue; }
        Object.assign(cand, { ativos: b.ativos, dias_max: Math.max(b.dias_max, ...ads.map((a) => a.dias ?? 0)), destinos: b.destinos,
          exemplos: (b.exemplos.length ? b.exemplos : ads.slice(0, 3)) });
        if (!passaEscala(cand, c)) { cand.estado = 'sem_escala'; cand.motivo = `${cand.ativos ?? '?'} ativos, mais antigo com ${cand.dias_max} dias`; descartes.escala++; log(`    sem escala (${cand.motivo})`); continue; }
        // página de destino: só VSL e quiz são resposta direta
        if (!o['sem-destino']) {
          const url = cand.destinos[0] || ads.find((a) => a.destino)?.destino;
          const d = url ? await classificar(url) : { tipo: 'sem-link', sinais: [] };
          cand.destino = d;
          cand.tipo = d.tipo;
          if (!o['todos-destinos'] && !['vsl', 'quiz'].includes(d.tipo)) { cand.estado = 'nao_dr'; cand.motivo = `destino: ${d.tipo}`; descartes.destino++; log(`    destino ${d.tipo}`); continue; }
        }
        cand.estado = 'aprovado';
        aprovados.push(cand);
        log(`    ✔ ${cand.ativos ?? '?'} ativos, ${cand.dias_max} dias, ${cand.tipo || 'destino não conferido'}`);
        gravar();
      }
    }
  } catch (e) {
    if (e instanceof Bloqueio) { bloqueio = e.message + ' Espere ~20 min (ou continue pelo navegador do Claude Flow).'; log('[bloqueio] ' + bloqueio); }
    else throw e;
  } finally {
    gravar();
    await fechar();
    // o que foi mostrado não volta nas próximas buscas (a não ser com --repetir)
    if (aprovados.length) {
      const v = lerJSON(ARQ.vistos, []);
      const ja = new Set(v.map((x) => String(x.page_id)));
      for (const a of aprovados) if (!ja.has(a.page_id)) v.push({ page_id: a.page_id, pagina: a.pagina, nicho: c.nicho, data: hoje() });
      gravarJSON(ARQ.vistos, v);
    }
  }
  return {
    pasta, resultado: path.join(pasta, 'resultado.json'), consulta: { ...c, palavras: palavras.length }, anuncios_lidos: anunciosLidos,
    bloqueio, descartes, por_palavra: porPalavra,
    achados: aprovados.map((a) => ({ pagina: a.pagina, page_id: a.page_id, biblioteca: a.biblioteca, ativos: a.ativos, dias_max: a.dias_max,
      tipo: a.tipo, destino: a.destino?.url_final || a.destino?.url || a.destinos?.[0] || '', plataformas: a.destino?.plataformas || [],
      sinais: a.destino?.sinais || [], palavras: a.palavras, exemplos: (a.exemplos || []).slice(0, 3).map(resumoExemplo) })),
  };
}

// ---------- uma biblioteca só ----------
async function biblioteca(alvo, o) {
  const pais = String(o.pais || 'BR').toUpperCase();
  let pid = String(alvo || '').match(/view_all_page_id=(\d+)/)?.[1] || (/^\d+$/.test(alvo) ? alvo : '');
  if (!pid && /[?&]id=(\d+)/.test(alvo)) {               // link de um anúncio: acha a página dele
    const r = await carregar(alvo);
    pid = r.anuncios[0]?.page_id || '';
  }
  if (!pid) throw new Error('não achei o page_id: mande o link da biblioteca (view_all_page_id=…) ou de um anúncio (?id=…)');
  try {
    const b = await lerBiblioteca(pid, pais, o.midia === 'all' ? 'all' : 'video');
    const d = b.destinos[0] && !o['sem-destino'] ? await classificar(b.destinos[0]) : null;
    return { page_id: pid, pagina: b.pagina, biblioteca: urlPagina(pid, pais), ativos: b.ativos, dias_max: b.dias_max,
      destinos: b.destinos, tipo: d?.tipo, destino: d, exemplos: b.exemplos.map(resumoExemplo) };
  } finally { await fechar(); }
}

// ---------- monitorar ----------
async function monitorar(o) {
  const pais = String(o.pais || 'BR').toUpperCase();
  // monitoradas: as ligadas da aba Spy (ou --lista <json>, ou o arquivo local fora do Claude Flow)
  const lista = o.lista ? lerJSON(o.lista, []) : SPY ? (dadosSpy().monitoradas || []).filter((m) => m.ativa !== false) : lerJSON(ARQ.monitoradas, []);
  if (!lista.length) throw new Error('nenhuma biblioteca monitorada (aba Spy da sala do squad vazia ou tudo pausado)');
  const hist = lerJSON(ARQ.historico, {});
  const out = [];
  try {
    for (const m of lista) {
      const pid = String(m.page_id);
      log(`[monitorar] ${m.pagina || pid}`);
      try {
        const b = await lerBiblioteca(pid, pais, 'video');
        const h = (hist[pid] ||= []);
        const antes = [...h].reverse().find((x) => x.data !== hoje());
        const dia = { data: hoje(), ativos: b.ativos };
        const i = h.findIndex((x) => x.data === dia.data);
        if (i >= 0) h[i] = dia; else h.push(dia);
        out.push({ pagina: m.pagina || b.pagina, page_id: pid, nicho: m.nicho || '', ativos: b.ativos,
          anterior: antes?.ativos ?? null, data_anterior: antes?.data ?? null,
          variacao: antes?.ativos != null && b.ativos != null ? b.ativos - antes.ativos : null, biblioteca: urlPagina(pid, pais) });
      } catch (e) {
        if (e instanceof Bloqueio) { out.push({ bloqueio: e.message }); break; }
        out.push({ pagina: m.pagina, page_id: pid, erro: String(e.message).slice(0, 120) });
      }
    }
  } finally { gravarJSON(ARQ.historico, hist); await fechar(); }
  // grava as contagens na aba Spy (anúncios ativos e data da conferência)
  let gravado = null;
  const contagens = out.filter((x) => x.page_id && Number.isFinite(x.ativos)).map((x) => ({ page_id: x.page_id, ativos: x.ativos }));
  if (contagens.length) { try { gravado = (await flow('spy_conferencias', { itens: contagens })) ? 'aba Spy atualizada' : null; } catch (e) { gravado = 'não gravou na aba Spy: ' + e.message; } }
  return { data: hoje(), aba_spy: gravado, bibliotecas: out };
}

// ---------- baixar o vídeo de um anúncio pelo ID ----------
async function baixar(ids, o) {
  const pasta = o.pasta || path.join(PASTA_SPY, 'anuncios');
  fs.mkdirSync(pasta, { recursive: true });
  const out = [];
  try {
    for (const bruto of ids) {
      const id = String(bruto).match(/(\d{6,})/)?.[1];
      if (!id) { out.push({ id: bruto, erro: 'id inválido' }); continue; }
      log('[baixar] ' + id);
      try {
        const r = await carregar(urlAnuncio(id));
        const a = r.anuncios.find((x) => x.id === id) || r.anuncios[0];
        if (!a?.video) { out.push({ id, erro: 'anúncio sem vídeo (ou a Meta não mandou o endereço)' }); continue; }
        const arq = path.join(pasta, `${id}.mp4`);
        const resp = await fetch(a.video);
        if (!resp.ok) throw new Error('download falhou: HTTP ' + resp.status);
        fs.writeFileSync(arq, Buffer.from(await resp.arrayBuffer()));
        out.push({ id, arquivo: arq, mb: +(fs.statSync(arq).size / 1048576).toFixed(1), pagina: a.pagina, page_id: a.page_id, destino: a.destino, inicio: a.inicio, texto: a.texto });
      } catch (e) {
        if (e instanceof Bloqueio) { out.push({ id, bloqueio: e.message }); break; }
        out.push({ id, erro: String(e.message).slice(0, 160) });
      }
    }
  } finally { await fechar(); }
  return out;
}

// ---------- linha de comando ----------
const { pos, o } = lerArgs(process.argv.slice(2));
const cmd = pos[0];
try {
  if (cmd === 'buscar') saida(await buscar(o));
  else if (cmd === 'biblioteca') saida(await biblioteca(pos[1], o));
  else if (cmd === 'monitorar') saida(await monitorar(o));
  else if (cmd === 'baixar') saida(await baixar(pos.slice(1), o));
  else if ((cmd === 'darklist' || cmd === 'monitorada') && SPY && process.env.FLOW_TOKEN) {
    // dentro do Claude Flow: vai para a aba Spy do squad
    if (!o.page_id && !o.pagina) throw new Error('faltou --page_id e/ou --pagina');
    const txt = cmd === 'darklist'
      ? await flow('spy_blacklist', { page_id: o.page_id ? String(o.page_id) : '', pagina: o.pagina || '', motivo: o.motivo || '' })
      : await flow('spy_monitorar', { page_id: String(o.page_id), pagina: o.pagina || String(o.page_id), nicho: o.nicho || '', tipo: o.tipo || '', destino: o.destino || '', ...(o.ativos ? { ativos: Number(o.ativos) } : {}) });
    saida({ ok: true, resultado: txt });
  }
  else if (cmd === 'darklist' || cmd === 'monitorada') {
    // fora do Claude Flow: arquivos locais. --page_id X --pagina "Nome" [--nicho N]
    if (!o.page_id && !o.pagina) throw new Error('faltou --page_id e/ou --pagina');
    const arq = cmd === 'darklist' ? ARQ.darklist : ARQ.monitoradas;
    const l = lerJSON(arq, []);
    const pid = o.page_id ? String(o.page_id) : '';
    if (!l.some((x) => (pid && String(x.page_id) === pid) || (!pid && norm(x.pagina) === norm(o.pagina)))) {
      l.push({ page_id: pid, pagina: o.pagina || '', ...(o.nicho ? { nicho: o.nicho } : {}), ...(o.motivo ? { motivo: o.motivo } : {}), data: hoje() });
      gravarJSON(arq, l);
    }
    saida({ arquivo: arq, total: l.length });
  }
  else { log('comandos: buscar | biblioteca | monitorar | baixar | darklist | monitorada (veja o começo do arquivo)'); process.exit(2); }
} catch (e) {
  log('erro: ' + (e?.message || e));
  await fechar();
  process.exit(1);
}
