// Claude Flow — app (PWA). Sem build: JavaScript puro (os avatares ficam em avatar.js).
import { avatarSVG, avatarPadrao, avatarAleatorio, FORMAS, ROSTOS, CORES } from './avatar.js';

const S = {
  estado: null,
  msgs: new Map(), // bot -> [mensagens]
  deltas: new Map(), // bot -> texto chegando (streaming)
  naoLidas: new Map(),
  fechados: new Set(JSON.parse(localGet('squadsFechados') || '[]')),
  anexos: [], // anexos do compositor
  cliente: localGet('cliente') || Math.random().toString(36).slice(2),
  rota: {},
  painelAba: 'funcao',
};
localSet('cliente', S.cliente);

function localGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function localSet(k, v) { try { localStorage.setItem(k, v); } catch {} }

// ---------- utilidades ----------
const $ = (sel, el = document) => el.querySelector(sel);
function h(tag, attrs = {}, ...filhos) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const f of filhos.flat(Infinity)) if (f !== null && f !== undefined && f !== false) el.append(f instanceof Node ? f : document.createTextNode(String(f)));
  return el;
}
async function api(metodo, url, corpo) {
  const r = await fetch(url, {
    method: metodo,
    headers: { 'content-type': 'application/json', 'x-claude-flow': '1' },
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.erro || `erro ${r.status}`);
  return j;
}
function aviso(titulo, texto = '', { erro = false, aoClicar = null, ms = 5000 } = {}) {
  const t = h('div', { class: `toast${erro ? ' erro' : ''}`, onclick: () => { t.remove(); aoClicar?.(); } }, h('b', {}, titulo), texto);
  $('#avisos').append(t);
  setTimeout(() => t.remove(), ms);
}
const tenta = (fn) => async (...a) => { try { return await fn(...a); } catch (e) { aviso('Não deu certo', e.message, { erro: true }); } };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const mb = (n) => (n > 1e9 ? `${(n / 1e9).toFixed(1)} GB` : `${(n / 1e6).toFixed(1)} MB`);
const quando = (ts) => {
  if (!ts) return '';
  const d = new Date(ts), hoje = new Date();
  return d.toDateString() === hoje.toDateString() ? d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
};
const bot = (id) => S.estado?.bots.find((b) => b.id === id);
const squad = (id) => S.estado?.squads.find((s) => s.id === id);
const template = (id) => S.estado?.templates.find((t) => t.id === id);
const local = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
const ehToque = matchMedia('(pointer: coarse)').matches;

// Links do Atlas (localhost:4123) viram o endereço público quando o app está aberto pelo celular.
function linkAtlas(url) {
  const pub = S.estado?.atlas?.urlPublica;
  if (local || !pub) return url;
  return url.replace(/^https?:\/\/(localhost|127\.0\.0\.1):4123/, pub.replace(/\/$/, ''));
}

// ---------- markdown simples (seguro: tudo é escapado antes) ----------
function md(txt) {
  const blocos = [];
  let s = String(txt ?? '').replace(/```(\w*)\n?([\s\S]*?)```/g, (_, l, c) => { blocos.push(`<pre><code>${esc(c.replace(/\n$/, ''))}</code></pre>`); return `\u0000${blocos.length - 1}\u0000`; });
  s = esc(s);
  const inline = (t) => t
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,!?:;]|$)/g, '$1<i>$2</i>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, (_, t2, u) => `<a href="${linkAtlas(u)}" target="_blank" rel="noopener">${t2}</a>`)
    .replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, (_, a, u) => `${a}<a href="${linkAtlas(u)}" target="_blank" rel="noopener">${u}</a>`);
  const linhas = s.split('\n');
  const out = [];
  let lista = null, para = [], tabela = [];
  const fecharPara = () => { if (para.length) { out.push(`<p>${inline(para.join('<br>'))}</p>`); para = []; } };
  const fecharLista = () => { if (lista) { out.push(`<${lista.t}>${lista.itens.map((i) => `<li>${inline(i)}</li>`).join('')}</${lista.t}>`); lista = null; } };
  const fecharTabela = () => {
    if (!tabela.length) return;
    const lin = tabela.filter((l) => !/^\|?\s*:?-{2,}/.test(l)).map((l) => l.replace(/^\||\|$/g, '').split('|').map((c) => inline(c.trim())));
    out.push(`<table>${lin.map((l, i) => `<tr>${l.map((c) => (i === 0 ? `<th>${c}</th>` : `<td>${c}</td>`)).join('')}</tr>`).join('')}</table>`);
    tabela = [];
  };
  for (const l of linhas) {
    let m;
    if (/^\s*\|.*\|\s*$/.test(l)) { fecharPara(); fecharLista(); tabela.push(l.trim()); continue; } else fecharTabela();
    if (/^\u0000\d+\u0000$/.test(l.trim())) { fecharPara(); fecharLista(); out.push(l.trim()); }
    else if ((m = l.match(/^(#{1,4})\s+(.*)/))) { fecharPara(); fecharLista(); out.push(`<h${m[1].length + 1}>${inline(m[2])}</h${m[1].length + 1}>`); }
    else if ((m = l.match(/^\s*[-*•]\s+(.*)/))) { fecharPara(); if (lista?.t !== 'ul') { fecharLista(); lista = { t: 'ul', itens: [] }; } lista.itens.push(m[1]); }
    else if ((m = l.match(/^\s*\d+[.)]\s+(.*)/))) { fecharPara(); if (lista?.t !== 'ol') { fecharLista(); lista = { t: 'ol', itens: [] }; } lista.itens.push(m[1]); }
    else if ((m = l.match(/^&gt;\s?(.*)/))) { fecharPara(); fecharLista(); out.push(`<blockquote>${inline(m[1])}</blockquote>`); }
    else if (!l.trim()) { fecharPara(); fecharLista(); }
    else { fecharLista(); para.push(l); }
  }
  fecharPara(); fecharLista(); fecharTabela();
  return out.join('').replace(/\u0000(\d+)\u0000/g, (_, i) => blocos[i]);
}

// ---------- rotas ----------
function lerRota() {
  const p = location.hash.replace(/^#\/?/, '').split('/');
  S.rota = { tela: p[0] || 'inicio', id: p[1] || null };
  document.body.classList.toggle('em-casa', S.rota.tela === 'inicio');
}
const ir = (hash) => { location.hash = hash; };
window.addEventListener('hashchange', () => { lerRota(); renderTudo(); presenca(); });

// ---------- lateral ----------
const avatarDe = (b) => b?.avatar || avatarPadrao(b?.id || 'bot');
function iconeBot(b, tamanho = 32, animar = false) {
  return h('span', { class: 'avatar', html: avatarSVG(avatarDe(b), { tamanho, animar }) });
}
function classeStatus(b) { return (b.status || 'ocioso').replace(' ', '-'); }
function subtituloBot(b) {
  if (b.status === 'trabalhando') return 'trabalhando…';
  if (b.status === 'na fila') return `${b.fila} na fila`;
  if (b.status === 'erro') return 'parou com erro';
  return template(b.template)?.nome || 'bot';
}

function renderLateral() {
  const el = $('#lateral');
  if (!S.estado) { el.replaceChildren(h('div', { class: 'vazio' }, 'Conectando…')); return; }
  const aprov = S.estado.aprovacoes?.length || 0;
  const squads = S.estado.squads.map((sq) => {
    const bs = S.estado.bots.filter((b) => b.squad === sq.id);
    const fechado = S.fechados.has(sq.id);
    return h('div', { class: `squad${fechado ? ' fechado' : ''}` },
      h('div', { class: 'squad-topo', onclick: () => { fechado ? S.fechados.delete(sq.id) : S.fechados.add(sq.id); localSet('squadsFechados', JSON.stringify([...S.fechados])); renderLateral(); } },
        h('span', { class: 'seta' }, '▾'), h('span', { class: 'nome' }, sq.nome),
        h('button', { class: 'btn-txt', title: 'Sala do squad', style: { fontSize: '13px' }, onclick: (e) => { e.stopPropagation(); ir(`#/squad/${sq.id}`); } }, '💬'),
        h('button', { class: 'btn-txt', title: 'Novo bot neste squad', style: { fontSize: '15px' }, onclick: (e) => { e.stopPropagation(); modalNovoBot(sq.id); } }, '+')),
      h('div', { class: 'bots' }, bs.length ? bs.map((b) => {
        const n = S.naoLidas.get(b.id) || 0;
        return h('a', { class: `item${S.rota.tela === 'bot' && S.rota.id === b.id ? ' ativo' : ''}`, href: `#/bot/${b.id}` },
          h('div', { class: 'av' }, iconeBot(b), h('i', { class: `ponto ${classeStatus(b)}` })),
          h('div', { class: 'txt' }, h('b', {}, b.nome), h('small', {}, subtituloBot(b))),
          n ? h('span', { class: 'contador' }, n) : null);
      }) : h('div', { class: 'dica', style: { padding: '4px 12px' } }, 'Nenhum bot ainda.')));
  });
  const lim = S.estado.limite;
  el.replaceChildren(
    h('div', { class: 'marca' },
      h('img', { src: '/icones/icone-192.png', alt: '' }), h('b', {}, 'Claude Flow'),
      h('div', { class: 'acoes' },
        h('button', { class: 'btn min', onclick: () => modalNovoBot() }, '+ Bot'),
        h('button', { class: 'btn min', onclick: modalNovoSquad }, '+ Squad'))),
    h('div', { class: 'lista' }, squads),
    h('div', { class: 'barra' },
      aprov ? h('a', { class: 'item', href: '#/aprovacoes' }, h('span', { class: 'ic' }, '🔐'), h('span', { class: 'txt' }, 'Permissões pendentes'), h('span', { class: 'contador' }, aprov)) : null,
      h('a', { class: `item${S.rota.tela === 'conectores' ? ' ativo' : ''}`, href: '#/conectores' }, h('span', { class: 'ic' }, '🔌'), 'Conectores'),
      h('a', { class: `item${S.rota.tela === 'navegador' ? ' ativo' : ''}`, href: '#/navegador' }, h('span', { class: 'ic' }, '🌐'), 'Navegador'),
      h('a', { class: `item${S.rota.tela === 'ajustes' ? ' ativo' : ''}`, href: '#/ajustes' }, h('span', { class: 'ic' }, '⚙️'), 'Ajustes'),
      lim ? h('div', { class: 'limite' }, `Limite da assinatura (${lim.rateLimitType === 'five_hour' ? '5 h' : lim.rateLimitType || ''}): ${lim.status === 'allowed' ? 'ok' : lim.status}${lim.resetsAt ? ` · renova ${new Date(lim.resetsAt * 1000).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}` : ''}`) : null));
}

// ---------- tela de bot (chat) ----------
function topo(titulo, sub, ...dir) {
  return h('div', { class: 'topo' },
    h('button', { class: 'btn-txt voltar', onclick: () => ir('#/'), title: 'Voltar' }, '‹'),
    h('div', { class: 'titulo' }, h('b', {}, titulo), sub ? h('small', {}, sub) : null), ...dir);
}

function subTopoBot(b) {
  const pct = Math.min(100, Math.round(((b.ctxTokens || 0) / (S.estado.config.memoria.contextoMax || 200000)) * 100));
  const alto = pct >= Math.round((S.estado.config.memoria.compactarEm || 0.6) * 100) - 10;
  return [
    h('span', { class: 'chip' }, h('i', { class: `ponto ${classeStatus(b)}`, style: { width: '7px', height: '7px', borderRadius: '50%', display: 'inline-block', background: 'var(--texto3)' } }), b.status || 'ocioso'),
    h('span', { class: 'chip' }, b.modelo || S.estado.config.modeloPadrao || 'padrão'),
    h('span', { class: 'chip', title: 'Quanto da janela de contexto a sessão atual ocupa. Perto do limite, a memória é compactada sozinha.' },
      'sessão', h('span', { class: `ctx${alto ? ' alto' : ''}` }, h('i', { style: { width: `${pct}%` } })), `${pct}%`),
  ];
}

async function carregarMsgs(botId, antes = null) {
  const lista = await api('GET', `/api/bots/${botId}/mensagens${antes ? `?antes=${antes}` : ''}`);
  const atuais = S.msgs.get(botId) || [];
  S.msgs.set(botId, antes ? [...lista, ...atuais] : lista);
  return lista.length;
}

function renderBot(b) {
  const p = $('#principal');
  const sq = squad(b.squad);
  const cab = topo(b.nome, subTopoBot(b),
    h('button', { class: 'btn so-grande', onclick: () => ir(`#/squad/${b.squad}`) }, `💬 ${sq?.nome || 'Squad'}`),
    h('button', { class: 'btn ic', title: 'Função, memória, conectores, skills', onclick: () => abrirPainel(b.id) }, '⚙︎'));
  cab.insertBefore(h('button', { class: 'avatar-topo', title: 'Mudar a aparência', onclick: () => modalAparencia(b.id) }, iconeBot(b, 36)), cab.querySelector('.titulo'));
  p.replaceChildren(
    cab,
    h('div', { class: 'mensagens', id: 'mensagens' }, h('div', { class: 'estreito', id: 'lista-msgs' })),
    compositor(b));
  S.naoLidas.delete(b.id);
  if (!S.msgs.has(b.id)) carregarMsgs(b.id).then(() => renderMsgs(true)).catch(() => {});
  else renderMsgs(true);
  const m = $('#mensagens');
  m.addEventListener('scroll', async () => {
    if (m.scrollTop < 40 && !m.dataset.carregando) {
      const primeira = (S.msgs.get(b.id) || [])[0];
      if (!primeira || m.dataset.fim) return;
      m.dataset.carregando = '1';
      const alt = m.scrollHeight;
      const n = await carregarMsgs(b.id, primeira.id).catch(() => 0);
      if (!n) m.dataset.fim = '1';
      renderMsgs(false);
      m.scrollTop = m.scrollHeight - alt;
      delete m.dataset.carregando;
    }
  });
}

function blocoArquivo(meta) {
  const url = `/api/arquivo/${meta.token}`;
  const ext = (meta.nome.split('.').pop() || '').toLowerCase();
  const midia = ['mp4', 'mov', 'webm', 'm4v'].includes(ext) ? h('video', { src: url, controls: true, preload: 'metadata', playsinline: true })
    : ['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext) ? h('img', { src: url, alt: meta.nome, loading: 'lazy' }) : null;
  return h('div', { class: 'arquivo' }, midia,
    meta.legenda ? h('div', { class: 'dica' }, meta.legenda) : null,
    h('div', { class: 'linha' }, h('span', {}, `📎 ${meta.nome}`), h('small', { class: 'dica' }, mb(meta.tamanho || 0)),
      h('a', { class: 'btn min', href: url, target: '_blank' }, 'Abrir'), h('a', { class: 'btn min', href: `${url}?baixar=1` }, 'Baixar')));
}

function renderMsgs(rolar = false) {
  const b = bot(S.rota.id);
  const cont = $('#lista-msgs');
  if (!b || !cont) return;
  const caixa = $('#mensagens');
  const noFim = rolar || caixa.scrollHeight - caixa.scrollTop - caixa.clientHeight < 120;
  const lista = S.msgs.get(b.id) || [];
  const nos = [];
  let grupo = null;
  const fecharGrupo = () => {
    if (!grupo) return;
    const itens = grupo.map((m) => h('div', { class: `ferr${m.erro ? ' erro' : ''}` }, h('b', {}, (m.meta?.nome || '').replace(/^mcp__/, '').replace(/__/g, ' › ')), ' ', m.meta?.resumo || ''));
    nos.push(itens.length > 3
      ? h('details', { class: 'ferramentas' }, h('summary', {}, `🔧 ${itens.length} ações · última: `, itens.at(-1).cloneNode(true).textContent), itens)
      : h('div', { class: 'ferramentas' }, itens));
    grupo = null;
  };
  for (const m of lista) {
    if (m.papel === 'ferramenta') { (grupo ||= []).push(m); continue; }
    fecharGrupo();
    if (m.papel === 'usuario') {
      nos.push(h('div', { class: 'msg usuario' }, m.texto, m.meta?.anexos?.length ? h('div', { class: 'anexos' }, m.meta.anexos.map((a) => h('span', { class: 'anexo' }, '📎 ', h('span', {}, a.nome)))) : null));
    } else if (m.papel === 'bot') {
      nos.push(h('div', { class: 'msg bot md', html: md(m.texto) }));
    } else if (m.papel === 'entrada') {
      nos.push(h('div', { class: 'msg entrada' }, h('div', { class: 'de' }, `↘ de @${m.meta?.deNome || bot(m.de)?.nome || m.de}${m.meta?.aguardar ? ' (esperando resposta)' : ''}`), h('div', { class: 'md', html: md(m.texto) })));
    } else if (m.papel === 'arquivo') {
      nos.push(blocoArquivo(m.meta || {}));
    } else {
      nos.push(h('div', { class: 'msg sistema' }, m.texto));
    }
  }
  fecharGrupo();
  for (const ap of (S.estado.aprovacoes || []).filter((a) => a.bot === b.id)) nos.push(cartaoAprovacao(ap));
  const delta = S.deltas.get(b.id);
  if (delta) nos.push(h('div', { class: 'msg bot md digitando', html: md(delta) }));
  else if (b.status === 'trabalhando') nos.push(h('div', { class: 'trabalhando-linha' }, h('i', { class: 'ponto trabalhando' }), 'trabalhando…'));
  if (!lista.length && !delta) {
    const t = template(b.template);
    nos.push(h('div', { class: 'vazio' }, iconeBot(b, 104, true), h('p', {}, `Converse com ${b.nome}.`),
      h('p', { class: 'dica' }, t?.id === 'em-branco' ? 'Comece dizendo a função dele: "Sua função é…". Ele grava e lembra em todas as sessões.' : t?.descricao || '')));
  }
  cont.replaceChildren(...nos);
  if (noFim) caixa.scrollTop = caixa.scrollHeight;
}

function cartaoAprovacao(ap) {
  return h('div', { class: 'aprovacao' },
    h('b', {}, `🔐 ${ap.botNome} quer usar ${ap.ferramenta}`), h('code', {}, ap.resumo),
    h('div', { class: 'acoes-lin' },
      h('button', { class: 'btn prim', onclick: tenta(() => api('POST', `/api/aprovacoes/${ap.id}`, { permitir: true })) }, 'Permitir'),
      h('button', { class: 'btn', onclick: tenta(() => api('POST', `/api/aprovacoes/${ap.id}`, { permitir: false })) }, 'Negar')));
}

function compositor(b) {
  const ta = h('textarea', { rows: 1, placeholder: `Mensagem para ${b.nome}`, id: 'entrada' });
  const rascunho = localGet(`rascunho:${b.id}`);
  if (rascunho) ta.value = rascunho;
  const ajustar = () => { ta.style.height = 'auto'; ta.style.height = `${Math.min(ta.scrollHeight, innerHeight * 0.4)}px`; };
  ta.addEventListener('input', () => { ajustar(); localSet(`rascunho:${b.id}`, ta.value); });
  ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !ehToque && !e.isComposing) { e.preventDefault(); enviar(); } });
  setTimeout(ajustar);
  const arquivo = h('input', { type: 'file', multiple: true, hidden: true, onchange: () => { for (const f of arquivo.files) subir(f); arquivo.value = ''; } });
  const anexos = h('div', { class: 'acoes-lin', id: 'anexos' });
  const botao = h('button', { class: 'enviar', id: 'botao-enviar', title: 'Enviar', onclick: () => (b.status === 'trabalhando' && !ta.value.trim() && !S.anexos.length ? parar() : enviar()) });
  const atualizarBotao = () => {
    const bb = bot(b.id);
    const pararModo = bb?.status === 'trabalhando' && !ta.value.trim() && !S.anexos.length;
    botao.className = `enviar${pararModo ? ' parar' : ''}`;
    botao.textContent = pararModo ? '' : '↑';
    botao.title = pararModo ? 'Parar' : 'Enviar';
  };
  ta.addEventListener('input', atualizarBotao);
  atualizarBotao();
  S.atualizarBotao = atualizarBotao;

  function renderAnexos() {
    anexos.replaceChildren(...S.anexos.map((a, i) => h('span', { class: 'anexo' }, '📎 ', h('span', {}, a.nome),
      a.token ? null : h('span', { class: 'prog' }, h('i', { style: { width: `${a.pct || 0}%` } })),
      h('button', { class: 'btn-txt', style: { fontSize: '13px', padding: '0 2px' }, onclick: () => { S.anexos.splice(i, 1); renderAnexos(); atualizarBotao(); } }, '✕'))));
  }
  S.renderAnexos = renderAnexos;
  renderAnexos();

  function subir(f) {
    const a = { nome: f.name, pct: 0, token: null };
    S.anexos.push(a);
    renderAnexos(); atualizarBotao();
    const x = new XMLHttpRequest();
    x.open('PUT', `/api/upload?nome=${encodeURIComponent(f.name)}`);
    x.setRequestHeader('x-claude-flow', '1');
    x.upload.onprogress = (e) => { a.pct = Math.round((e.loaded / e.total) * 100); renderAnexos(); };
    x.onload = () => {
      if (x.status !== 200) { aviso('Falha no envio', f.name, { erro: true }); S.anexos.splice(S.anexos.indexOf(a), 1); }
      else Object.assign(a, JSON.parse(x.responseText));
      renderAnexos(); atualizarBotao();
    };
    x.onerror = () => { aviso('Falha no envio', f.name, { erro: true }); S.anexos.splice(S.anexos.indexOf(a), 1); renderAnexos(); };
    x.send(f);
  }

  const enviar = tenta(async () => {
    const texto = ta.value.trim();
    if (S.anexos.some((a) => !a.token)) return aviso('Espere o envio dos anexos terminar');
    if (!texto && !S.anexos.length) return;
    await api('POST', `/api/bots/${b.id}/mensagens`, { texto, anexos: S.anexos.map((a) => a.token) });
    ta.value = ''; localSet(`rascunho:${b.id}`, ''); S.anexos = []; renderAnexos(); ajustar(); atualizarBotao();
  });
  const parar = tenta(() => api('POST', `/api/bots/${b.id}/parar`, {}));

  return h('div', { class: 'compositor' }, h('div', { class: 'estreito' },
    h('div', { class: 'caixa', ondragover: (e) => e.preventDefault(), ondrop: (e) => { e.preventDefault(); for (const f of e.dataTransfer.files) subir(f); } },
      anexos, ta,
      h('div', { class: 'linha' },
        h('button', { class: 'btn-txt', title: 'Anexar arquivo (vídeo, roteiro…)', onclick: () => arquivo.click() }, '＋'), arquivo,
        h('span', { class: 'esp', id: 'fila-info' }, b.fila ? `${b.fila} na fila` : ''),
        botao))));
}

// ---------- painel do bot ----------
async function abrirPainel(botId, aba) {
  if (aba) S.painelAba = aba;
  const b = bot(botId);
  const dados = await api('GET', `/api/bots/${botId}/arquivos`).catch((e) => { aviso('Erro', e.message, { erro: true }); return null; });
  if (!dados) return;
  const p = $('#painel');
  p.hidden = false;
  const abas = [['funcao', 'Função'], ['memoria', 'Memória'], ['prefs', 'Preferências'], ['conectores', 'Conectores'], ['skills', 'Skills'], ['sessao', 'Sessão']];
  const corpo = h('div', { class: 'corpo' });
  const desenhar = () => {
    corpo.replaceChildren(...painelConteudo(bot(botId), dados, S.painelAba).flat(Infinity).filter((x) => x !== null && x !== undefined && x !== false));
    abasEl.querySelectorAll('button').forEach((x) => x.classList.toggle('sel', x.dataset.aba === S.painelAba));
  };
  const abasEl = h('div', { class: 'abas' }, abas.map(([k, n]) => h('button', { 'data-aba': k, onclick: () => { S.painelAba = k; desenhar(); } }, n)));
  p.replaceChildren(h('div', { class: 'cab' }, h('button', { class: 'avatar-topo', title: 'Mudar a aparência', onclick: () => modalAparencia(b.id) }, iconeBot(b, 30)), h('b', {}, b.nome), h('button', { class: 'btn-txt', onclick: fecharPainel }, '✕')), abasEl, corpo);
  desenhar();
}
const fecharPainel = () => { $('#painel').hidden = true; };

function campoTexto(rotulo, valor, { limite, dica, aoSalvar, linhas = 10 } = {}) {
  const ta = h('textarea', { class: 'ent', rows: linhas }, valor || '');
  const cont = h('span', { class: 'dica' });
  const conta = () => { cont.textContent = limite ? `${ta.value.length}/${limite} caracteres` : ''; cont.style.color = limite && ta.value.length > limite ? 'var(--erro)' : ''; };
  ta.addEventListener('input', conta); conta();
  return h('label', { class: 'campo' }, rotulo, ta,
    h('div', { class: 'acoes-lin' }, h('button', { class: 'btn prim', onclick: tenta(async (e) => { e.preventDefault(); await aoSalvar(ta.value); aviso('Salvo', 'Vale a partir da próxima mensagem.'); }) }, 'Salvar'), cont, dica ? h('span', { class: 'dica' }, dica) : null));
}

const salvarBot = (id, parcial) => api('PATCH', `/api/bots/${id}`, parcial);
const salvarArquivo = (id, nome, texto) => api('PUT', `/api/bots/${id}/arquivos/${nome}`, { texto });

function alternar(marcado, aoMudar) {
  const i = h('input', { type: 'checkbox', checked: marcado, onchange: () => aoMudar(i.checked) });
  return h('label', { class: 'alternar' }, i, h('span'));
}

function painelConteudo(b, d, aba) {
  const lim = d.limites;
  if (aba === 'funcao') {
    return [
      h('p', { class: 'dica' }, 'A "inteligência matriz" do bot: o que ele é e faz. Vale para todas as sessões. Também muda pelo chat: "sua função é…", "atualize sua função…".'),
      campoTexto('Função', d.funcao, { limite: lim.limiteFuncao, linhas: 18, aoSalvar: (t) => salvarArquivo(b.id, 'funcao', t) }),
    ];
  }
  if (aba === 'memoria') {
    return [
      h('p', { class: 'dica' }, `Fatos duráveis que o bot guarda sozinho (preferências, decisões, caminhos, armadilhas). Limite de ${lim.limiteMemoria} caracteres: quando enche, ele consolida. Toda sessão nova começa com a função, esta memória e os resumos das últimas ${lim.resumosNoContexto} sessões.`),
      campoTexto('Memória do bot', d.memoria, { limite: lim.limiteMemoria, linhas: 12, aoSalvar: (t) => salvarArquivo(b.id, 'memoria', t) }),
      campoTexto('Sobre você (todos os bots leem)', d.usuario, { limite: lim.limiteUsuario, linhas: 6, aoSalvar: (t) => salvarArquivo(b.id, 'usuario', t) }),
      h('h2', { class: 'sec' }, `Resumos das sessões (${d.resumos.length})`),
      d.resumos.length ? d.resumos.map((r) => h('details', { class: 'cartao', style: { marginBottom: '8px' } }, h('summary', { style: { cursor: 'pointer' } }, r.nome.replace(/_.*$/, '').replace(/-(\d\d)-(\d\d)$/, ' $1:$2')), h('div', { class: 'md', html: md(r.texto) }))) : h('p', { class: 'dica' }, 'Nenhuma sessão compactada ainda.'),
    ];
  }
  if (aba === 'prefs') {
    const t = template(b.template);
    const prefs = { ...(b.prefs || {}) };
    const campos = (t?.preferencias || []).map((p) => {
      const el = p.tipo === 'escolha'
        ? h('select', { class: 'ent', onchange: (e) => { prefs[p.chave] = e.target.value; } }, [...new Set([...(p.opcoes || []), prefs[p.chave]].filter(Boolean))].map((o) => h('option', { value: o, selected: o === prefs[p.chave] }, o)))
        : h('input', { class: 'ent', value: prefs[p.chave] ?? '', oninput: (e) => { prefs[p.chave] = e.target.value; } });
      return h('label', { class: 'campo' }, p.rotulo, el);
    });
    const modelo = h('select', { class: 'ent' }, [['', `padrão (${S.estado.config.modeloPadrao})`], ['fable', 'Fable'], ['opus', 'Opus'], ['sonnet', 'Sonnet'], ['haiku', 'Haiku']].map(([v, n]) => h('option', { value: v, selected: (b.modelo || '') === v }, n)));
    const esforco = h('select', { class: 'ent' }, [['', 'padrão'], ['low', 'baixo'], ['medium', 'médio'], ['high', 'alto'], ['xhigh', 'muito alto'], ['max', 'máximo']].map(([v, n]) => h('option', { value: v, selected: (b.esforco || '') === v }, n)));
    const autonomia = h('select', { class: 'ent' }, [['total', 'Total: faz tudo sem pedir (recomendado para trabalhar sozinho)'], ['perguntar', 'Perguntar: cada permissão vira um pedido no app/celular']].map(([v, n]) => h('option', { value: v, selected: b.autonomia === v }, n)));
    const navegador = h('select', { class: 'ent' }, [['principal', 'Principal (compartilhado com os outros bots)'], ['proprio', 'Próprio (perfil só deste bot)'], ['', 'Sem navegador']].map(([v, n]) => h('option', { value: v, selected: (b.navegador ?? '') === v }, n)));
    const pastas = h('textarea', { class: 'ent', rows: 3, style: { minHeight: '70px' } }, (b.pastas || []).join('\n'));
    return [
      t?.preferencias?.length ? [h('h2', { class: 'sec', style: { marginTop: 0 } }, `Preferências do ${t.nome}`), ...campos] : null,
      h('h2', { class: 'sec' }, 'Como o bot roda'),
      h('label', { class: 'campo' }, 'Modelo', modelo),
      h('label', { class: 'campo' }, 'Esforço de raciocínio', esforco),
      h('label', { class: 'campo' }, 'Autonomia', autonomia),
      h('label', { class: 'campo' }, 'Navegador', navegador),
      h('label', { class: 'campo' }, 'Pastas de trabalho extras (uma por linha)', pastas),
      h('button', { class: 'btn prim', onclick: tenta(async () => {
        await salvarBot(b.id, { prefs, modelo: modelo.value, esforco: esforco.value, autonomia: autonomia.value, navegador: navegador.value, pastas: pastas.value.split('\n').map((x) => x.trim()).filter(Boolean) });
        aviso('Preferências salvas', 'Valem a partir da próxima mensagem.');
      }) }, 'Salvar'),
      h('h2', { class: 'sec' }, 'Outras preferências (texto livre)'),
      campoTexto('', d.preferencias, { linhas: 5, aoSalvar: (txt) => salvarArquivo(b.id, 'preferencias', txt) }),
    ];
  }
  if (aba === 'conectores') {
    const ligados = new Set(b.conectores || []);
    const mcp = new Map((d.mcp || []).map((m) => [m.nome, m.status]));
    return [
      h('p', { class: 'dica' }, 'Ligue só o que este bot usa: menos conectores = menos tokens por turno. Os do Google, Notion e Meta vêm da sua conta claude.ai; os outros pedem chave em Conectores.'),
      h('div', { class: 'cartao' }, S.estado.conectores.map((c) => {
        const st = c.tipo === 'claudeai' ? mcp.get(c.servidor) : null;
        const selo = c.tipo === 'claudeai' ? (st === 'connected' ? h('span', { class: 'selo ok' }, 'conectado') : st === 'failed' || st === 'needs-auth' ? h('span', { class: 'selo erro' }, st === 'needs-auth' ? 'precisa entrar' : 'falhou') : h('span', { class: 'selo' }, 'conta claude.ai'))
          : c.segredos?.length && !c.chavesOk ? h('span', { class: 'selo falta' }, 'falta chave') : null;
        return h('div', { class: 'chave' }, h('div', { class: 'txt' }, h('b', {}, c.nome, ' ', selo), h('small', {}, c.descricao)),
          alternar(ligados.has(c.id), tenta(async (on) => { on ? ligados.add(c.id) : ligados.delete(c.id); await salvarBot(b.id, { conectores: [...ligados] }); })));
      })),
    ];
  }
  if (aba === 'skills') {
    const tem = new Set(d.skills);
    const add = h('select', { class: 'ent' }, h('option', { value: '' }, 'Adicionar skill…'), d.catalogoSkills.filter((s) => !tem.has(s)).map((s) => h('option', { value: s }, s)));
    return [
      h('p', { class: 'dica' }, `Skills deste bot (em ${d.pasta}/.claude/skills). As skills instaladas em ~/.claude/skills aparecem para todos os bots.`),
      h('div', { class: 'cartao' }, d.skills.length ? d.skills.map((s) => h('div', { class: 'chave' }, h('div', { class: 'txt' }, h('b', {}, s)),
        h('button', { class: 'btn min perigo', onclick: tenta(async () => { const r = await api('DELETE', `/api/bots/${b.id}/skills/${encodeURIComponent(s)}`); d.skills = r.skills; abrirPainel(b.id); }) }, 'Tirar'))) : h('p', { class: 'dica' }, 'Nenhuma skill própria.')),
      h('div', { class: 'acoes-lin', style: { marginTop: '12px' } }, add, h('button', { class: 'btn', onclick: tenta(async () => { if (!add.value) return; await api('POST', `/api/bots/${b.id}/skills`, { nome: add.value }); abrirPainel(b.id); }) }, 'Adicionar')),
    ];
  }
  // sessão
  return [
    h('div', { class: 'cartao' },
      linhaInfo('Sessão atual', b.sessao ? b.sessao.slice(0, 8) : 'nenhuma (começa na próxima mensagem)'),
      linhaInfo('Começou', b.sessaoInicio ? new Date(b.sessaoInicio).toLocaleString('pt-BR') : '—'),
      linhaInfo('Turnos nesta sessão', b.sessaoTurnos || 0),
      linhaInfo('Contexto ocupado', `${Math.round((b.ctxTokens || 0) / 1000)} mil tokens de ${Math.round(lim.contextoMax / 1000)} mil`),
      linhaInfo('Compacta sozinha', `em ${Math.round(lim.compactarEm * 100)}% da janela ou depois de ${lim.compactarDias} dias`),
      linhaInfo('Custo estimado (equivalente API)', `US$ ${(b.custoEstimado || 0).toFixed(2)} — na assinatura entra no limite, não é cobrado à parte`),
      linhaInfo('Pasta do bot', d.pasta)),
    h('div', { class: 'acoes-lin', style: { marginTop: '14px' } },
      h('button', { class: 'btn', onclick: tenta(async () => { await api('POST', `/api/bots/${b.id}/compactar`); aviso('Compactação na fila', 'O bot guarda a memória e o resumo, e a próxima mensagem abre uma sessão nova.'); }) }, '🗜 Compactar agora'),
      h('button', { class: 'btn', onclick: tenta(async () => { if (!confirm('Abrir uma sessão nova sem compactar? A função e a memória continuam; o que não foi guardado na memória fica só no histórico.')) return; await api('POST', `/api/bots/${b.id}/nova-sessao`); aviso('Sessão nova'); }) }, 'Sessão nova'),
      h('button', { class: 'btn', onclick: tenta(async () => { await api('POST', `/api/bots/${b.id}/parar`, { limparFila: true }); aviso('Parado', 'Fila limpa.'); }) }, 'Parar e limpar fila')),
    h('h2', { class: 'sec' }, 'Bot'),
    h('div', { class: 'acoes-lin' },
      h('button', { class: 'btn', onclick: () => modalAparencia(b.id) }, 'Nome e aparência'),
      h('button', { class: 'btn perigo', onclick: tenta(async () => { if (!confirm(`Apagar ${b.nome}? A pasta dele vai para ~/ClaudeFlow/lixeira.`)) return; await api('DELETE', `/api/bots/${b.id}`); fecharPainel(); ir('#/'); }) }, 'Apagar bot')),
  ];
}
const linhaInfo = (k, v) => h('div', { class: 'chave' }, h('div', { class: 'txt' }, h('small', {}, k), h('b', {}, String(v))));

// ---------- sala do squad ----------
async function renderSquad(sq) {
  const p = $('#principal');
  const bs = S.estado.bots.filter((b) => b.squad === sq.id);
  const corpo = h('div', { class: 'estreito' }, h('div', { class: 'vazio' }, 'Carregando…'));
  p.replaceChildren(topo(`Squad ${sq.nome}`, `${bs.length} bot(s) · conversam entre si, nunca com outro squad`,
    h('button', { class: 'btn', onclick: () => modalNovoBot(sq.id) }, '+ Bot'),
    h('button', { class: 'btn ic', title: 'Renomear / apagar', onclick: () => modalSquad(sq) }, '⚙︎')),
  h('div', { class: 'conteudo' }, corpo));
  const sala = await api('GET', `/api/squads/${sq.id}/sala`).catch(() => ({ mensagens: [], quadro: '' }));
  const quadro = h('textarea', { class: 'ent', rows: 6 }, sala.quadro || '');
  corpo.replaceChildren(
    h('div', { class: 'grade' }, bs.map((b) => h('a', { class: 'cartao item', href: `#/bot/${b.id}`, style: { border: '1px solid var(--linha)' } },
      h('div', { class: 'av' }, iconeBot(b), h('i', { class: `ponto ${classeStatus(b)}` })), h('div', { class: 'txt' }, h('b', {}, b.nome), h('small', {}, subtituloBot(b)))))),
    h('h2', { class: 'sec' }, 'Quadro do squad'),
    h('p', { class: 'dica' }, 'O que vale para todos os bots deste squad: objetivo, combinados, status. Os bots leem no começo de cada sessão e escrevem aqui também.'),
    h('label', { class: 'campo' }, quadro, h('div', { class: 'acoes-lin' }, h('button', { class: 'btn prim', onclick: tenta(async () => { await api('PUT', `/api/squads/${sq.id}/quadro`, { texto: quadro.value }); aviso('Quadro salvo'); }) }, 'Salvar quadro'))),
    h('h2', { class: 'sec' }, 'Conversa entre os bots'),
    sala.mensagens.length ? h('div', { style: { display: 'grid', gap: '12px' } }, sala.mensagens.map((m) => h('div', { class: 'cartao' },
      h('div', { class: 'dica' }, `@${bot(m.de)?.nome || m.meta?.deNome || m.de} → @${bot(m.para)?.nome || m.para} · ${quando(m.criado)}${m.meta?.aguardar ? ' · esperando resposta' : ''}`),
      h('div', { class: 'md', html: md(m.texto) })))) : h('p', { class: 'dica' }, 'Nenhuma mensagem entre bots ainda. Peça a um bot: "manda para o @Outro…" ou "pergunta ao @Outro…".'));
}

// ---------- conectores ----------
function renderConectores() {
  const p = $('#principal');
  const grupos = {};
  for (const c of S.estado.conectores) (grupos[c.grupo || 'Outros'] ||= []).push(c);
  const a = S.estado.atlas;
  p.replaceChildren(topo('Conectores', 'O que os bots conseguem acessar. Cada bot liga só os que usa (⚙︎ do bot › Conectores).'),
    h('div', { class: 'conteudo' }, h('div', { class: 'estreito' },
      Object.entries(grupos).map(([g, cs]) => [h('h2', { class: 'sec' }, g), h('div', { class: 'grade' }, cs.map((c) => cartaoConector(c, a)))]),
      h('p', { class: 'dica', style: { marginTop: '24px' } }, 'Os conectores da conta claude.ai (Google, Notion, Meta, Higgsfield) aparecem sozinhos no Claude CLI de quem está logado nessa conta. Para conectar um novo, entre em claude.ai › Configurações › Conectores. Mais detalhes em docs/conectores.md.'))));
}

function cartaoConector(c, a) {
  const usando = S.estado.bots.filter((b) => (b.conectores || []).includes(c.id)).map((b) => b.nome);
  let selo = null, extra = null;
  if (c.tipo === 'claudeai') selo = h('span', { class: 'selo ok' }, 'pela conta claude.ai');
  if (c.tipo === 'atlas') {
    selo = a.noAr ? h('span', { class: 'selo ok' }, 'no ar') : a.instalado ? h('span', { class: 'selo' }, 'desligado') : h('span', { class: 'selo falta' }, 'não instalado');
    extra = h('div', { class: 'acoes-lin' },
      a.noAr ? h('a', { class: 'btn min', href: linkAtlas(a.url), target: '_blank' }, 'Abrir') : h('button', { class: 'btn min', disabled: !a.instalado, onclick: tenta(async () => { await api('POST', '/api/atlas/ligar'); await recarregarEstado(); renderConectores(); }) }, 'Ligar'),
      !a.instalado ? h('span', { class: 'dica' }, 'npm run editor:instalar') : null);
  }
  if (c.tipo === 'navegador') extra = h('a', { class: 'btn min', href: '#/navegador' }, 'Abrir o navegador');
  if (c.segredos?.length) {
    selo = c.chavesOk ? h('span', { class: 'selo ok' }, 'chave salva') : h('span', { class: 'selo falta' }, 'falta chave');
    extra = h('div', { style: { display: 'grid', gap: '6px' } }, c.segredos.map((s) => {
      const i = h('input', { class: 'ent', type: 'password', placeholder: s.salva ? '•••••• (salva — digite para trocar)' : s.rotulo, autocomplete: 'off' });
      return h('div', { style: { display: 'grid', gap: '4px' } }, h('div', { class: 'acoes-lin' }, i, h('button', { class: 'btn min', onclick: tenta(async () => { if (!i.value.trim()) return; await api('PUT', '/api/segredos', { [s.nome]: i.value.trim() }); i.value = ''; await recarregarEstado(); renderConectores(); aviso('Chave salva', `${s.nome} em ~/ClaudeFlow/segredos.env`); }) }, 'Salvar')), s.ajuda ? h('span', { class: 'dica' }, s.ajuda) : null);
    }));
  }
  if (c.oauth) extra = h('span', { class: 'dica' }, 'Login uma vez pelo terminal: veja docs/conectores.md.');
  return h('div', { class: 'cartao con' }, h('div', { class: 'cab' }, h('b', {}, c.nome), selo), h('p', {}, c.descricao),
    usando.length ? h('span', { class: 'dica' }, `Ligado em: ${usando.join(', ')}`) : null, extra);
}

// ---------- navegador ----------
async function renderNavegador() {
  const p = $('#principal');
  const corpo = h('div', { class: 'estreito' }, h('div', { class: 'vazio' }, 'Carregando…'));
  p.replaceChildren(topo('Navegador do Claude Flow', 'Um Chrome separado do seu, com as contas que você entrar nele.'), h('div', { class: 'conteudo' }, corpo));
  const st = await api('GET', '/api/navegador').catch((e) => ({ erro: e.message, perfis: [] }));
  const url = h('input', { class: 'ent', placeholder: 'https://www.tiktok.com (opcional)' });
  corpo.replaceChildren(
    h('p', { class: 'sub' }, 'Os bots com o conector Navegador usam este Chrome para entrar em sites, pesquisar no TikTok/YouTube, abrir a Biblioteca de Anúncios etc. Para conectar uma conta, abra o perfil aqui, entre na conta na janela que abrir (no computador) e feche quando quiser: o login fica salvo no perfil.'),
    st.chrome ? h('p', { class: 'dica' }, `Navegador encontrado: ${st.chrome}`) : h('p', { class: 'dica', style: { color: 'var(--fila)' } }, 'Nenhum Chrome/Edge encontrado neste computador. Instale o Google Chrome.'),
    h('label', { class: 'campo' }, 'Abrir já numa página', url),
    h('div', { class: 'cartao' }, st.perfis.map((pf) => h('div', { class: 'chave' },
      h('div', { class: 'txt' }, h('b', {}, pf.perfil === 'principal' ? 'Principal (compartilhado)' : bot(pf.perfil)?.nome ? `Próprio de ${bot(pf.perfil).nome}` : pf.perfil), h('small', {}, `${pf.ativo ? '● aberto' : 'fechado'} · porta ${pf.porta}`)),
      h('div', { class: 'acoes-lin' },
        h('button', { class: 'btn min', onclick: tenta(async () => { await api('POST', `/api/navegador/${pf.perfil}/abrir`, { url: url.value.trim() }); renderNavegador(); }) }, pf.ativo ? 'Abrir aba' : 'Abrir'),
        pf.ativo ? h('button', { class: 'btn min', onclick: tenta(async () => { await api('POST', `/api/navegador/${pf.perfil}/fechar`); renderNavegador(); }) }, 'Fechar') : null)))),
    h('p', { class: 'dica', style: { marginTop: '16px' } }, 'Dois bots usando o perfil Principal ao mesmo tempo disputam as abas. Para trabalho em paralelo, dê ao bot um navegador próprio (⚙︎ do bot › Preferências › Navegador).'));
}

// ---------- aprovações ----------
function renderAprovacoes() {
  const lista = S.estado.aprovacoes || [];
  $('#principal').replaceChildren(topo('Permissões pendentes', 'Bots no modo "perguntar" esperando você.'),
    h('div', { class: 'conteudo' }, h('div', { class: 'estreito', style: { display: 'grid', gap: '10px' } }, lista.length ? lista.map(cartaoAprovacao) : h('div', { class: 'vazio' }, 'Nada pendente.'))));
}

// ---------- ajustes ----------
async function renderAjustes() {
  const p = $('#principal');
  const c = S.estado.config;
  const usuario = await api('GET', '/api/usuario').catch(() => ({ texto: '' }));
  const custos = await api('GET', '/api/custos?dias=7').catch(() => []);
  const permissao = 'Notification' in window ? Notification.permission : 'indisponível';
  const modelo = h('select', { class: 'ent' }, ['fable', 'opus', 'sonnet', 'haiku'].map((m) => h('option', { value: m, selected: c.modeloPadrao === m }, m)));
  const urlPub = h('input', { class: 'ent', value: c.urlPublica || '', placeholder: 'https://meu-pc.tail1234.ts.net' });
  const atlasPub = h('input', { class: 'ent', value: S.estado.atlas.urlPublica || '', placeholder: 'https://meu-pc.tail1234.ts.net:8443' });
  const dias = h('input', { class: 'ent', type: 'number', min: 1, value: c.memoria.compactarDias });
  const pct = h('input', { class: 'ent', type: 'number', min: 20, max: 90, value: Math.round(c.memoria.compactarEm * 100) });
  const instalavel = !!S.instalar;
  p.replaceChildren(topo('Ajustes', `Dados em ${c.home}`), h('div', { class: 'conteudo' }, h('div', { class: 'estreito' },
    h('h2', { class: 'sec', style: { marginTop: 0 } }, 'Notificações neste aparelho'),
    h('div', { class: 'cartao' },
      h('p', { class: 'dica', style: { marginTop: 0 } }, `Permissão: ${permissao}. Chega aviso quando um bot termina uma tarefa, pede permissão, para com erro ou manda um aviso. No iPhone: primeiro "Adicionar à Tela de Início" pelo Safari e abra pelo ícone.`),
      h('div', { class: 'acoes-lin' },
        h('button', { class: 'btn prim', onclick: tenta(ativarNotificacoes) }, 'Ativar notificações'),
        h('button', { class: 'btn', onclick: tenta(async () => { const r = await api('POST', '/api/push/teste'); aviso('Teste enviado', `${r.enviados} aparelho(s).`); }) }, 'Mandar teste'),
        instalavel ? h('button', { class: 'btn', onclick: () => S.instalar.prompt() }, 'Instalar o app') : null)),
    h('h2', { class: 'sec' }, 'Sobre você'),
    campoTexto('Perfil que todos os bots leem (os bots também acrescentam)', usuario.texto, { limite: c.memoria.limiteUsuario, linhas: 7, aoSalvar: (t) => api('PUT', '/api/usuario', { texto: t }) }),
    h('h2', { class: 'sec' }, 'Geral'),
    h('label', { class: 'campo' }, 'Modelo padrão dos bots', modelo),
    h('label', { class: 'campo' }, 'Endereço do Claude Flow fora do computador (Tailscale)', urlPub, h('span', { class: 'dica' }, 'Usado nos links das notificações. Veja docs/pwa-e-celular.md.')),
    h('label', { class: 'campo' }, 'Endereço do Atlas fora do computador', atlasPub, h('span', { class: 'dica' }, 'Os links localhost:4123 que o Bot Editor manda viram este endereço quando você abre pelo celular.')),
    h('label', { class: 'campo' }, 'Compactar a memória depois de quantos dias', dias),
    h('label', { class: 'campo' }, 'Compactar quando a sessão passar de (% da janela)', pct),
    h('button', { class: 'btn prim', onclick: tenta(async () => {
      await api('PATCH', '/api/config', { modeloPadrao: modelo.value, urlPublica: urlPub.value.trim(), atlas: { urlPublica: atlasPub.value.trim() }, memoria: { compactarDias: Number(dias.value), compactarEm: Number(pct.value) / 100 } });
      await recarregarEstado(); aviso('Ajustes salvos');
    }) }, 'Salvar'),
    h('h2', { class: 'sec' }, 'Uso nos últimos 7 dias'),
    h('div', { class: 'cartao' }, custos.length ? custos.map((x) => linhaInfo(bot(x.bot)?.nome || x.bot, `${x.turnos} turnos · ${Math.round((x.ms || 0) / 60000)} min trabalhando · ~US$ ${(x.custo || 0).toFixed(2)} equivalente API`)) : h('p', { class: 'dica' }, 'Nenhum turno ainda.')))));
}

function chaveB64(b64) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

async function ativarNotificacoes() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) throw new Error('Este navegador não aceita notificação push. No iPhone, instale na Tela de Início e abra pelo ícone.');
  if (!window.isSecureContext) throw new Error('Notificação precisa de HTTPS (ou localhost). Abra pelo endereço do Tailscale.');
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('Permissão de notificação negada.');
  const reg = await navigator.serviceWorker.ready;
  const { chave } = await api('GET', '/api/push/chave');
  const sub = (await reg.pushManager.getSubscription()) || (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: chaveB64(chave) }));
  await api('POST', '/api/push/inscrever', sub.toJSON());
  aviso('Notificações ativadas', 'Este aparelho vai receber os avisos dos bots.');
}

// ---------- modais ----------
function modal(...conteudo) {
  const m = $('#modal');
  m.hidden = false;
  m.replaceChildren(h('div', { class: 'caixa-m', onclick: (e) => e.stopPropagation() }, ...conteudo));
  m.onclick = fecharModal;
}
const fecharModal = () => { $('#modal').hidden = true; };

// Editor de avatar: prévia grande (pisca e flutua) + forma, rosto e cor. As opções de forma e rosto são desenhadas
// já com a cor e o resto escolhido, para a pessoa ver como fica antes de tocar.
function editorAvatar(av, aoMudar) {
  const prev = h('div', { class: 'av-prev' });
  const formas = h('div', { class: 'av-grade' });
  const rostos = h('div', { class: 'av-grade' });
  const cores = h('div', { class: 'av-cores' });
  const escolher = (campo, valor) => { av[campo] = valor; desenhar(); aoMudar?.(); };
  const opcao = (campo, item, variante) => h('button', {
    class: `av-op${av[campo] === item.id ? ' sel' : ''}`, title: item.nome, 'aria-label': item.nome,
    onclick: () => escolher(campo, item.id), html: avatarSVG(variante, { tamanho: 42 }),
  });
  function desenhar() {
    prev.innerHTML = avatarSVG(av, { tamanho: 136, animar: true });
    formas.replaceChildren(...FORMAS.map((f) => opcao('forma', f, { ...av, forma: f.id })));
    rostos.replaceChildren(...ROSTOS.map((r) => opcao('rosto', r, { ...av, rosto: r.id })));
    cores.replaceChildren(...CORES.map((c) => h('button', {
      class: `av-cor${av.cor === c.id ? ' sel' : ''}`, title: c.nome, 'aria-label': c.nome, style: { background: c.hex }, onclick: () => escolher('cor', c.id),
    })));
  }
  desenhar();
  const dado = h('button', { class: 'av-dado', title: 'Sortear um avatar', 'aria-label': 'Sortear', onclick: () => { Object.assign(av, avatarAleatorio()); desenhar(); aoMudar?.(); } }, '⟳');
  return {
    desenhar,
    topo: h('div', { class: 'av-topo' }, prev, dado),
    opcoes: h('div', {}, h('div', { class: 'av-rot' }, 'Forma'), formas, h('div', { class: 'av-rot' }, 'Rosto'), rostos, h('div', { class: 'av-rot' }, 'Cor'), cores),
  };
}

function cabModal(titulo) {
  return h('div', { class: 'm-cab' }, h('button', { class: 'btn-txt', title: 'Fechar', onclick: fecharModal }, '✕'), h('b', {}, titulo), h('span'));
}

function modalNovoBot(squadId) {
  const tpls = S.estado.templates;
  let tpl = tpls[0]?.id;
  let mexeu = false; // depois que a pessoa mexe no avatar, trocar de template não muda mais o desenho
  const av = { ...(template(tpl)?.avatar || avatarAleatorio()) };
  const ed = editorAvatar(av, () => { mexeu = true; });
  const nome = h('input', { class: 'ent av-nome', placeholder: 'Dê um nome ao seu bot', maxlength: 40, autocomplete: 'off' });
  const criar = h('button', { class: 'btn prim av-criar', disabled: true }, 'Criar bot');
  const atualizarCriar = () => { criar.disabled = !nome.value.trim(); };
  nome.addEventListener('input', atualizarCriar);
  nome.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !criar.disabled) criar.click(); });

  const sqSel = h('select', { class: 'ent' }, S.estado.squads.map((s) => h('option', { value: s.id, selected: s.id === squadId }, s.nome)));
  const campoSquad = h('label', { class: 'campo' }, 'Squad', sqSel);
  campoSquad.hidden = S.estado.squads.length < 2;
  const funcao = h('textarea', { class: 'ent', rows: 4, style: { minHeight: '90px' }, placeholder: 'Opcional: "Sua função é…" (dá para definir depois, pelo chat)' });
  const campoFuncao = h('label', { class: 'campo', style: { marginTop: '14px' } }, 'Função', funcao);
  const chips = h('div', { class: 'tpl-chips' });
  const descricao = h('p', { class: 'dica', style: { margin: '8px 0 0' } });

  const desenharTemplates = () => {
    chips.replaceChildren(...tpls.map((t) => h('button', {
      class: `tpl-chip${t.id === tpl ? ' sel' : ''}`,
      onclick: () => {
        const nomeEraDoTemplate = !nome.value.trim() || tpls.some((x) => x.nome === nome.value.trim());
        tpl = t.id;
        if (!mexeu) { Object.assign(av, t.avatar || avatarAleatorio()); ed.desenhar(); }
        if (nomeEraDoTemplate) nome.value = t.id === 'em-branco' ? '' : t.nome;
        atualizarCriar(); desenharTemplates();
      },
    }, h('span', { class: 'avatar', html: avatarSVG(t.avatar || { forma: 'orbe', rosto: 'pontos', cor: 'gelo' }, { tamanho: 22 }) }), t.nome)));
    descricao.textContent = template(tpl)?.descricao || '';
    campoFuncao.hidden = tpl !== 'em-branco';
  };
  nome.value = tpl === 'em-branco' ? '' : template(tpl)?.nome || '';
  desenharTemplates();
  atualizarCriar();

  criar.onclick = tenta(async () => {
    if (!sqSel.value) throw new Error('Crie um squad primeiro.');
    criar.disabled = true;
    try {
      const b = await api('POST', '/api/bots', { squad: sqSel.value, nome: nome.value.trim(), template: tpl, avatar: { ...av }, funcao: tpl === 'em-branco' ? funcao.value : '' });
      fecharModal(); await recarregarEstado(); ir(`#/bot/${b.id}`);
    } finally { atualizarCriar(); }
  });

  modal(cabModal('Novo bot'), ed.topo, nome,
    h('div', { class: 'av-rot' }, 'Template'), chips, descricao,
    ed.opcoes,
    h('div', { style: { marginTop: '18px' } }, campoSquad), campoFuncao,
    criar);
  if (!ehToque) setTimeout(() => nome.focus(), 50);
}

function modalAparencia(botId) {
  const b = bot(botId);
  if (!b) return;
  const av = { ...avatarDe(b) };
  const ed = editorAvatar(av);
  const nome = h('input', { class: 'ent av-nome', value: b.nome, maxlength: 40, autocomplete: 'off' });
  const salvar = h('button', { class: 'btn prim av-criar', onclick: tenta(async () => {
    if (!nome.value.trim()) throw new Error('O bot precisa de um nome.');
    await salvarBot(b.id, { nome: nome.value.trim(), avatar: { ...av } });
    fecharModal(); await recarregarEstado(); renderPrincipal();
    if (!$('#painel').hidden) abrirPainel(b.id);
  }) }, 'Salvar');
  modal(cabModal('Nome e aparência'), ed.topo, nome, ed.opcoes, salvar);
}

function modalNovoSquad() {
  const nome = h('input', { class: 'ent', placeholder: 'Ex.: Kellen, Calistenia, Lançamento' });
  const desc = h('textarea', { class: 'ent', rows: 3, style: { minHeight: '70px' }, placeholder: 'Objetivo do squad (opcional). Todos os bots dele leem.' });
  modal(h('h3', {}, 'Novo squad'),
    h('p', { class: 'dica' }, 'Um squad é um time de bots que conversam entre si. Um squad não fala com o outro.'),
    h('label', { class: 'campo' }, 'Nome', nome), h('label', { class: 'campo' }, 'Descrição', desc),
    h('div', { class: 'acoes-lin' },
      h('button', { class: 'btn prim', onclick: tenta(async () => { const sq = await api('POST', '/api/squads', { nome: nome.value.trim(), descricao: desc.value.trim() }); fecharModal(); await recarregarEstado(); ir(`#/squad/${sq.id}`); }) }, 'Criar squad'),
      h('button', { class: 'btn', onclick: fecharModal }, 'Cancelar')));
  setTimeout(() => nome.focus(), 50);
}

function modalSquad(sq) {
  const nome = h('input', { class: 'ent', value: sq.nome });
  const desc = h('textarea', { class: 'ent', rows: 3, style: { minHeight: '70px' } }, sq.descricao || '');
  modal(h('h3', {}, 'Squad'),
    h('label', { class: 'campo' }, 'Nome', nome), h('label', { class: 'campo' }, 'Descrição', desc),
    h('div', { class: 'acoes-lin' },
      h('button', { class: 'btn prim', onclick: tenta(async () => { await api('PATCH', `/api/squads/${sq.id}`, { nome: nome.value.trim(), descricao: desc.value }); fecharModal(); await recarregarEstado(); }) }, 'Salvar'),
      h('button', { class: 'btn perigo', onclick: tenta(async () => { if (!confirm(`Apagar o squad ${sq.nome} e todos os bots dele? A pasta vai para ~/ClaudeFlow/lixeira.`)) return; await api('DELETE', `/api/squads/${sq.id}`); fecharModal(); await recarregarEstado(); ir('#/'); }) }, 'Apagar squad'),
      h('button', { class: 'btn', onclick: fecharModal }, 'Cancelar')));
}

// ---------- início ----------
function renderInicio() {
  const n = S.estado.bots.length;
  $('#principal').replaceChildren(topo('Claude Flow', `${S.estado.squads.length} squad(s) · ${n} bot(s)`),
    h('div', { class: 'conteudo' }, h('div', { class: 'estreito' },
      h('h1', { class: 'pag' }, 'Seus bots, no seu computador'),
      h('p', { class: 'sub' }, 'Cada bot é um agente do Claude Code com função, memória, conectores e navegador próprios. Bots do mesmo squad conversam entre si.'),
      h('div', { class: 'grade' }, S.estado.bots.map((b) => h('a', { class: 'cartao item', href: `#/bot/${b.id}`, style: { border: '1px solid var(--linha)' } },
        h('div', { class: 'av' }, iconeBot(b), h('i', { class: `ponto ${classeStatus(b)}` })), h('div', { class: 'txt' }, h('b', {}, b.nome), h('small', {}, `${squad(b.squad)?.nome} · ${subtituloBot(b)}`))))),
      h('div', { class: 'acoes-lin', style: { marginTop: '18px' } }, h('button', { class: 'btn prim', onclick: () => modalNovoBot() }, '+ Novo bot'), h('button', { class: 'btn', onclick: modalNovoSquad }, '+ Novo squad')))));
}

// ---------- render geral ----------
function renderPrincipal() {
  if (!S.estado) return;
  const { tela, id } = S.rota;
  if (tela === 'bot' && bot(id)) return renderBot(bot(id));
  if (tela === 'squad' && squad(id)) return renderSquad(squad(id));
  if (tela === 'conectores') return renderConectores();
  if (tela === 'navegador') return renderNavegador();
  if (tela === 'ajustes') return renderAjustes();
  if (tela === 'aprovacoes') return renderAprovacoes();
  return renderInicio();
}
function renderTudo() { renderLateral(); renderPrincipal(); }

function atualizarTopoBot() {
  const b = bot(S.rota.id);
  if (S.rota.tela !== 'bot' || !b) return;
  const sub = $('.topo .titulo small');
  if (sub) sub.replaceChildren(...subTopoBot(b));
  const fi = $('#fila-info');
  if (fi) fi.textContent = b.fila ? `${b.fila} na fila` : '';
  S.atualizarBotao?.();
}

async function recarregarEstado() {
  S.estado = await api('GET', '/api/estado');
  renderLateral();
}

// ---------- tempo real ----------
function conectarEventos() {
  const es = new EventSource('/api/eventos');
  const on = (tipo, fn) => es.addEventListener(tipo, (e) => { try { fn(JSON.parse(e.data)); } catch (err) { console.error(err); } });
  on('msg', (m) => {
    const lista = S.msgs.get(m.bot);
    if (lista && !lista.some((x) => x.id === m.id)) lista.push(m);
    if (m.papel === 'bot') S.deltas.delete(m.bot);
    const vendo = S.rota.tela === 'bot' && S.rota.id === m.bot && document.visibilityState === 'visible';
    if (!vendo && ['bot', 'arquivo'].includes(m.papel)) { S.naoLidas.set(m.bot, (S.naoLidas.get(m.bot) || 0) + 1); renderLateral(); }
    if (S.rota.tela === 'bot' && S.rota.id === m.bot) renderMsgs();
  });
  on('delta', (d) => {
    S.deltas.set(d.bot, (S.deltas.get(d.bot) || '') + d.texto);
    if (S.rota.tela === 'bot' && S.rota.id === d.bot) {
      const ult = $('#lista-msgs .digitando');
      if (ult) { ult.innerHTML = md(S.deltas.get(d.bot)); const c = $('#mensagens'); if (c.scrollHeight - c.scrollTop - c.clientHeight < 160) c.scrollTop = c.scrollHeight; } else renderMsgs();
    }
  });
  on('ferramenta', (f) => {
    const m = (S.msgs.get(f.bot) || []).find((x) => x.id === f.msg);
    if (m && f.erro) { m.erro = true; if (S.rota.id === f.bot) renderMsgs(); }
  });
  on('bot', (e) => {
    const b = bot(e.id);
    if (!b) return;
    Object.assign(b, e);
    if (e.status !== 'trabalhando') S.deltas.delete(e.id);
    renderLateral(); atualizarTopoBot();
    if (S.rota.tela === 'bot' && S.rota.id === e.id) renderMsgs();
  });
  on('aprovacao', async () => { await recarregarEstado(); if (S.rota.tela === 'bot') renderMsgs(); if (S.rota.tela === 'aprovacoes') renderAprovacoes(); });
  on('estado', async () => { await recarregarEstado(); if (['inicio', 'squad'].includes(S.rota.tela)) renderPrincipal(); });
  on('limite', (l) => { if (S.estado) { S.estado.limite = l; renderLateral(); } });
  on('mcp', (d) => { const b = bot(d.bot); if (b) b.mcp = d.servidores; });
  on('aviso', (a) => { if (document.visibilityState === 'visible' && !(S.rota.tela === 'bot' && S.rota.id === a.bot)) aviso(a.titulo, a.texto, { aoClicar: a.bot ? () => ir(`#/bot/${a.bot}`) : null }); });
  es.onerror = () => { /* o EventSource reconecta sozinho */ };
  es.onopen = async () => { if (S.estado) { await recarregarEstado(); for (const id of S.msgs.keys()) S.msgs.delete(id); renderPrincipal(); } };
}

function presenca() {
  const visivel = document.visibilityState === 'visible';
  fetch('/api/presenca', { method: 'POST', headers: { 'content-type': 'application/json', 'x-claude-flow': '1' }, body: JSON.stringify({ cliente: S.cliente, bot: S.rota.tela === 'bot' ? S.rota.id : null, visivel }) }).catch(() => {});
}
document.addEventListener('visibilitychange', () => {
  presenca();
  if (document.visibilityState === 'visible' && S.rota.tela === 'bot') { S.naoLidas.delete(S.rota.id); renderLateral(); }
});
setInterval(presenca, 20000);

// ---------- início do app ----------
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
  navigator.serviceWorker.addEventListener('message', (e) => { if (e.data?.tipo === 'abrir') location.href = e.data.url; });
}
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); S.instalar = e; });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { fecharModal(); fecharPainel(); } });

lerRota();
renderLateral();
recarregarEstado().then(() => { renderPrincipal(); conectarEventos(); presenca(); }).catch((e) => {
  $('#principal').replaceChildren(h('div', { class: 'vazio' }, `Não consegui falar com o servidor do Claude Flow: ${e.message}`));
});
