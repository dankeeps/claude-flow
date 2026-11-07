// Claude Flow — app (PWA). Sem build: JavaScript puro (avatares em avatar.js, ícones de linha em icones.js).
import { avatarSVG, avatarPadrao, avatarAleatorio, avatarValido, nomePlaneta, PLANETAS, corDoPlaneta } from './avatar.js';
import { icone } from './icones.js';

const S = {
  estado: null,
  msgs: new Map(), // bot -> [mensagens]
  deltas: new Map(), // bot -> texto chegando (streaming)
  naoLidas: new Map(),
  fechados: new Set(JSON.parse(localGet('squadsFechados') || '[]')),
  anexos: [], // anexos do compositor
  abertos: new Set(), // resumos de trabalho abertos (por id da primeira ação)
  pendente: new Map(), // bot -> quando a mensagem saiu e o turno ainda não começou (o planeta já aparece)
  sala: new Map(), // squad -> mensagens da sala
  salaRoteando: null, // squad em que o roteador está escolhendo quem responde
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
const avatarDe = (b) => (avatarValido(b?.avatar) ? b.avatar : avatarPadrao(b?.id || 'bot'));
function iconeBot(b, tamanho = 32) {
  return h('span', { class: 'avatar', html: avatarSVG(avatarDe(b), { tamanho }) });
}
const ic = (nome, tamanho = 18, opcoes) => h('span', { class: 'ic', html: icone(nome, tamanho, opcoes) });
function classeStatus(b) { return (b.status || 'ocioso').replace(' ', '-'); }
function subtituloBot(b) {
  if (b.status === 'trabalhando') return 'trabalhando…';
  if (b.esperandoPesado) return `esperando a vez (${b.esperandoPesado})`;
  if (b.pausado) return b.fila ? `fila pausada (${b.fila})` : 'fila pausada';
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
        h('span', { class: 'seta' }, ic('baixo', 13)), h('span', { class: 'nome' }, sq.nome),
        h('button', { class: 'btn-txt', title: 'Sala do squad', onclick: (e) => { e.stopPropagation(); ir(`#/squad/${sq.id}`); } }, ic('conversa', 15)),
        h('button', { class: 'btn-txt', title: 'Novo bot neste squad', onclick: (e) => { e.stopPropagation(); modalNovoBot(sq.id); } }, ic('mais', 15))),
      h('div', { class: 'bots' }, bs.length ? bs.map((b) => {
        const n = S.naoLidas.get(b.id) || 0;
        return h('a', { class: `item${S.rota.tela === 'bot' && S.rota.id === b.id ? ' ativo' : ''}`, href: `#/bot/${b.id}`, title: b.nome },
          h('div', { class: 'av' }, iconeBot(b), h('i', { class: `ponto ${classeStatus(b)}` })),
          h('div', { class: 'txt' }, h('b', {}, b.nome), subtituloBot(b) !== b.nome ? h('small', {}, subtituloBot(b)) : null),
          n ? h('span', { class: 'contador' }, n) : null);
      }) : h('div', { class: 'dica', style: { padding: '4px 12px' } }, 'Nenhum bot ainda.')));
  });
  const lim = S.estado.limite;
  el.replaceChildren(
    h('div', { class: 'marca' },
      h('img', { src: '/icones/icone-192.png', alt: '' }), h('b', {}, 'Claude Flow'),
      h('button', { class: 'btn-txt mais-novo', title: 'Adicionar', 'aria-label': 'Adicionar', onclick: (e) => { e.stopPropagation(); menuNovo(e.currentTarget); } }, ic('mais', 18))),
    h('div', { class: 'lista' }, squads),
    h('div', { class: 'barra' },
      aprov ? h('a', { class: 'item', href: '#/aprovacoes', title: 'Esperando você' }, ic('cadeado'), h('span', { class: 'rot' }, 'Esperando você'), h('span', { class: 'contador' }, aprov)) : null,
      h('a', { class: `item${S.rota.tela === 'conectores' ? ' ativo' : ''}`, href: '#/conectores', title: 'Conectores' }, ic('conector'), h('span', { class: 'rot' }, 'Conectores')),
      h('a', { class: `item${S.rota.tela === 'navegador' ? ' ativo' : ''}`, href: '#/navegador', title: 'Navegador' }, ic('globo'), h('span', { class: 'rot' }, 'Navegador')),
      h('a', { class: `item${S.rota.tela === 'ajustes' ? ' ativo' : ''}`, href: '#/ajustes', title: 'Ajustes' }, ic('engrenagem'), h('span', { class: 'rot' }, 'Ajustes')),
      lim ? h('div', { class: 'limite' }, `Limite da assinatura (${lim.rateLimitType === 'five_hour' ? '5 h' : lim.rateLimitType || ''}): ${lim.status === 'allowed' ? 'ok' : lim.status}${lim.resetsAt ? ` · renova ${new Date(lim.resetsAt * 1000).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}` : ''}`) : null),
    puxador());
}

// ---------- "+" com menu (novo bot / novo squad) ----------
function fecharMenu() { $('#menu-pop')?.remove(); }
function menuNovo(ancora) {
  if ($('#menu-pop')) return fecharMenu();
  const r = ancora.getBoundingClientRect();
  const item = (icone, titulo, sub, acao) => h('button', { class: 'menu-item', onclick: () => { fecharMenu(); acao(); } },
    ic(icone, 18), h('span', { class: 'txt' }, h('b', {}, titulo), h('small', {}, sub)));
  const m = h('div', { class: 'menu-pop', id: 'menu-pop', role: 'menu', onclick: (e) => e.stopPropagation() },
    item('bot', 'Novo bot', 'Um agente com função e memória', () => modalNovoBot()),
    item('squad', 'Novo squad', 'Um time de bots que conversam', modalNovoSquad));
  document.body.append(m);
  const largura = m.offsetWidth;
  m.style.top = `${r.bottom + 6}px`;
  m.style.left = `${Math.max(8, Math.min(r.left, innerWidth - largura - 8))}px`;
}
document.addEventListener('click', fecharMenu);

// ---------- lateral redimensionável (arrastar a borda; bem para a esquerda = só ícones) ----------
const LAT = { min: 220, max: 440, mini: 72, recolher: 150 };
function aplicarLateral() {
  const larg = Math.min(LAT.max, Math.max(LAT.min, Number(localGet('larguraLateral')) || 288));
  document.documentElement.style.setProperty('--larg-lateral', `${larg}px`);
  document.body.classList.toggle('lateral-mini', localGet('lateralMini') === '1');
}
function puxador() {
  const p = h('div', { class: 'puxador', title: 'Arraste para mudar a largura · duplo clique recolhe/abre', role: 'separator', 'aria-orientation': 'vertical' });
  p.addEventListener('dblclick', () => { localSet('lateralMini', localGet('lateralMini') === '1' ? '0' : '1'); aplicarLateral(); });
  p.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    p.setPointerCapture(e.pointerId);
    document.body.classList.add('redimensionando');
    const esquerda = $('#lateral').getBoundingClientRect().left;
    const mover = (ev) => {
      const w = ev.clientX - esquerda;
      if (w < LAT.recolher) { localSet('lateralMini', '1'); }
      else { localSet('lateralMini', '0'); localSet('larguraLateral', String(Math.round(Math.min(LAT.max, Math.max(LAT.min, w))))); }
      aplicarLateral();
    };
    const soltar = () => { document.body.classList.remove('redimensionando'); p.removeEventListener('pointermove', mover); p.removeEventListener('pointerup', soltar); p.removeEventListener('pointercancel', soltar); };
    p.addEventListener('pointermove', mover);
    p.addEventListener('pointerup', soltar);
    p.addEventListener('pointercancel', soltar);
  });
  return p;
}
aplicarLateral();

// ---------- tela de bot (chat) ----------
function topo(titulo, sub, ...dir) {
  return h('div', { class: 'topo' },
    h('button', { class: 'btn-txt voltar', onclick: () => ir('#/'), title: 'Voltar' }, ic('voltar', 22)),
    h('div', { class: 'titulo' }, h('b', {}, titulo), sub ? h('small', {}, sub) : null), ...dir);
}

// (o modelo e o contexto ficam na caixa de mensagem, ao lado do "+")
function subTopoBot(b) {
  return h('span', {}, subtituloBot(b));
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
  // O topo fica só sobre o chat; a barra do bot ocupa a altura inteira à direita. Com ela aberta, o botão do squad
  // passa para dentro dela (ao lado do X) e o ⋯ some; fechando, os dois voltam para o topo.
  const cab = topo(b.nome, subTopoBot(b),
    h('button', { class: 'btn pilula so-grande acao-topo', onclick: () => ir(`#/squad/${b.squad}`) }, ic('squad', 15), sq?.nome || 'Squad'),
    h('button', { class: 'btn-txt mais-info acao-topo', id: 'botao-info', title: 'Função, tarefas, links e modelos', 'aria-label': 'Informações do bot', onclick: () => alternarInfo(b.id) }, ic('pontos', 22, { preenchido: true })));
  cab.insertBefore(h('button', { class: 'avatar-topo', title: 'Mudar a aparência', onclick: () => modalAparencia(b.id) }, iconeBot(b, 36)), cab.querySelector('.titulo'));
  p.replaceChildren(
    // suas mensagens saem na cor do planeta deste bot
    h('div', { class: `area-chat${infoAberta() ? ' com-info' : ''}`, style: `--bolha: ${corDoPlaneta(avatarDe(b).planeta)}` },
      h('div', { class: 'coluna-chat sobreposto' },
        cab,
        h('div', { class: 'mensagens rolagem-sob', id: 'mensagens' }, h('div', { class: 'estreito', id: 'lista-msgs' }), h('div', { class: 'estreito', id: 'indicador' })),
        compositor(b)),
      h('aside', { class: 'info-bot', id: 'info-bot', hidden: !infoAberta() })));
  sobreporCompositor(p.querySelector('.coluna-chat'));
  if (infoAberta()) renderInfo(b.id);
  S.atualizarBotao?.();
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

// A caixa de digitar flutua sobre a conversa (CSS .sobreposto): a lista ganha folga embaixo do tamanho exato da caixa,
// que muda quando o texto cresce, a fila aparece ou um anexo entra. Quem estava no fim continua no fim.
function sobreporCompositor(cont) {
  const comp = cont?.querySelector(':scope > .compositor'); const rol = cont?.querySelector(':scope > .rolagem-sob');
  if (!comp || !rol) return;
  S.roCompositor?.disconnect();
  let alt = 0;
  const medir = () => {
    const nova = comp.offsetHeight; if (!nova || nova === alt) return;
    const noFim = rol.scrollHeight - rol.scrollTop - rol.clientHeight < 80;
    alt = nova; cont.style.setProperty('--alt-comp', `${nova}px`);
    if (noFim) rol.scrollTop = rol.scrollHeight;
  };
  S.roCompositor = new ResizeObserver(medir); S.roCompositor.observe(comp); medir();
}

// ---------- barra de informações do bot (⋯ no canto superior direito) ----------
// Função (editável aqui ou pelo chat), tarefas abertas, links fixos e modelos de referência do bot.
const ehCelular = () => matchMedia('(max-width: 760px)').matches;
const infoAberta = () => (ehCelular() ? !!S.infoCelular : localGet('infoBot') !== '0');
function alternarInfo(botId) {
  const abrir = !infoAberta();
  if (ehCelular()) S.infoCelular = abrir; else localSet('infoBot', abrir ? '1' : '0');
  const el = $('#info-bot');
  if (el) el.hidden = !abrir;
  $('.area-chat')?.classList.toggle('com-info', abrir);
  if (abrir) renderInfo(botId);
}

// Seção da barra: rótulo cinza com a ação em texto à direita (como "Ocultar") e o conteúdo num cartão.
function secaoInfo(titulo, conteudo, acao = null) {
  return h('section', { class: 'info-sec' }, h('div', { class: 'info-rot' }, h('span', {}, titulo), acao), conteudo);
}
const acaoInfo = (texto, fn) => h('button', { class: 'info-acao', onclick: (e) => { e.stopPropagation(); fn(); } }, texto);

const ROTULO_STATUS = { afazer: 'A fazer', fazendo: 'Fazendo', revisao: 'Revisão', feito: 'Feito' };

async function renderInfo(botId) {
  const el = $('#info-bot');
  const b = bot(botId);
  if (!el || !b) return;
  const d = await api('GET', `/api/bots/${botId}/info`).catch(() => null);
  if (!d || S.rota.id !== botId) return;
  const rolagem = el.scrollTop;

  // função
  const funcaoTxt = d.funcao?.trim();
  const editarFuncao = () => {
    const ta = h('textarea', { class: 'ent', rows: 12 }, d.funcao || '');
    corpoFuncao.replaceChildren(ta, h('div', { class: 'acoes-lin', style: { marginTop: '10px' } },
      h('button', { class: 'btn prim min', onclick: tenta(async () => { await api('PUT', `/api/bots/${botId}/arquivos/funcao`, { texto: ta.value }); aviso('Função salva', 'Vale a partir da próxima mensagem.'); renderInfo(botId); }) }, 'Salvar'),
      h('button', { class: 'btn min', onclick: () => renderInfo(botId) }, 'Cancelar')));
    ta.focus();
  };
  const corpoFuncao = h('div', { class: 'info-cartao pad' },
    funcaoTxt ? h('div', { class: 'md info-funcao', html: md(funcaoTxt) }) : h('p', { class: 'info-vazio' }, 'Sem função ainda. Escreva aqui ou diga no chat: "sua função é…".'));

  // tarefas
  const corpoTarefas = d.tarefas.length
    ? h('div', { class: 'info-cartao' }, d.tarefas.map((t) => h('button', { class: 'info-item', onclick: () => modalTarefa(t.id) },
      h('span', { class: `bolinha ${t.status}` }), h('span', { class: 'txt' }, h('b', {}, t.titulo)), h('small', { class: 'dir' }, ROTULO_STATUS[t.status]))))
    : h('div', { class: 'info-cartao pad' }, h('p', { class: 'info-vazio' }, 'Nenhuma tarefa aberta.'));

  // links
  const nomeL = h('input', { class: 'ent', placeholder: 'Nome (ex.: Planilha de métricas)' });
  const urlL = h('input', { class: 'ent', placeholder: 'https://…' });
  const formLink = h('div', { class: 'info-form', hidden: true }, nomeL, urlL,
    h('div', { class: 'acoes-lin' },
      h('button', { class: 'btn prim min', onclick: tenta(async () => { await api('POST', `/api/bots/${botId}/links`, { nome: nomeL.value.trim() || urlL.value.trim(), url: urlL.value.trim() }); renderInfo(botId); }) }, 'Salvar'),
      h('button', { class: 'btn min', onclick: () => { formLink.hidden = true; } }, 'Cancelar')));
  const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } };
  const corpoLinks = h('div', {},
    d.links.length ? h('div', { class: 'info-cartao' }, d.links.map((l) => h('div', { class: 'info-item' },
      h('span', { class: 'ic-item' }, ic('link', 15)),
      h('a', { class: 'txt', href: /^https?:/.test(l.url) ? l.url : null, target: '_blank', rel: 'noopener', title: l.url }, h('b', {}, l.nome), h('small', {}, host(l.url))),
      h('button', { class: 'btn-txt tirar', title: 'Tirar da lista', onclick: tenta(async () => { if (!confirm(`Tirar "${l.nome}" dos links de ${b.nome}?`)) return; await api('DELETE', `/api/bots/${botId}/links/${l.id}`); renderInfo(botId); }) }, ic('fechar', 13)))))
      : h('div', { class: 'info-cartao pad' }, h('p', { class: 'info-vazio' }, 'Planilhas, pastas e documentos que o bot sempre enxerga. Também dá para pedir no chat: "salva esse link".')),
    formLink);

  // modelos
  const corpoModelos = d.modelos.length
    ? h('div', { class: 'info-cartao' }, d.modelos.map((m) => h('button', { class: 'info-item', onclick: () => modalModelo(botId, m.nome) },
      h('span', { class: 'ic-item' }, ic('documento', 15)), h('span', { class: 'txt' }, h('b', {}, m.nome)), h('span', { class: 'seta-dir' }, ic('direita', 14)))))
    : h('div', { class: 'info-cartao pad' }, h('p', { class: 'info-vazio' }, 'Padrões em texto que o bot segue (ex.: "Anúncio": o que todo anúncio precisa ter).'));

  const aba = S.infoAba || 'geral';
  const abas = h('div', { class: 'info-abas', role: 'tablist' }, ABAS_INFO.map(([id, nome]) =>
    h('button', { class: id === aba ? 'sel' : '', role: 'tab', 'aria-selected': String(id === aba), onclick: () => { S.infoAba = id; renderInfo(botId); } }, nome)));
  const secoes = {
    geral: () => [
      secaoInfo('Função', corpoFuncao, acaoInfo('Editar', editarFuncao)),
      secaoInfo('Tarefas', corpoTarefas, acaoInfo('Nova', () => modalNovaTarefa({ squad: b.squad, bot: botId }))),
      secaoBot()],
    galeria: () => [galeriaInfo(botId)],
    recursos: () => [
      secaoInfo('Links', corpoLinks, acaoInfo('Adicionar', () => { formLink.hidden = false; nomeL.focus(); })),
      secaoInfo('Modelos', corpoModelos, acaoInfo('Novo', () => modalModelo(botId, null))),
      secaoHabilidades()],
    rotinas: () => [secaoRotinas()],
  };
  const secaoRotinas = () => secaoInfo('Rotinas', (d.rotinas || []).length
      ? h('div', { class: 'info-cartao' }, d.rotinas.map((r) => h('button', { class: `info-item${r.ativa ? '' : ' apagado'}`, onclick: () => modalRotina(botId, r.id) },
        h('span', { class: 'ic-item' }, ic('relogio', 15)), h('span', { class: 'txt' }, h('b', {}, r.nome), h('small', {}, r.ativa ? r.descricao : `Pausada · ${r.descricao}`)), h('span', { class: 'seta-dir' }, ic('direita', 14)))))
      : h('div', { class: 'info-cartao pad' }, h('p', { class: 'info-vazio' }, 'Instruções que rodam sozinhas: "todo dia às 8h, veja os concorrentes e me resuma". Também dá para pedir no chat.')),
      acaoInfo('Nova', () => modalRotina(botId, null)));
  // habilidades (skills): as do template do bot e as do Claude Flow, que valem para todos (ex.: baixar do Drive)
  const secaoHabilidades = () => (d.habilidades || []).length ? secaoInfo('Habilidades', h('div', { class: 'info-cartao' }, d.habilidades.map((s) => h('div', { class: 'info-item estatico', title: s.descricao },
    h('span', { class: 'ic-item' }, ic('faisca', 15)),
    h('span', { class: 'txt' }, h('b', {}, nomeHabilidade(s.nome)), h('small', {}, s.geral ? 'Todos os bots' : (s.descricao || '').replace(/\s*-\s.*$/, '').slice(0, 80))))))) : null;
  const secaoBot = () => secaoInfo('Bot', h('div', { class: 'info-cartao' },
    h('button', { class: 'info-item', onclick: () => abrirPainel(botId) }, h('span', { class: 'txt' }, h('b', {}, 'Ajustes')), h('span', { class: 'seta-dir' }, ic('direita', 14))),
    h('div', { class: 'info-item estatico', title: d.pasta }, h('span', { class: 'txt' }, h('b', {}, 'Pasta')), h('small', { class: 'dir' }, d.pasta.split(/[\/]/).slice(-2).join('/')))));

  el.replaceChildren(
    h('div', { class: 'info-fechar' },
      h('button', { class: 'btn pilula', onclick: () => ir(`#/squad/${b.squad}`) }, ic('squad', 15), squad(b.squad)?.nome || 'Squad'),
      h('button', { class: 'btn-txt redondo', title: 'Fechar', 'aria-label': 'Fechar', onclick: () => alternarInfo(botId) }, ic('fechar', 16))),
    h('div', { class: 'info-perfil' },
      h('button', { class: 'avatar-topo', title: 'Mudar nome e planeta', onclick: () => modalAparencia(botId) }, iconeBot(b, 84)),
      h('b', {}, b.nome), subtituloBot(b) !== b.nome ? h('small', {}, subtituloBot(b)) : null),
    abas,
    ...(secoes[aba] || secoes.geral)());
  el.scrollTop = S.infoAbaRolada === aba ? rolagem : 0;
  S.infoAbaRolada = aba;
}

// Abas do painel do bot. A Galeria junta o que o bot produziu (vídeos, imagens, áudios): o que ele entregou no chat
// e o que está nas pastas de saída dele (renders, cortados, entregas). Apagou do computador, some daqui.
const ABAS_INFO = [['geral', 'Geral'], ['galeria', 'Galeria'], ['recursos', 'Recursos'], ['rotinas', 'Rotinas']];

function galeriaInfo(botId) {
  const corpo = h('div', { class: 'galeria' }, h('p', { class: 'info-vazio' }, 'Carregando…'));
  api('GET', `/api/bots/${botId}/galeria`).then(({ itens }) => {
    if (!itens.length) return corpo.replaceChildren(h('div', { class: 'info-cartao pad' }, h('p', { class: 'info-vazio' }, 'Nada ainda. Os vídeos, imagens e áudios que este bot criar aparecem aqui.')));
    const data = (t) => new Date(t).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
    corpo.replaceChildren(...itens.map((x) => h('button', { class: `gal-item ${x.tipo}`, title: `${x.nome} · ${x.pasta}`, onclick: () => abrirMidia(x) },
      h('div', { class: 'gal-capa' },
        x.tipo === 'audio' ? h('span', { class: 'gal-ic' }, ic('microfone', 22))
          : h('img', { src: `/api/arquivo/${x.token}/capa`, alt: '', loading: 'lazy', onerror: (e) => { e.target.replaceWith(h('span', { class: 'gal-ic' }, ic('documento', 22))); } }),
        x.tipo === 'video' ? h('span', { class: 'gal-play' }, ic('play', 14, { preenchido: true })) : null),
      h('div', { class: 'gal-nome' }, x.nome),
      h('div', { class: 'gal-meta' }, `${data(x.data)} · ${mb(x.tamanho)}`))));
  }).catch(() => corpo.replaceChildren(h('p', { class: 'info-vazio' }, 'Não deu para abrir a galeria.')));
  return h('div', { class: 'info-sec' }, corpo);
}

function abrirMidia(x) {
  const url = `/api/arquivo/${x.token}`;
  const midia = x.tipo === 'video' ? h('video', { src: url, controls: true, autoplay: true, playsinline: true, class: 'midia-grande' })
    : x.tipo === 'imagem' ? h('img', { src: url, alt: x.nome, class: 'midia-grande' })
      : h('audio', { src: url, controls: true, autoplay: true, style: { width: '100%' } });
  modal(cabModal(x.nome), midia,
    x.legenda ? h('p', { class: 'dica', style: { marginTop: '10px' } }, x.legenda) : null,
    h('div', { class: 'acoes-lin', style: { marginTop: '12px' } },
      h('small', { class: 'dica', style: { flex: '1' } }, `${x.pasta} · ${mb(x.tamanho)}`),
      h('a', { class: 'btn min', href: url, target: '_blank' }, 'Abrir'),
      h('a', { class: 'btn min', href: `${url}?baixar=1` }, 'Baixar')));
}

// "baixar-do-drive" → "Baixar do Drive"; nomes conhecidos ganham um nome de gente.
const NOMES_HABILIDADE = { 'baixar-do-drive': 'Baixar do Drive', 'perfect-edit': 'Perfect Edit', 'broll-youtube': 'B-roll do YouTube', 'motion-vox': 'Motion estilo Vox', 'criar-template': 'Criar template do Atlas' };
const nomeHabilidade = (n) => NOMES_HABILIDADE[n] || n.replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase());

// Rotina: nome, instrução e quando roda (todo dia, dias da semana, a cada X horas ou só pelo link/botão).
async function modalRotina(botId, id) {
  const r = id ? await api('GET', `/api/rotinas/${id}`).catch(() => null) : null;
  const q = r?.quando || { tipo: 'diario', hora: '09:00', dias: [1, 2, 3, 4, 5], horas: 6 };
  const nome = h('input', { class: 'ent', value: r?.nome || '', placeholder: 'Ex.: Concorrentes da manhã', maxlength: 80 });
  const instr = h('textarea', { class: 'ent', rows: 6, style: { minHeight: '120px', fontFamily: 'var(--sans)', fontSize: '14px' }, placeholder: 'O que ele faz, como se fosse uma mensagem sua. Ex.: "Veja os anúncios novos dos concorrentes da Kellen na biblioteca do Meta e me mande um resumo com os 3 melhores."' }, r?.instrucao || '');
  const tipo = h('select', { class: 'ent' }, [['diario', 'Todo dia'], ['semanal', 'Em dias da semana'], ['intervalo', 'A cada X horas'], ['manual', 'Só quando eu disparar']].map(([v, t]) => h('option', { value: v, selected: q.tipo === v }, t)));
  const hora = h('input', { class: 'ent', type: 'time', value: q.hora || '09:00' });
  const horas = h('input', { class: 'ent', type: 'number', min: 1, max: 168, value: q.horas || 6 });
  const dias = new Set(q.dias?.length ? q.dias : [1, 2, 3, 4, 5]);
  const diasEl = h('div', { class: 'dias' });
  const desenharDias = () => diasEl.replaceChildren(...['D', 'S', 'T', 'Q', 'Q', 'S', 'S'].map((l, i) => h('button', { class: dias.has(i) ? 'sel' : '', title: ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'][i], onclick: () => { dias.has(i) ? dias.delete(i) : dias.add(i); desenharDias(); } }, l)));
  desenharDias();
  const campoHora = h('label', { class: 'campo' }, 'Hora', hora);
  const campoDias = h('div', { class: 'campo' }, 'Dias', diasEl);
  const campoHoras = h('label', { class: 'campo' }, 'A cada quantas horas', horas);
  const mostrar = () => { campoHora.hidden = !['diario', 'semanal'].includes(tipo.value); campoDias.hidden = tipo.value !== 'semanal'; campoHoras.hidden = tipo.value !== 'intervalo'; };
  tipo.onchange = mostrar; mostrar();
  const ativa = alternar(r ? r.ativa : true, () => {});
  const dados = () => ({ nome: nome.value.trim(), instrucao: instr.value.trim(), ativa: ativa.querySelector('input').checked, quando: { tipo: tipo.value, hora: hora.value, dias: [...dias], horas: Number(horas.value) } });
  const salvar = tenta(async () => {
    if (r) await api('PATCH', `/api/rotinas/${r.id}`, dados());
    else await api('POST', '/api/rotinas', { bot: botId, ...dados() });
    fecharModal(); aviso('Rotina salva'); renderInfo(botId);
  });
  modal(cabModal(r ? 'Rotina' : 'Nova rotina'),
    h('label', { class: 'campo', style: { marginTop: '10px' } }, 'Nome', nome),
    h('label', { class: 'campo' }, 'Instrução', instr),
    h('label', { class: 'campo' }, 'Quando', tipo), campoHora, campoDias, campoHoras,
    h('div', { class: 'chave' }, h('div', { class: 'txt' }, h('b', {}, 'Ligada'), h('small', {}, 'Desligada, ela não roda no horário (o botão "Rodar agora" ainda funciona).')), ativa),
    r ? h('details', { class: 'link-rotina' }, h('summary', {}, 'Link de disparo (webhook)'),
      h('p', { class: 'dica' }, 'Um POST neste endereço roda a rotina; o JSON enviado vai junto para o bot. Para serviços de fora alcançarem, o Cloudflare Access precisa liberar o caminho /api/gatilho/.'),
      h('code', { class: 'excluir-cmd' }, r.link)) : null,
    h('div', { class: 'acoes-lin', style: { marginTop: '16px' } },
      h('button', { class: 'btn prim', onclick: salvar }, 'Salvar'),
      r ? h('button', { class: 'btn', onclick: tenta(async () => { const x = await api('POST', `/api/rotinas/${r.id}/rodar`); aviso(x.ok ? 'Rotina na fila do bot' : `Não rodou: ${x.motivo}`); fecharModal(); }) }, 'Rodar agora') : null,
      r ? h('button', { class: 'btn perigo', onclick: tenta(async () => { if (!confirm(`Apagar a rotina "${r.nome}"? Isso não tem volta.`)) return; await api('DELETE', `/api/rotinas/${r.id}`); fecharModal(); renderInfo(botId); }) }, 'Apagar') : null));
  if (!r) setTimeout(() => nome.focus(), 50);
}

function modalModelo(botId, nome) {
  const nomeI = h('input', { class: 'ent', value: nome || '', placeholder: 'Nome do modelo (ex.: Anúncio)', maxlength: 60 });
  const texto = h('textarea', { class: 'ent', rows: 16, placeholder: '# Anúncio\n\n- Gancho nos 3 primeiros segundos\n- …' });
  const salvar = tenta(async () => {
    if (!nomeI.value.trim()) throw new Error('Dê um nome ao modelo.');
    if (nome) await api('PUT', `/api/bots/${botId}/modelos/${encodeURIComponent(nome)}`, { nome: nomeI.value.trim(), texto: texto.value });
    else await api('POST', `/api/bots/${botId}/modelos`, { nome: nomeI.value.trim(), texto: texto.value });
    fecharModal(); aviso('Modelo salvo', 'O bot passa a seguir a partir da próxima sessão.'); renderInfo(botId);
  });
  modal(cabModal(nome ? 'Modelo' : 'Novo modelo'),
    h('label', { class: 'campo', style: { marginTop: '10px' } }, 'Nome', nomeI),
    h('label', { class: 'campo' }, 'Conteúdo (markdown)', texto),
    h('div', { class: 'acoes-lin' }, h('button', { class: 'btn prim', onclick: salvar }, 'Salvar'),
      nome ? h('button', { class: 'btn perigo', onclick: tenta(async () => { if (!confirm(`Tirar o modelo "${nome}"? O arquivo fica guardado como .antigo na pasta do bot.`)) return; await api('DELETE', `/api/bots/${botId}/modelos/${encodeURIComponent(nome)}`); fecharModal(); renderInfo(botId); }) }, 'Tirar modelo') : null));
  if (nome) api('GET', `/api/bots/${botId}/modelos/${encodeURIComponent(nome)}`).then((m) => { texto.value = m.texto; }).catch(() => {});
  else setTimeout(() => nomeI.focus(), 50);
}

// ---------- tarefas: criar e abrir ----------
function seletorBot(squadId, atual) {
  return h('select', { class: 'ent' }, h('option', { value: '' }, 'Ninguém ainda'),
    S.estado.bots.filter((x) => x.squad === squadId).map((x) => h('option', { value: x.id, selected: x.id === atual }, x.nome)));
}

function modalNovaTarefa({ squad: squadId, bot: botId = '', status = 'afazer' }) {
  const titulo = h('input', { class: 'ent', placeholder: 'O que precisa ser feito', maxlength: 200 });
  const desc = h('textarea', { class: 'ent', rows: 5, style: { minHeight: '110px' }, placeholder: 'Objetivo e contexto: links, arquivos, decisões…' });
  const pronto = h('input', { class: 'ent', placeholder: 'Pronto quando… (opcional)' });
  const resp = seletorBot(squadId, botId);
  const enviarJa = h('input', { type: 'checkbox', checked: !!botId });
  const criar = tenta(async () => {
    const t = await api('POST', '/api/tarefas', { squad: squadId, bot: resp.value || null, titulo: titulo.value, descricao: desc.value, entregaveis: pronto.value, status, enviar: enviarJa.checked && !!resp.value });
    fecharModal();
    aviso(`Tarefa #${t.id} criada`, enviarJa.checked && resp.value ? `Enviada para ${bot(resp.value)?.nome}.` : '');
  });
  titulo.addEventListener('keydown', (e) => { if (e.key === 'Enter') criar(); });
  modal(cabModal('Nova tarefa'),
    h('label', { class: 'campo', style: { marginTop: '10px' } }, 'Título', titulo),
    h('label', { class: 'campo' }, 'Descrição', desc),
    h('label', { class: 'campo' }, 'Pronto quando', pronto),
    h('label', { class: 'campo' }, 'Responsável', resp),
    h('label', { class: 'linha-check' }, enviarJa, 'Enviar para o bot começar agora'),
    h('div', { class: 'acoes-lin', style: { marginTop: '16px' } }, h('button', { class: 'btn prim', onclick: criar }, 'Criar tarefa'), h('button', { class: 'btn', onclick: fecharModal }, 'Cancelar')));
  setTimeout(() => titulo.focus(), 50);
}

async function modalTarefa(id) {
  const r = await api('GET', `/api/tarefas/${id}`).catch((e) => { aviso('Erro', e.message, { erro: true }); return null; });
  if (!r) return;
  const t = r.tarefa;
  const titulo = h('input', { class: 'ent av-nome', value: t.titulo, style: { textAlign: 'left', fontSize: '17px' } });
  const desc = h('textarea', { class: 'ent', rows: 5, style: { minHeight: '100px' } }, t.descricao);
  const pronto = h('input', { class: 'ent', value: t.entregaveis, placeholder: 'Pronto quando…' });
  const resp = seletorBot(t.squad, t.bot);
  let status = t.status;
  const seg = h('div', { class: 'segmento' });
  const desenharSeg = () => seg.replaceChildren(...Object.entries(ROTULO_STATUS).map(([k, n]) => h('button', { class: k === status ? 'sel' : '', onclick: () => { status = k; desenharSeg(); } }, n)));
  desenharSeg();
  const nota = h('input', { class: 'ent', placeholder: 'Escrever uma nota…' });
  const autor = (a) => (a === 'usuario' ? 'Você' : bot(a)?.nome || a);
  const historico = h('div', { class: 'historico' }, r.eventos.slice().reverse().map((e) => h('div', { class: `ev ${e.tipo}` },
    h('small', {}, `${autor(e.autor)} · ${quando(e.criado)}`), e.tipo === 'nota' ? h('div', { class: 'md', html: md(e.texto) }) : h('span', {}, ({ criada: 'criou a tarefa', status: `moveu: ${e.texto}`, enviada: `enviou ${e.texto}`, repasse: e.texto }[e.tipo] || e.texto)))));
  const salvar = async () => api('PATCH', `/api/tarefas/${id}`, { titulo: titulo.value, descricao: desc.value, entregaveis: pronto.value, bot: resp.value || null, status });
  modal(cabModal(`Tarefa #${t.id}`),
    titulo,
    h('div', { style: { margin: '12px 0' } }, seg),
    h('label', { class: 'campo' }, 'Responsável', resp),
    h('label', { class: 'campo' }, 'Descrição', desc),
    h('label', { class: 'campo' }, 'Pronto quando', pronto),
    r.pasta ? h('p', { class: 'dica', style: { marginTop: '-6px' } }, 'Pasta: ', h('code', {}, r.pasta)) : null,
    h('div', { class: 'acoes-lin' },
      h('button', { class: 'btn prim', onclick: tenta(async () => { await salvar(); fecharModal(); aviso('Tarefa salva'); }) }, 'Salvar'),
      h('button', { class: 'btn', onclick: tenta(async () => { await salvar(); const x = await api('POST', `/api/tarefas/${id}/enviar`); fecharModal(); aviso(`Enviada para ${bot(x.bot)?.nome}`); }) }, 'Enviar para o bot'),
      h('button', { class: 'btn perigo', onclick: tenta(async () => { if (!confirm(`Apagar a tarefa #${t.id} "${t.titulo}" e o histórico dela? Não tem volta.`)) return; await api('DELETE', `/api/tarefas/${id}`); fecharModal(); }) }, 'Apagar')),
    h('h2', { class: 'sec' }, 'Histórico'),
    h('div', { class: 'acoes-lin', style: { flexWrap: 'nowrap', marginBottom: '10px' } }, nota,
      h('button', { class: 'btn', onclick: tenta(async () => { if (!nota.value.trim()) return; await api('POST', `/api/tarefas/${id}/notas`, { texto: nota.value }); modalTarefa(id); }) }, 'Anotar')),
    historico);
}

function blocoArquivo(meta) {
  const url = `/api/arquivo/${meta.token}`;
  const ext = (meta.nome.split('.').pop() || '').toLowerCase();
  const midia = ['mp4', 'mov', 'webm', 'm4v'].includes(ext) ? h('video', { src: url, controls: true, preload: 'metadata', playsinline: true })
    : ['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext) ? h('img', { src: url, alt: meta.nome, loading: 'lazy' }) : null;
  return h('div', { class: 'arquivo' }, midia,
    meta.legenda ? h('div', { class: 'dica' }, meta.legenda) : null,
    h('div', { class: 'linha' }, ic('documento', 16), h('span', {}, meta.nome), h('small', { class: 'dica' }, mb(meta.tamanho || 0)),
      h('a', { class: 'btn min', href: url, target: '_blank' }, 'Abrir'), h('a', { class: 'btn min', href: `${url}?baixar=1` }, 'Baixar')));
}

// Nome humano de cada ação do bot ("Lendo roteiro.md", "Pesquisando…").
function acaoHumana(nome = '', resumo = '') {
  const arq = (x) => String(x || '').split(/[\\/]/).pop();
  const r = String(resumo || '');
  const n = nome.replace(/^mcp__/, '');
  const fixo = {
    Read: `Lendo ${arq(r)}`, Write: `Escrevendo ${arq(r)}`, Edit: `Editando ${arq(r)}`, MultiEdit: `Editando ${arq(r)}`, NotebookEdit: `Editando ${arq(r)}`,
    Bash: r ? `Rodando: ${r}` : 'Rodando um comando', PowerShell: r ? `Rodando: ${r}` : 'Rodando um comando', Grep: `Procurando "${r}"`, Glob: `Procurando arquivos ${r}`,
    WebSearch: `Pesquisando ${r}`, WebFetch: `Abrindo ${r}`, Task: `Subagente: ${r}`, Agent: `Subagente: ${r}`, Skill: `Usando a skill ${r}`,
    TodoWrite: 'Organizando as etapas', ToolSearch: 'Carregando ferramentas',
  }[nome];
  if (fixo) return fixo.trim();
  if (n.startsWith('navegador__')) return `Navegador: ${(n.split('__')[1] || '').replace(/^browser_/, '').replace(/_/g, ' ')}`;
  if (n.startsWith('flow__')) {
    const f = n.slice(6);
    return ({ memoria_adicionar: 'Guardou na memória', memoria_substituir: 'Atualizou a memória', usuario_atualizar: 'Guardou sobre você', funcao_atualizar: 'Atualizou a própria função',
      tarefa_criar: `Criou tarefa ${r}`, tarefa_atualizar: 'Atualizou a tarefa', bot_enviar: `Falou com @${r}`, arquivo_entregar: `Entregou ${arq(r)}`, historico_buscar: 'Procurando no histórico',
      navegador_ligar: 'Abrindo o navegador', navegador_assumir: 'Pediu você no navegador', atlas_ligar: 'Ligando o Atlas', tarefas_aguardar: 'Esperando os colegas', rotina_criar: 'Criou uma rotina' }[f] || f.replace(/_/g, ' ')).trim();
  }
  return `${n.replace(/__/g, ' › ')} ${r}`.trim();
}

// "Trabalhando nisso…": o planeta do bot sobe, o anel se desenha em volta, ele cresce um pouco e fica flutuando.
// O elemento fica fora da lista de mensagens para a animação não recomeçar a cada mensagem nova.
// Aparece quando a mensagem sai e some no mesmo instante em que a resposta começa a aparecer (e não volta nessa
// resposta). Cada resposta nova (turno novo) ganha a sua entrada.
function indicadorTrabalho(b, ativo, acao) {
  const el = $('#indicador');
  if (!el) return;
  if (!ativo) { if (el.dataset.chave) { el.replaceChildren(); el.dataset.chave = ''; } return; }
  const chave = `${b.id}:${b.desde || 'pendente'}`;
  // a entrada que começou no clique (pendente) continua quando o turno de verdade começa: não recomeça a animação
  if (el.dataset.chave === `${b.id}:pendente` && b.desde) el.dataset.chave = chave;
  if (el.dataset.chave !== chave) {
    el.dataset.chave = chave;
    el.replaceChildren(h('div', { class: 'trabalho-vivo' },
      h('span', { class: 'planeta-vivo', html: avatarSVG(avatarDe(b), { tamanho: 40, animado: true }) }),
      h('div', { class: 'trab-txt' }, h('span', { class: 'trab-tit' }, 'Trabalhando nisso', h('i', { class: 'pontinhos' }, h('b', {}, '.'), h('b', {}, '.'), h('b', {}, '.'))),
        h('small', { class: 'trab-acao' }))));
  }
  const ac = el.querySelector('.trab-acao');
  if (ac) ac.textContent = acao || (b.esperandoPesado ? `esperando a vez (${b.esperandoPesado})` : '');
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
  // Ações seguidas do bot viram uma linha só ("5 etapas · Memórias: 1 salva · 2 subagentes"); clicar abre a lista.
  const fecharGrupo = (aoVivo = false) => {
    if (!grupo) return;
    const topo = grupo.filter((m) => !m.meta?.sub);
    if (!topo.length) { grupo = null; return; }
    const nome = (m) => m.meta?.nome || '';
    const conta = (f) => topo.filter(f).length;
    const subag = conta((m) => ['Task', 'Agent'].includes(nome(m)));
    const memorias = conta((m) => /flow__memoria_(adicionar|substituir)|flow__usuario_atualizar/.test(nome(m)));
    const repasses = conta((m) => /flow__(tarefa_criar|bot_enviar)/.test(nome(m)));
    const erros = conta((m) => m.erro);
    const partes = [`${topo.length} ${topo.length === 1 ? 'etapa' : 'etapas'}`];
    if (memorias) partes.push(`Memórias: ${memorias} ${memorias === 1 ? 'salva' : 'salvas'}`);
    if (subag) partes.push(`${subag} ${subag === 1 ? 'subagente' : 'subagentes'}`);
    if (repasses) partes.push(`${repasses} ${repasses === 1 ? 'repasse' : 'repasses'}`);
    if (erros) partes.push(`${erros} com erro`);
    const lista = h('div', { class: 'etapas' }, topo.map((m) => h('div', { class: `ferr${m.erro ? ' erro' : ''}`, title: `${nome(m)} ${m.meta?.resumo || ''}` }, acaoHumana(nome(m), m.meta?.resumo))));
    const chave = topo[0].id;
    const det = h('details', { class: 'resumo-trab', open: S.abertos.has(chave), ontoggle: () => (det.open ? S.abertos.add(chave) : S.abertos.delete(chave)) },
      h('summary', {}, h('span', {}, partes.join(' · ')), ic('direita', 13)), lista);
    nos.push(det);
    if (aoVivo) acaoAgora = acaoHumana(nome(topo.at(-1)), topo.at(-1).meta?.resumo);
    grupo = null;
  };
  const trabalhando = b.status === 'trabalhando';
  // mensagem acabou de sair e o turno ainda não começou: o planeta já entra (some sozinho em 30 s se nada vier)
  const pendente = !trabalhando && Date.now() - (S.pendente.get(b.id) || 0) < 30000;
  let acaoAgora = '';
  for (const m of lista) {
    if (m.papel === 'ferramenta') { (grupo ||= []).push(m); continue; }
    fecharGrupo();
    if (m.papel === 'progresso') {
      nos.push(h('div', { class: 'msg progresso' }, h('span', { class: 'ok-prog' }, ic('check', 13)), m.texto));
      continue;
    }
    if (m.papel === 'rotina') {
      nos.push(h('div', { class: 'msg rotina' }, h('div', { class: 'de' }, ic('relogio', 13), `Rotina · ${m.meta?.deNome || ''}`), h('div', { class: 'md', html: md(m.texto) })));
      continue;
    }
    if (m.papel === 'usuario') {
      if (m.meta?.sala) nos.push(h('div', { class: 'via-sala' }, 'pela sala do squad'));
      nos.push(h('div', { class: 'msg usuario' }, m.texto, m.meta?.anexos?.length ? h('div', { class: 'anexos' }, m.meta.anexos.map((a) => h('span', { class: 'anexo' }, ic('anexo', 13), h('span', {}, a.nome)))) : null));
    } else if (m.papel === 'bot') {
      nos.push(h('div', { class: 'msg bot md', html: md(m.texto) }));
    } else if (m.papel === 'entrada') {
      nos.push(h('div', { class: 'msg entrada' }, h('div', { class: 'de' }, ic('entrada', 13), `@${m.meta?.deNome || bot(m.de)?.nome || m.de}${m.meta?.aguardar ? ' (esperando resposta)' : ''}`), h('div', { class: 'md', html: md(m.texto) })));
    } else if (m.papel === 'arquivo') {
      nos.push(blocoArquivo(m.meta || {}));
    } else {
      nos.push(h('div', { class: 'msg sistema' }, m.texto));
    }
  }
  fecharGrupo(trabalhando && !S.deltas.get(b.id));
  for (const ap of (S.estado.aprovacoes || []).filter((a) => a.bot === b.id)) nos.push(cartaoAprovacao(ap));
  const delta = S.deltas.get(b.id);
  if (delta) nos.push(h('div', { class: 'msg bot md digitando', html: md(delta) }));

  if (!lista.length && !delta) {
    const t = template(b.template);
    nos.push(h('div', { class: 'vazio' }, iconeBot(b, 88), h('p', {}, `Converse com ${b.nome}.`),
      h('p', { class: 'dica' }, t?.id === 'em-branco' ? 'Comece dizendo a função dele: "Sua função é…". Ele grava e lembra em todas as sessões.' : t?.descricao || '')));
  }
  cont.replaceChildren(...nos);
  // a resposta começou (texto chegando, ou já veio texto do bot neste turno): o planeta sai na hora
  const respondeu = !!delta || (b.desde && lista.some((m) => m.papel === 'bot' && m.criado >= b.desde));
  indicadorTrabalho(b, (trabalhando || pendente) && !respondeu, acaoAgora);
  if (noFim) caixa.scrollTop = caixa.scrollHeight;
}

const decidir = (ap, permitir) => tenta(async () => {
  await api('POST', `/api/aprovacoes/${ap.id}`, { permitir });
  if (S.modalExclusao === ap.id) fecharModal();
  await recarregarEstado(); if (S.rota.tela === 'bot') renderMsgs(); if (S.rota.tela === 'aprovacoes') renderAprovacoes();
})();

function cartaoAprovacao(ap) {
  if (ap.tipo === 'navegador') {
    return h('div', { class: 'aprovacao navegador' },
      h('b', { class: 'com-ic' }, ic('globo', 16), `${ap.botNome} precisa de você no navegador`),
      h('div', {}, ap.resumo), ap.url ? h('small', { class: 'dica' }, ap.url) : null,
      h('div', { class: 'acoes-lin' },
        h('button', { class: 'btn', onclick: tenta(async () => { await api('POST', `/api/navegador/${encodeURIComponent(ap.perfil)}/abrir`, { url: ap.url || '' }); aviso('Navegador aberto', 'A janela abre no computador. Faça o que ele pediu e volte aqui.'); }) }, 'Abrir navegador'),
        h('button', { class: 'btn prim', onclick: () => decidir(ap, true) }, 'Pronto, pode continuar'),
        h('button', { class: 'btn', onclick: () => decidir(ap, false) }, 'Agora não')),
      h('small', { class: 'dica' }, 'A janela do navegador dos bots abre no computador. Pelo celular, só dá para responder.'));
  }
  if (ap.tipo === 'exclusao') {
    return h('div', { class: 'aprovacao exclusao' },
      h('b', { class: 'com-ic' }, ic('lixeira', 16), `${ap.botNome} quer excluir`), h('code', {}, ap.resumo),
      h('div', { class: 'acoes-lin' },
        h('button', { class: 'btn excluir', onclick: () => decidir(ap, true) }, 'Excluir'),
        h('button', { class: 'btn', onclick: () => decidir(ap, false) }, 'Não excluir')));
  }
  return h('div', { class: 'aprovacao' },
    h('b', { class: 'com-ic' }, ic('cadeado', 16), `${ap.botNome} quer usar ${ap.ferramenta}`), h('code', {}, ap.resumo),
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
  // Enviar sempre envia (com o bot ocupado, a mensagem entra na fila). Enquanto ele trabalha, aparece ao lado o botão
  // de parar o que está rodando agora.
  const botao = h('button', { class: 'enviar', id: 'botao-enviar', title: 'Enviar', onclick: () => enviar() }, h('span', { class: 'ic', html: icone('enviar', 18) }));
  const botaoParar = h('button', { class: 'enviar parar', title: 'Parar o que ele está fazendo agora', 'aria-label': 'Parar', onclick: () => parar() }, h('span', { class: 'ic', html: icone('parar', 16, { preenchido: true }) }));
  const atualizarBotao = () => {
    const bb = bot(b.id);
    botaoParar.hidden = bb?.status !== 'trabalhando';
    botao.disabled = !ta.value.trim() && !S.anexos.length;
    renderFila(bb);
    S.atualizarContexto?.();
  };
  const mic = botaoMicrofone(ta, (f) => subir(f), () => { ajustar(); atualizarBotao(); localSet(`rascunho:${b.id}`, ta.value); });
  ta.addEventListener('input', atualizarBotao);
  atualizarBotao();
  S.atualizarBotao = atualizarBotao;

  function renderAnexos() {
    anexos.replaceChildren(...S.anexos.map((a, i) => h('span', { class: 'anexo' }, ic('anexo', 13), h('span', {}, a.nome),
      a.token ? null : h('span', { class: 'prog' }, h('i', { style: { width: `${a.pct || 0}%` } })),
      h('button', { class: 'btn-txt', style: { fontSize: '13px', padding: '0 2px' }, onclick: () => { S.anexos.splice(i, 1); renderAnexos(); atualizarBotao(); } }, ic('fechar', 13)))));
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
    // limpa já (dá para escrever a próxima enquanto esta é enviada); se falhar, o texto volta
    const tokens = S.anexos.map((a) => a.token);
    const anexosAntes = S.anexos;
    ta.value = ''; localSet(`rascunho:${b.id}`, ''); S.anexos = []; renderAnexos(); ajustar(); atualizarBotao();
    // a mensagem aparece no chat na hora (sem esperar a ida e volta ao servidor, que pelo Cloudflare leva segundos);
    // quando a de verdade chega pelo tempo real, ela toma o lugar desta
    const provisoria = { id: `p${Date.now()}`, provisoria: true, papel: 'usuario', texto: texto || '(veja os anexos)', meta: { anexos: anexosAntes.map((a) => ({ nome: a.nome })) }, criado: Date.now() };
    if (!S.msgs.has(b.id)) S.msgs.set(b.id, []);
    S.msgs.get(b.id).push(provisoria);
    if (bot(b.id)?.status !== 'trabalhando') S.pendente.set(b.id, Date.now());
    renderMsgs(true);
    try { await api('POST', `/api/bots/${b.id}/mensagens`, { texto, anexos: tokens }); }
    catch (e) {
      const l = S.msgs.get(b.id); l.splice(l.indexOf(provisoria), 1); S.pendente.delete(b.id); renderMsgs();
      if (!ta.value) ta.value = texto; S.anexos = anexosAntes; renderAnexos(); ajustar(); atualizarBotao(); throw e;
    }
  });
  const parar = tenta(() => api('POST', `/api/bots/${b.id}/parar`, {}));

  return h('div', { class: 'compositor' }, h('div', { class: 'estreito' },
    h('div', { class: 'fila-painel', id: 'fila-painel' }),
    h('div', { class: 'caixa', ondragover: (e) => e.preventDefault(), ondrop: (e) => { e.preventDefault(); for (const f of e.dataTransfer.files) subir(f); } },
      anexos, ta,
      h('div', { class: 'linha' },
        h('button', { class: 'btn-txt', title: 'Anexar arquivo (vídeo, roteiro…)', onclick: () => arquivo.click() }, ic('mais', 20)), arquivo,
        seletorModelo(b), seletorContexto(b),
        h('span', { class: 'esp', id: 'fila-info' }),
        mic, botaoParar, botao))));
}

// "Contexto X%": quanto da janela de contexto a sessão atual ocupa. Clicando abre o detalhe (fixo × conversa × livre)
// e os botões de compactar agora ou começar uma sessão limpa.
const mil = (n) => (n >= 1000 ? `${Math.round(n / 1000)} mil` : String(n || 0));
function seletorContexto(b) {
  const pctDe = (bb) => Math.min(100, Math.round(((bb.ctxTokens || 0) / (S.estado.config.memoria.contextoMax || 200000)) * 100));
  const anel = h('span', { class: 'anel-ctx' });
  const txt = h('span', {});
  const bt = h('button', { class: 'seletor-modelo seletor-ctx', title: 'Contexto da sessão' }, anel, txt);
  const atualizar = () => {
    const bb = bot(b.id) || b;
    const pct = pctDe(bb);
    txt.textContent = `Contexto ${pct}%`;
    anel.style.setProperty('--pct', `${pct}%`);
    bt.classList.toggle('alto', pct >= Math.round((S.estado.config.memoria.compactarEm || 0.6) * 100) - 10);
  };
  atualizar();
  S.atualizarContexto = atualizar;
  bt.onclick = async (e) => {
    e.stopPropagation();
    if ($('#menu-pop')) return fecharMenu();
    const d = await api('GET', `/api/bots/${b.id}/contexto`).catch(() => null);
    if (!d) return;
    const bb = bot(b.id) || b;
    const pct = (n) => `${Math.min(100, (n / d.maximo) * 100)}%`;
    const conversa = Math.max(0, d.usado - d.base);
    const livre = Math.max(0, d.maximo - d.usado);
    const quando = d.inicio ? new Date(d.inicio).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : null;
    const compactar = tenta(async () => {
      fecharMenu();
      const r = await api('POST', `/api/bots/${b.id}/compactar`);
      aviso(r.ok ? 'Compactando a sessão' : 'Nada para compactar', r.ok ? 'Ele resume a sessão; a próxima mensagem já começa leve.' : 'Esta sessão ainda está vazia.');
    });
    const limpa = tenta(async () => {
      if (!confirm(`Começar uma sessão limpa para ${bb.nome}, sem resumo da conversa atual? A função, a memória e os resumos anteriores continuam.`)) return;
      fecharMenu();
      await api('POST', `/api/bots/${b.id}/nova-sessao`);
      bb.ctxTokens = 0; atualizar();
      aviso('Sessão limpa', 'A próxima mensagem começa do zero (com a função e a memória).');
    });
    const m = h('div', { class: 'menu-pop menu-ctx', id: 'menu-pop', role: 'dialog', style: `--bolha: ${corDoPlaneta(avatarDe(bb).planeta)}`, onclick: (ev) => ev.stopPropagation() },
      h('div', { class: 'ctx-cab' }, h('b', {}, 'Contexto da sessão'), h('span', {}, `${Math.round((d.usado / d.maximo) * 100)}%`)),
      h('div', { class: 'ctx-barra' },
        h('i', { class: 'fixo', style: { width: pct(d.base) } }), h('i', { class: 'conversa', style: { width: pct(conversa) } }),
        h('b', { class: 'limite-ctx', style: { left: `${d.compactarEm * 100}%` }, title: 'Compacta sozinho aqui' })),
      h('div', { class: 'ctx-legenda' },
        h('div', {}, h('i', { class: 'fixo' }), h('span', {}, 'Fixo de toda sessão'), h('small', {}, mil(d.base))),
        h('div', {}, h('i', { class: 'conversa' }), h('span', {}, 'Esta conversa'), h('small', {}, mil(conversa))),
        h('div', {}, h('i', { class: 'livre' }), h('span', {}, 'Livre'), h('small', {}, `${mil(livre)} de ${mil(d.maximo)}`))),
      h('p', { class: 'ctx-nota' }, d.sessao
        ? `${d.turnos} ${d.turnos === 1 ? 'mensagem' : 'mensagens'} nesta sessão${quando ? `, desde ${quando}` : ''}. "Fixo" são as instruções, as ferramentas dos conectores, a função e a memória: toda sessão começa com ele.`
        : 'Sessão vazia: a próxima mensagem começa uma nova.'),
      h('p', { class: 'ctx-nota' }, `Compacta sozinho em ${Math.round(d.compactarEm * 100)}% ou depois de ${d.compactarDias} dias.`),
      h('div', { class: 'ctx-acoes' },
        h('button', { class: 'btn prim', disabled: !d.sessao, onclick: compactar }, 'Compactar agora'),
        h('button', { class: 'btn', disabled: !d.sessao || d.ocupado, title: d.ocupado ? 'Espere ele terminar' : '', onclick: limpa }, 'Sessão limpa')),
      h('p', { class: 'ctx-nota' }, 'Compactar resume a sessão e começa uma nova com o resumo, a função e a memória (nada importante se perde). Sessão limpa começa do zero, sem o resumo desta conversa.'));
    document.body.append(m);
    const r = bt.getBoundingClientRect();
    m.style.left = `${Math.max(8, Math.min(r.left, innerWidth - m.offsetWidth - 8))}px`;
    m.style.top = `${Math.max(8, r.top - m.offsetHeight - 8)}px`;
  };
  return bt;
}

// Modelo e esforço do bot, escolhidos ao lado do "+". Vale a partir da próxima mensagem e fica salvo no bot.
const MODELOS = [
  ['fable', 'Fable 5.1', 'O mais capaz, para o trabalho mais difícil'],
  ['opus', 'Opus 5.5', 'Raciocínio forte para trabalho complexo'],
  ['sonnet', 'Sonnet 5.5', 'Equilíbrio entre qualidade e velocidade'],
  ['haiku', 'Haiku 5.5', 'O mais rápido, para tarefas simples'],
];
const ESFORCOS = [['low', 'Baixo'], ['medium', 'Médio'], ['high', 'Alto'], ['xhigh', 'Extra'], ['max', 'Máximo']];
function seletorModelo(b) {
  const rotulo = () => {
    const bb = bot(b.id) || b;
    const m = bb.modelo || S.estado.config.modeloPadrao || 'sonnet';
    const nome = (MODELOS.find(([v]) => v === m)?.[1] || m).replace(/ [\d.]+$/, '');
    const esf = ESFORCOS.find(([v]) => v === bb.esforco)?.[1];
    return esf ? `${nome} · ${esf}` : nome;
  };
  const bt = h('button', { class: 'seletor-modelo', title: 'Modelo de IA deste bot' }, h('span', {}, rotulo()), ic('baixo', 12));
  const mudar = (campos, { fechar = true } = {}) => tenta(async () => {
    if (fechar) fecharMenu();
    Object.assign(bot(b.id) || b, campos);
    bt.firstChild.textContent = rotulo();
    atualizarTopoBot();
    await salvarBot(b.id, campos);
  })();
  bt.onclick = (e) => {
    e.stopPropagation();
    if ($('#menu-pop')) return fecharMenu();
    const bb = bot(b.id) || b;
    const atual = bb.modelo || S.estado.config.modeloPadrao || 'sonnet';
    // Esforço: um controle deslizante (Padrão → Máximo) preenchido com um degradê na cor do planeta do bot.
    const niveis = [['', 'Padrão'], ...ESFORCOS];
    const idx = Math.max(0, niveis.findIndex(([v]) => v === (bb.esforco || '')));
    const valor = h('span', { class: 'esforco-valor' }, niveis[idx][1]);
    const faixa = h('input', { type: 'range', class: 'esforco-faixa', min: 0, max: niveis.length - 1, step: 1, value: idx, 'aria-label': 'Esforço de raciocínio' });
    const pintar = () => { const i = Number(faixa.value); faixa.style.setProperty('--pct', `${(i / (niveis.length - 1)) * 100}%`); valor.textContent = niveis[i][1]; };
    faixa.addEventListener('input', pintar);
    faixa.addEventListener('change', () => mudar({ esforco: niveis[Number(faixa.value)][0] }, { fechar: false }));
    pintar();
    const m = h('div', { class: 'menu-pop menu-modelo', id: 'menu-pop', role: 'menu', style: `--bolha: ${corDoPlaneta(avatarDe(bb).planeta)}`, onclick: (ev) => ev.stopPropagation() },
      ...MODELOS.map(([v, nome, desc]) => h('button', { class: `menu-item${v === atual ? ' sel' : ''}`, onclick: () => mudar({ modelo: v }) },
        h('span', { class: 'txt' }, h('b', {}, nome), h('small', {}, desc)), v === atual ? h('span', { class: 'marca-sel' }, ic('check', 16)) : null)),
      h('div', { class: 'menu-sep' }),
      h('div', { class: 'esforco' }, h('div', { class: 'esforco-cab' }, h('span', {}, 'Esforço de raciocínio'), valor), faixa,
        h('div', { class: 'esforco-pontas' }, h('span', {}, 'Padrão'), h('span', {}, 'Máximo'))));
    document.body.append(m);
    const r = bt.getBoundingClientRect();
    m.style.left = `${Math.max(8, Math.min(r.left, innerWidth - m.offsetWidth - 8))}px`;
    m.style.top = `${Math.max(8, r.top - m.offsetHeight - 8)}px`;
  };
  return bt;
}

// Fila do bot, em cima da caixa de mensagem: o que está esperando a vez, com tirar (×) e passar na frente (↑),
// e pausar/retomar a fila inteira (o que está rodando termina; o resto espera).
function renderFila(b) {
  const el = $('#fila-painel');
  if (!el || !b) return;
  const itens = b.filaItens || [];
  // só aparece com a fila pausada ou quando já tem algo rodando e mais mensagens esperando
  const ocupado = b.status === 'trabalhando' || b.esperandoPesado;
  if (!b.pausado && !(itens.length && ocupado)) { el.replaceChildren(); el.hidden = true; return; }
  el.hidden = false;
  const acao = (metodo, url) => tenta(() => api(metodo, url));
  el.replaceChildren(
    h('div', { class: 'fila-cab' },
      h('span', {}, b.pausado ? `Fila pausada${itens.length ? ` · ${itens.length} esperando` : ''}` : `Na fila · ${itens.length}`),
      h('button', { class: 'fila-acao', onclick: tenta(() => api('POST', `/api/bots/${b.id}/pausar`, { pausado: !b.pausado })) },
        ic(b.pausado ? 'play' : 'pausa', 13, { preenchido: b.pausado }), b.pausado ? 'Retomar' : 'Pausar fila')),
    ...itens.map((it, i) => h('div', { class: 'fila-item' },
      h('span', { class: 'txt' }, it.de ? h('small', {}, `${it.de} · `) : null, it.texto),
      i > 0 ? h('button', { class: 'btn-txt', title: 'Passar na frente', onclick: acao('POST', `/api/bots/${b.id}/fila/${it.id}/frente`) }, ic('cima', 14)) : null,
      h('button', { class: 'btn-txt', title: 'Tirar da fila', onclick: acao('DELETE', `/api/bots/${b.id}/fila/${it.id}`) }, ic('fechar', 14)))));
}

// Microfone: fala e vira texto na caixa (ditado do navegador, em português). Onde o navegador não tem ditado,
// grava o áudio e anexa à mensagem (o bot transcreve).
function botaoMicrofone(ta, anexar, aoMudar) {
  const Rec = window.SpeechRecognition || window.webkitSpeechRecognition;
  const bt = h('button', { class: 'btn-txt mic', title: Rec ? 'Falar (vira texto)' : 'Gravar áudio', 'aria-label': 'Microfone' }, ic('microfone', 19));
  let rec = null, gravador = null;
  const ligado = (on) => bt.classList.toggle('gravando', on);
  bt.onclick = async () => {
    if (rec) { rec.stop(); return; }
    if (gravador) { gravador.stop(); return; }
    if (Rec) {
      rec = new Rec();
      rec.lang = 'pt-BR'; rec.continuous = true; rec.interimResults = true;
      const base = ta.value ? `${ta.value.replace(/\s+$/, '')} ` : '';
      rec.onresult = (e) => {
        let txt = '';
        for (const r of e.results) txt += r[0].transcript;
        ta.value = base + txt.trim();
        aoMudar();
      };
      rec.onerror = (e) => { if (e.error === 'not-allowed') aviso('Microfone bloqueado', 'Libere o microfone para este site nas permissões do navegador.', { erro: true }); };
      rec.onend = () => { rec = null; ligado(false); ta.focus(); };
      rec.start(); ligado(true);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const partes = [];
      gravador = new MediaRecorder(stream);
      gravador.ondataavailable = (e) => partes.push(e.data);
      gravador.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const tipo = gravador.mimeType || 'audio/webm';
        const ext = tipo.includes('mp4') ? 'm4a' : 'webm';
        anexar(new File(partes, `audio-${new Date().toTimeString().slice(0, 8).replace(/:/g, '')}.${ext}`, { type: tipo }));
        gravador = null; ligado(false);
      };
      gravador.start(); ligado(true);
    } catch { aviso('Sem microfone', 'O navegador não deixou usar o microfone.', { erro: true }); }
  };
  return bt;
}

// ---------- painel do bot ----------
async function abrirPainel(botId, aba) {
  if (aba) S.painelAba = aba;
  S.conectorAberto = null;
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
  p.replaceChildren(h('div', { class: 'cab' }, h('button', { class: 'avatar-topo', title: 'Mudar a aparência', onclick: () => modalAparencia(b.id) }, iconeBot(b, 30)), h('b', {}, b.nome), h('button', { class: 'btn-txt', title: 'Fechar', onclick: fecharPainel }, ic('fechar', 18))), abasEl, corpo);
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
    const pesado = h('select', { class: 'ent' }, [['1', 'Pesado: edição, render, transcrição (um de cada vez no computador)'], ['', 'Leve: pode rodar junto com os outros']].map(([v, n]) => h('option', { value: v, selected: !!b.pesado === !!v }, n)));
    return [
      t?.preferencias?.length ? [h('h2', { class: 'sec', style: { marginTop: 0 } }, `Preferências do ${t.nome}`), ...campos] : null,
      h('h2', { class: 'sec' }, 'Como o bot roda'),
      h('label', { class: 'campo' }, 'Modelo', modelo),
      h('label', { class: 'campo' }, 'Esforço de raciocínio', esforco),
      h('label', { class: 'campo' }, 'Autonomia', autonomia),
      h('label', { class: 'campo' }, 'Tipo de trabalho', pesado),
      h('label', { class: 'campo' }, 'Navegador', navegador),
      h('label', { class: 'campo' }, 'Pastas de trabalho extras (uma por linha)', pastas),
      h('button', { class: 'btn prim', onclick: tenta(async () => {
        await salvarBot(b.id, { prefs, modelo: modelo.value, esforco: esforco.value, autonomia: autonomia.value, pesado: !!pesado.value, navegador: navegador.value, pastas: pastas.value.split('\n').map((x) => x.trim()).filter(Boolean) });
        aviso('Preferências salvas', 'Valem a partir da próxima mensagem.');
      }) }, 'Salvar'),
      h('h2', { class: 'sec' }, 'Outras preferências (texto livre)'),
      campoTexto('', d.preferencias, { linhas: 5, aoSalvar: (txt) => salvarArquivo(b.id, 'preferencias', txt) }),
    ];
  }
  if (aba === 'conectores') {
    const sq = squad(b.squad);
    const ids = new Set(sq?.conectores || []);
    const lista = S.estado.conectores.filter((c) => ids.has(c.id));
    return [
      h('p', { class: 'dica' }, `Os conectores são do squad: todos os bots de ${sq?.nome || 'um squad'} usam os mesmos.`),
      h('div', { class: 'cartao lista-con' }, lista.length
        ? lista.map((c) => linhaConector(c, { aoClicar: () => abrirConector(c.id), direita: ic('direita', 16) }))
        : h('p', { class: 'dica' }, 'Nenhum conector ligado neste squad.')),
      h('div', { class: 'acoes-lin', style: { marginTop: '12px' } }, h('button', { class: 'btn', onclick: () => { fecharPainel(); ir(`#/squad/${b.squad}`); } }, 'Escolher no squad')),
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
      h('button', { class: 'btn', onclick: tenta(async () => { await api('POST', `/api/bots/${b.id}/compactar`); aviso('Compactação na fila', 'O bot guarda a memória e o resumo, e a próxima mensagem abre uma sessão nova.'); }) }, ic('compactar', 15), 'Compactar agora'),
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
// Tudo do squad numa tela, em abas: Tarefas (kanban), Conversa entre os bots, Mural e Conectores.
const ABAS_SQUAD = [['sala', 'Sala'], ['tarefas', 'Tarefas'], ['mural', 'Mural'], ['conectores', 'Conectores']];
async function renderSquad(sq) {
  const p = $('#principal');
  const bs = S.estado.bots.filter((b) => b.squad === sq.id);
  let aba = localGet('abaSquad') || 'sala';
  if (!ABAS_SQUAD.some(([k]) => k === aba)) aba = 'sala';
  const corpo = h('div', { class: 'squad-corpo' }, h('div', { class: 'vazio' }, 'Carregando…'));
  p.replaceChildren(topo(`Squad ${sq.nome}`, `${bs.length} bot(s) · conversam entre si, nunca com outro squad`,
    h('button', { class: 'btn-txt', title: 'Novo bot neste squad', onclick: () => modalNovoBot(sq.id) }, ic('mais', 20)),
    h('button', { class: 'btn-txt', title: 'Renomear / apagar o squad', onclick: () => modalSquad(sq) }, ic('ajustes', 18))),
  h('div', { class: 'conteudo squad-pagina' },
    h('div', { class: 'squad-bots' }, bs.map((b) => h('a', { class: 'chip-bot', href: `#/bot/${b.id}`, title: subtituloBot(b) },
      h('span', { class: 'av' }, iconeBot(b, 24), h('i', { class: `ponto ${classeStatus(b)}` })), b.nome))),
    h('div', { class: 'abas-squad' }, ABAS_SQUAD.map(([k, n]) => h('button', { class: k === aba ? 'sel' : '', onclick: () => { localSet('abaSquad', k); renderSquad(sq); } }, n))),
    corpo));

  if (aba === 'tarefas') return renderKanban(sq, corpo);
  if (aba === 'conectores') {
    const ligados = new Set(sq.conectores || []);
    corpo.replaceChildren(h('div', { class: 'estreito largo' },
      h('p', { class: 'dica' }, 'Todos os bots deste squad usam os conectores ligados aqui. Ligue só o que o squad usa: cada conector ocupa contexto em toda mensagem.'),
      h('div', { class: 'grade-con' }, S.estado.conectores.map((c) => linhaConector(c, {
        direita: alternar(ligados.has(c.id), tenta(async (on) => {
          on ? ligados.add(c.id) : ligados.delete(c.id);
          await api('PUT', `/api/squads/${sq.id}/conectores`, { conectores: [...ligados] });
        })),
      })))));
    return;
  }
  const sala = await api('GET', `/api/squads/${sq.id}/sala`).catch(() => ({ mensagens: [], quadro: '' }));
  if (aba === 'mural') {
    const quadro = h('textarea', { class: 'ent', rows: 12 }, sala.quadro || '');
    corpo.replaceChildren(h('div', { class: 'estreito' },
      h('p', { class: 'dica' }, 'Opcional. Serve quando os bots trabalham juntos: objetivo do squad, combinados e decisões que valem para todos. Os bots leem no começo de cada sessão e também escrevem aqui. Tarefa de um bot só não precisa passar por aqui.'),
      h('label', { class: 'campo' }, quadro, h('div', { class: 'acoes-lin' }, h('button', { class: 'btn prim', onclick: tenta(async () => { await api('PUT', `/api/squads/${sq.id}/quadro`, { texto: quadro.value }); aviso('Mural salvo'); }) }, 'Salvar')))));
    return;
  }
  // Sala: você escreve uma vez; "@nome" chama alguém, "@todos" chama todos, e sem @ o Claude Flow escolhe quem
  // responde pelo assunto (a escolha aparece na conversa). As respostas e as conversas entre os bots ficam aqui.
  S.sala.set(sq.id, sala.mensagens);
  const lista = h('div', { class: 'estreito sala-lista', id: 'sala-lista' });
  const vivos = h('div', { class: 'estreito', id: 'sala-vivos' });
  const ta = h('textarea', { rows: 1, placeholder: bs.length > 1 ? 'Mensagem para o squad · @nome chama alguém, @todos chama todos' : 'Mensagem para o squad' });
  const ajustar = () => { ta.style.height = 'auto'; ta.style.height = `${Math.min(ta.scrollHeight, innerHeight * 0.35)}px`; };
  const enviarSala = tenta(async () => {
    const texto = ta.value.trim();
    if (!texto) return;
    ta.value = ''; ajustar();
    await api('POST', `/api/squads/${sq.id}/sala`, { texto });
  });
  ta.addEventListener('input', ajustar);
  ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !ehToque && !e.isComposing) { e.preventDefault(); enviarSala(); } });
  corpo.replaceChildren(h('div', { class: 'sala sobreposto' },
    h('div', { class: 'sala-rolagem rolagem-sob', id: 'sala-rolagem' }, lista, vivos),
    h('div', { class: 'compositor sala-compositor' }, h('div', { class: 'estreito' }, h('div', { class: 'caixa' }, ta,
      h('div', { class: 'linha' }, h('span', { class: 'esp' }), botaoMicrofone(ta, () => aviso('Na sala, o microfone só faz ditado'), ajustar),
        h('button', { class: 'enviar', title: 'Enviar', onclick: enviarSala }, h('span', { class: 'ic', html: icone('enviar', 18) }))))))));
  sobreporCompositor(corpo.querySelector('.sala'));
  renderSala(sq.id, true);
}

function renderSala(squadId, rolar = false) {
  const lista = $('#sala-lista');
  if (!lista) return;
  const caixa = $('#sala-rolagem');
  const noFim = rolar || caixa.scrollHeight - caixa.scrollTop - caixa.clientHeight < 120;
  const msgs = S.sala.get(squadId) || [];
  const nomeBot = (id) => bot(id)?.nome || id;
  lista.replaceChildren(...(msgs.length ? msgs.map((m) => {
    if (m.papel === 'usuario') return h('div', { class: 'msg usuario' }, m.texto);
    if (m.papel === 'roteamento') return h('div', { class: 'msg roteamento' }, ic('entrada', 13), m.texto);
    if (m.papel === 'sistema') return h('div', { class: 'msg sistema' }, m.texto);
    if (m.papel === 'entrada') {
      return h('div', { class: 'msg-bots entre' },
        h('div', { class: 'de' }, iconeBot(bot(m.de) || { id: m.de }, 18), h('b', {}, nomeBot(m.de) || m.meta?.deNome), h('span', { class: 'para' }, 'para'), h('b', {}, nomeBot(m.para)),
          h('small', {}, `${quando(m.criado)}${m.meta?.aguardar ? ' · esperando resposta' : ''}`)),
        h('details', {}, h('summary', {}, String(m.texto).replace(/\s+/g, ' ').slice(0, 140)), h('div', { class: 'md', html: md(m.texto) })));
    }
    return h('div', { class: 'msg-bots' },
      h('div', { class: 'de' }, h('a', { href: `#/bot/${m.de}`, class: 'quem' }, iconeBot(bot(m.de) || { id: m.de }, 22), h('b', {}, nomeBot(m.de))), h('small', {}, quando(m.criado))),
      h('div', { class: 'md', html: md(m.texto) }));
  }) : [h('div', { class: 'vazio' }, 'Escreva para o squad. Sem @, quem responde é escolhido pelo assunto; com @nome você chama alguém direto.')]));
  // quem está trabalhando agora neste squad
  const vivos = $('#sala-vivos');
  const ocupados = S.estado.bots.filter((b) => b.squad === squadId && b.status === 'trabalhando');
  const roteando = S.salaRoteando === squadId;
  const chave = `${roteando}|${ocupados.map((b) => b.id).join(',')}`;
  if (vivos && vivos.dataset.chave !== chave) {
    vivos.dataset.chave = chave;
    vivos.replaceChildren(
      ...(roteando ? [h('div', { class: 'msg roteamento' }, 'Escolhendo quem responde', h('i', { class: 'pontinhos' }, h('b', {}, '.'), h('b', {}, '.'), h('b', {}, '.')))] : []),
      ...ocupados.map((b) => h('div', { class: 'trabalho-vivo pequeno' }, h('span', { class: 'planeta-vivo', html: avatarSVG(avatarDe(b), { tamanho: 26, animado: true }) }),
        h('span', { class: 'trab-tit' }, `${b.nome} trabalhando`, h('i', { class: 'pontinhos' }, h('b', {}, '.'), h('b', {}, '.'), h('b', {}, '.'))))));
  }
  if (noFim) caixa.scrollTop = caixa.scrollHeight;
}

// Kanban: A fazer, Fazendo, Revisão, Feito. Arrastar muda de coluna; clicar abre a tarefa.
async function renderKanban(sq, corpo) {
  const r = await api('GET', `/api/squads/${sq.id}/tarefas`).catch(() => ({ tarefas: [], notas: {} }));
  if (S.rota.tela !== 'squad' || S.rota.id !== sq.id) return;
  const colunas = Object.entries(ROTULO_STATUS).map(([status, nome]) => {
    const ts = r.tarefas.filter((t) => t.status === status);
    const col = h('div', { class: `coluna-k ${status}` },
      h('div', { class: 'coluna-cab' }, h('span', { class: `bolinha ${status}` }), h('b', {}, nome), h('small', {}, ts.length || ''),
        h('button', { class: 'btn-txt', title: 'Nova tarefa', onclick: () => modalNovaTarefa({ squad: sq.id, status }) }, ic('mais', 15))),
      h('div', { class: 'cartoes-k' }, ts.map((t) => {
        const b = bot(t.bot);
        const c = h('div', { class: 'cartao-k', draggable: true, onclick: () => modalTarefa(t.id) },
          h('b', {}, t.titulo),
          t.descricao ? h('p', {}, t.descricao.slice(0, 120)) : null,
          h('div', { class: 'rodape-k' },
            b ? h('span', { class: 'quem' }, iconeBot(b, 18), b.nome) : h('span', { class: 'quem sem' }, 'sem responsável'),
            h('small', {}, `${r.notas[t.id] ? `${r.notas[t.id]} nota${r.notas[t.id] > 1 ? 's' : ''} · ` : ''}#${t.id}`)));
        c.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/plain', String(t.id)); c.classList.add('arrastando'); });
        c.addEventListener('dragend', () => c.classList.remove('arrastando'));
        return c;
      })));
    col.addEventListener('dragover', (e) => { e.preventDefault(); col.classList.add('alvo'); });
    col.addEventListener('dragleave', () => col.classList.remove('alvo'));
    col.addEventListener('drop', tenta(async (e) => {
      e.preventDefault(); col.classList.remove('alvo');
      const id = Number(e.dataTransfer.getData('text/plain'));
      const t = r.tarefas.find((x) => x.id === id);
      if (t && t.status !== status) await api('PATCH', `/api/tarefas/${id}`, { status });
    }));
    return col;
  });
  corpo.replaceChildren(h('div', { class: 'kanban' }, colunas));
}

// ---------- conectores ----------
// Situação de cada conector em texto cinza; só o que pede ação ganha um pontinho de cor (selo falta/erro).
const SITUACAO = {
  conectado: ['Conectado', ''], entrar: ['Entre de novo no claude.ai', 'falta'], falhou: ['Falhou', 'erro'],
  desconectado: ['Não conectado', 'falta'], verificando: ['Verificando…', ''], configurar: ['Falta configurar', 'falta'],
  login: ['Login pelo terminal', ''], local: ['Neste computador', ''],
};
function situacaoTexto(c) {
  if (c.tipo === 'atlas') { const a = S.estado.atlas; return a.noAr ? ['No ar', ''] : a.instalado ? ['Desligado', ''] : ['Não instalado', 'falta']; }
  return SITUACAO[c.situacao] || ['', ''];
}
const precisaAcao = (c) => ['entrar', 'desconectado', 'configurar', 'falhou'].includes(c.situacao);
function seloSituacao(c) {
  const [t, cl] = situacaoTexto(c);
  return h('span', { class: `selo ${cl}` }, c.emTeste ? `${t} · em teste` : t);
}
function linhaConector(c, { direita = null, aoClicar = null } = {}) {
  return h('div', { class: `linha-con${aoClicar ? ' clicavel' : ''}`, onclick: aoClicar },
    logoConector(c, 40), h('div', { class: 'txt' }, h('b', {}, c.nome), seloSituacao(c)), direita);
}

const verificarConectores = tenta(async () => {
  await api('POST', '/api/conectores/verificar');
  await redesenharConectores();
  aviso('Status atualizado', 'Conferido na sua conta do claude.ai.');
});
async function redesenharConectores() {
  await recarregarEstado();
  if (S.rota.tela === 'conectores') renderConectores();
  if (!$('#painel').hidden && S.conectorAberto) abrirConector(S.conectorAberto);
}

function renderConectores() {
  const p = $('#principal');
  const grupos = {};
  for (const c of S.estado.conectores) (grupos[c.grupo || 'Outros'] ||= []).push(c);
  p.replaceChildren(topo('Conectores', 'Conecte cada conta uma vez. Cada squad escolhe quais usa.',
    h('button', { class: 'btn', onclick: verificarConectores }, 'Verificar de novo'),
    h('button', { class: 'btn prim', onclick: (e) => { e.stopPropagation(); menuNovaConta(e.currentTarget); } }, ic('mais', 15), 'Adicionar conta')),
  h('div', { class: 'conteudo' }, h('div', { class: 'estreito largo' },
    Object.entries(grupos).map(([g, cs]) => [h('h2', { class: 'sec' }, g), h('div', { class: 'grade-con' }, cs.map((c) => linhaConector(c, {
      aoClicar: () => abrirConector(c.id),
      direita: precisaAcao(c) ? h('button', { class: 'btn min', onclick: (e) => { e.stopPropagation(); abrirConector(c.id); } }, 'Conectar') : h('span', { class: 'seta-dir' }, ic('direita', 16)),
    })))]))));
}

// ---------- mais de uma conta do mesmo serviço ----------
// Contas Google: a principal vem do claude.ai (um Gmail só); cada Gmail a mais é uma "Conta Google extra" própria.
const contasGoogleExtras = () => S.estado.conectores.filter((x) => x.base === 'google-conta' && (x.extra || x.campos?.EMAIL));
function secaoContasGoogle(c) {
  const principal = S.estado.conectores.find((x) => x.id === 'gmail') || c;
  return [h('h2', { class: 'sec' }, 'Contas Google'),
    h('div', { class: 'cartao lista-con' },
      linhaConector({ ...principal, nome: 'Principal · claude.ai' }, {}),
      ...contasGoogleExtras().map((x) => linhaConector({ ...x, nome: x.campos?.EMAIL || x.rotuloConta || x.nome }, { aoClicar: () => abrirConector(x.id), direita: h('span', { class: 'seta-dir' }, ic('direita', 16)) })),
      h('button', { class: 'btn', style: { marginTop: '8px' }, onclick: () => modalContaGoogle() }, ic('mais', 15), 'Adicionar outro Gmail'))];
}

// Menu do "Adicionar conta" (página Conectores): os serviços que aceitam mais de uma conta.
function menuNovaConta(ancora) {
  if ($('#menu-pop')) return fecharMenu();
  const bases = [...new Map(S.estado.conectores.filter((x) => x.multiContas && !x.extra).map((x) => [x.base, x])).values()];
  const item = (c, titulo, sub, acao) => h('button', { class: 'menu-item', onclick: () => { fecharMenu(); acao(); } }, logoConector(c, 30), h('span', { class: 'txt' }, h('b', {}, titulo), h('small', {}, sub)));
  const m = h('div', { class: 'menu-pop', id: 'menu-pop', role: 'menu', onclick: (e) => e.stopPropagation() },
    ...bases.map((c) => c.base === 'google-conta'
      ? item(c, 'Outro Gmail / conta Google', 'Gmail, Drive, Docs, Planilhas e Agenda de outra conta', () => modalContaGoogle())
      : item(c, `Outra conta do ${c.nome}`, 'Com a chave própria dela', () => modalNovaConta(c))));
  document.body.append(m);
  const r = ancora.getBoundingClientRect();
  m.style.top = `${r.bottom + 6}px`;
  m.style.left = `${Math.max(8, Math.min(r.right - m.offsetWidth, innerWidth - m.offsetWidth - 8))}px`;
}

function modalNovaConta(c) {
  const nome = h('input', { class: 'ent', placeholder: 'Nome da conta (ex.: Cliente X, Trabalho)', maxlength: 40 });
  const criar = tenta(async () => {
    const k = await api('POST', '/api/contas', { base: c.base, nome: nome.value });
    fecharModal(); await recarregarEstado();
    if (S.rota.tela === 'conectores') renderConectores();
    abrirConector(k.id);
  });
  nome.addEventListener('keydown', (e) => { if (e.key === 'Enter') criar(); });
  modal(cabModal(`Outra conta do ${c.nome}`),
    h('p', { class: 'dica' }, 'Depois de criar, cole a chave desta conta e escolha em quais squads ela vale.'),
    h('label', { class: 'campo' }, 'Nome', nome),
    h('button', { class: 'btn prim', onclick: criar }, 'Criar conta'));
  setTimeout(() => nome.focus(), 50);
}

// Gmail a mais: nome + e-mail. O "cliente OAuth" do Google Cloud é configurado uma vez só e vale para todas.
function modalContaGoogle() {
  const base = S.estado.conectores.find((x) => x.id === 'google-conta');
  if (!base) return aviso('Conta Google extra indisponível', '', { erro: true });
  const precisaCliente = (base.segredos || []).some((s) => s.compartilhado && !s.salva);
  const nome = h('input', { class: 'ent', placeholder: 'Ex.: Trabalho, Cliente X', maxlength: 40 });
  const email = h('input', { class: 'ent', type: 'email', placeholder: 'nome@gmail.com', autocomplete: 'off' });
  const cid = h('input', { class: 'ent', placeholder: 'ID do cliente (termina em .apps.googleusercontent.com)', autocomplete: 'off', spellcheck: false });
  const csec = h('input', { class: 'ent', type: 'password', placeholder: 'Chave secreta do cliente', autocomplete: 'off' });
  const criar = tenta(async () => {
    const e = email.value.trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) throw new Error('Digite o e-mail da conta Google.');
    if (precisaCliente && (!cid.value.trim() || !csec.value.trim())) throw new Error('Cole o ID e a chave secreta do cliente OAuth (passo único, explicado abaixo).');
    if (precisaCliente) await api('PUT', '/api/segredos', { GOOGLE_OAUTH_CLIENT_ID: cid.value.trim(), GOOGLE_OAUTH_CLIENT_SECRET: csec.value.trim() });
    // a primeira conta extra usa a própria "Conta Google extra"; as seguintes viram contas novas
    let id = 'google-conta';
    if (base.campos?.EMAIL) id = (await api('POST', '/api/contas', { base: 'google-conta', nome: nome.value.trim() || e.split('@')[0] })).id;
    await api('PUT', `/api/conectores/${id}/campos`, { EMAIL: e });
    fecharModal(); await recarregarEstado();
    if (S.rota.tela === 'conectores') renderConectores();
    abrirConector(id);
    aviso('Conta adicionada', 'Ligue-a nos squads que vão usar. No primeiro uso, o Google pede para você entrar nesta conta.');
  });
  modal(cabModal('Adicionar outro Gmail'),
    h('p', { class: 'dica' }, 'A conta principal vem do claude.ai. Cada Gmail a mais fica aqui, com Gmail, Drive, Docs, Planilhas e Agenda daquela conta. Os bots escolhem a conta certa pelo e-mail.'),
    h('label', { class: 'campo' }, 'E-mail da conta', email),
    h('label', { class: 'campo' }, 'Nome (opcional)', nome),
    precisaCliente ? [
      h('h2', { class: 'sec' }, 'Passo único: cliente do Google Cloud'),
      h('p', { class: 'dica' }, 'O Google exige um "cliente OAuth" seu para deixar um programa ler o Gmail. Faz uma vez e vale para todas as contas extras:'),
      h('ol', { class: 'passos' },
        h('li', {}, 'Abra ', h('a', { href: 'https://console.cloud.google.com/projectcreate', target: '_blank', rel: 'noopener' }, 'console.cloud.google.com'), ' e crie um projeto (ex.: Claude Flow).'),
        h('li', {}, 'Em "APIs e serviços › Biblioteca", ative: Gmail API, Google Drive API, Google Docs API, Google Sheets API e Google Calendar API.'),
        h('li', {}, 'Em "Google Auth Platform" (antiga Tela de consentimento OAuth): público Externo. Depois, em "Público", clique em "Publicar app" (fica "Em produção"). Não precisa verificar; em modo Teste o Google desconecta o Gmail a cada 7 dias.'),
        h('li', {}, 'Em "Credenciais › Criar credenciais › ID do cliente OAuth": tipo "App para computador". Copie o ID e a chave secreta e cole aqui.')),
      h('label', { class: 'campo' }, 'ID do cliente', cid),
      h('label', { class: 'campo' }, 'Chave secreta do cliente', csec),
    ] : null,
    h('button', { class: 'btn prim', style: { marginTop: '6px' }, onclick: criar }, 'Adicionar conta'));
  setTimeout(() => email.focus(), 50);
}

// Painel de um conector: como conectar, em quais squads usar e, nos que aceitam, as outras contas.
function abrirConector(id) {
  const c = S.estado.conectores.find((x) => x.id === id);
  if (!c) return;
  S.conectorAberto = id;
  const p = $('#painel');
  p.hidden = false;
  p.replaceChildren(
    h('div', { class: 'cab' }, h('b', {}, 'Conector'), h('button', { class: 'btn-txt', title: 'Fechar', onclick: fecharPainel }, ic('fechar', 18))),
    h('div', { class: 'corpo' }, ...conteudoConector(c).flat(Infinity).filter(Boolean)));
}

function conteudoConector(c) {
  const a = S.estado.atlas;
  const out = [
    h('div', { class: 'con-topo' }, logoConector(c, 56), h('div', { class: 'txt' }, h('b', {}, c.nome), seloSituacao(c))),
    h('p', { class: 'con-desc' }, c.descricao),
    c.emTeste ? h('p', { class: 'dica' }, 'Em teste: este conector ainda não foi validado neste computador.') : null,
    h('h2', { class: 'sec' }, 'Conexão'),
  ];

  if (c.tipo === 'claudeai') {
    const ok = c.situacao === 'conectado';
    out.push(h('div', { class: 'cartao' },
      h('p', { class: 'dica', style: { marginTop: 0 } }, ok ? 'Conectado pela sua conta do claude.ai. Os bots usam esta conta.' : 'Vem da sua conta do claude.ai: conecte (ou entre de novo) lá e depois toque em "Verificar de novo".'),
      h('div', { class: 'acoes-lin' },
        h('a', { class: `btn${ok ? '' : ' prim'}`, href: 'https://claude.ai/settings/connectors', target: '_blank', rel: 'noopener' }, ok ? 'Gerenciar no claude.ai' : 'Conectar no claude.ai'),
        h('button', { class: 'btn', onclick: verificarConectores }, 'Verificar de novo'))));
    if (c.grupo === 'Google' && S.estado.conectores.some((x) => x.id === 'google-conta')) out.push(...secaoContasGoogle(c));
  } else if (c.tipo === 'navegador') {
    out.push(h('div', { class: 'cartao' }, h('p', { class: 'dica', style: { marginTop: 0 } }, 'Um Chrome só do Claude Flow. As contas que você entrar nele ficam salvas para os bots.'),
      h('a', { class: 'btn', href: '#/navegador', onclick: fecharPainel }, 'Abrir o navegador')));
  } else if (c.tipo === 'atlas') {
    out.push(h('div', { class: 'cartao' }, h('p', { class: 'dica', style: { marginTop: 0 } }, `Editor com timeline em ${a.url}.`),
      a.noAr ? h('a', { class: 'btn', href: linkAtlas(a.url), target: '_blank' }, 'Abrir o Atlas')
        : h('button', { class: 'btn', disabled: !a.instalado, onclick: tenta(async () => { await api('POST', '/api/atlas/ligar'); await redesenharConectores(); }) }, 'Ligar o Atlas')));
  } else if (c.oauth) {
    out.push(h('div', { class: 'cartao' }, h('p', { class: 'dica', style: { margin: 0 } }, 'Este conector pede login pelo navegador uma vez, pelo terminal (passo a passo em docs/conectores.md).')));
  } else {
    const entradas = [];
    const campos = (c.camposConta || []).map((k) => {
      const i = h('input', { class: 'ent', value: c.campos?.[k.nome] || '', autocomplete: 'off', spellcheck: false });
      entradas.push(['campo', k.nome, i]);
      return h('label', { class: 'campo' }, k.rotulo, i);
    });
    const segs = (c.segredos || []).map((s) => {
      const i = h('input', { class: 'ent', type: 'password', placeholder: s.salva ? '•••••••• salva (digite para trocar)' : '', autocomplete: 'off' });
      entradas.push(['segredo', s.chave, i]);
      return h('label', { class: 'campo' }, s.compartilhado && c.multiContas ? `${s.rotulo} · vale para todas as contas` : s.rotulo, i, s.ajuda ? h('span', { class: 'dica' }, s.ajuda) : null);
    });
    const salvar = h('button', { class: 'btn prim', onclick: tenta(async () => {
      const sec = {}, cam = {};
      for (const [tipo, nome, i] of entradas) {
        const v = i.value.trim();
        if (tipo === 'segredo') { if (v) sec[nome] = v; } else cam[nome] = v;
      }
      if (Object.keys(sec).length) await api('PUT', '/api/segredos', sec);
      if (Object.keys(cam).length) await api('PUT', `/api/conectores/${c.id}/campos`, cam);
      aviso('Salvo', 'Vale a partir da próxima mensagem dos bots.');
      await redesenharConectores();
    }) }, 'Salvar');
    out.push(h('div', { class: 'cartao' }, campos, segs, salvar));
    if (c.base === 'google-conta') out.push(h('p', { class: 'dica' }, 'No primeiro uso, o Google pede para você entrar nesta conta pelo navegador. Depois fica salvo.'));
  }

  // squads
  out.push(h('h2', { class: 'sec' }, 'Usado nos squads'),
    h('div', { class: 'cartao' }, S.estado.squads.map((sq) => {
      const lig = new Set(sq.conectores || []);
      return h('div', { class: 'chave' },
        h('div', { class: 'txt' }, h('b', {}, sq.nome), h('small', {}, `${S.estado.bots.filter((b) => b.squad === sq.id).length} bot(s)`)),
        alternar(lig.has(c.id), tenta(async (on) => {
          on ? lig.add(c.id) : lig.delete(c.id);
          await api('PUT', `/api/squads/${sq.id}/conectores`, { conectores: [...lig] });
        })));
    })));

  // outras contas do mesmo serviço
  if (c.multiContas) {
    const irmas = S.estado.conectores.filter((x) => x.base === c.base);
    const nome = h('input', { class: 'ent', placeholder: 'Nome da nova conta (ex.: Trabalho)', maxlength: 40 });
    const adicionar = tenta(async () => {
      const k = await api('POST', '/api/contas', { base: c.base, nome: nome.value });
      await recarregarEstado();
      if (S.rota.tela === 'conectores') renderConectores();
      abrirConector(k.id);
    });
    nome.addEventListener('keydown', (e) => { if (e.key === 'Enter') adicionar(); });
    out.push(h('h2', { class: 'sec' }, 'Contas'),
      h('div', { class: 'cartao lista-con' },
        irmas.map((x) => linhaConector({ ...x, nome: x.extra ? x.rotuloConta : 'Principal' }, {
          aoClicar: x.id === c.id ? null : () => abrirConector(x.id),
          direita: x.id === c.id ? h('span', { class: 'selo' }, 'Aberta') : h('span', { class: 'seta-dir' }, ic('direita', 16)),
        })),
        h('div', { class: 'acoes-lin', style: { marginTop: '10px', flexWrap: 'nowrap' } }, nome, h('button', { class: 'btn', onclick: adicionar }, ic('mais', 15), 'Adicionar'))));
  }
  if (c.extra) {
    const novoNome = h('input', { class: 'ent', value: c.rotuloConta, maxlength: 40 });
    out.push(h('h2', { class: 'sec' }, 'Esta conta'),
      h('div', { class: 'acoes-lin', style: { flexWrap: 'nowrap' } }, novoNome,
        h('button', { class: 'btn', onclick: tenta(async () => { await api('PATCH', `/api/contas/${c.id}`, { nome: novoNome.value }); await redesenharConectores(); }) }, 'Renomear')),
      h('button', { class: 'btn perigo', style: { marginTop: '12px' }, onclick: tenta(async () => {
        if (!confirm(`Remover a conta "${c.rotuloConta}"? As chaves dela saem deste computador e os squads param de usá-la.`)) return;
        await api('DELETE', `/api/contas/${c.id}`);
        fecharPainel(); await redesenharConectores();
      }) }, 'Remover conta'));
  }
  return out;
}

// Logo do aplicativo (web/logos/, campo "icone" do catálogo) num quadradinho branco arredondado, como nas lojas de apps.
// "iconeCheio": o logo já é um ícone de app com fundo próprio, então ocupa o quadrado todo.
function logoConector(c, tam = 44) {
  const caixa = h('span', { class: `logo-app${c.iconeCheio ? ' cheio' : ''}`, style: { width: `${tam}px`, height: `${tam}px`, borderRadius: `${Math.round(tam * 0.26)}px` } });
  const reserva = () => { caixa.classList.add('sem-logo'); caixa.replaceChildren(ic(c.tipo === 'atlas' ? 'filme' : 'conector', Math.round(tam * 0.5))); };
  if (!c.icone) { reserva(); return caixa; }
  const img = h('img', { src: `/logos/${c.icone}`, alt: '', loading: 'lazy', draggable: false });
  img.onerror = reserva;
  caixa.append(img);
  return caixa;
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
      h('div', { class: 'txt' }, h('b', {}, pf.perfil === 'principal' ? 'Principal (compartilhado)' : bot(pf.perfil)?.nome ? `Próprio de ${bot(pf.perfil).nome}` : pf.perfil), h('small', {}, `${pf.ativo ? 'aberto' : 'fechado'} · porta ${pf.porta}`)),
      h('div', { class: 'acoes-lin' },
        h('button', { class: 'btn min', onclick: tenta(async () => { await api('POST', `/api/navegador/${pf.perfil}/abrir`, { url: url.value.trim() }); renderNavegador(); }) }, pf.ativo ? 'Abrir aba' : 'Abrir'),
        pf.ativo ? h('button', { class: 'btn min', onclick: tenta(async () => { await api('POST', `/api/navegador/${pf.perfil}/fechar`); renderNavegador(); }) }, 'Fechar') : null)))),
    h('p', { class: 'dica', style: { marginTop: '16px' } }, 'Dois bots usando o perfil Principal ao mesmo tempo disputam as abas. Para trabalho em paralelo, dê ao bot um navegador próprio (Ajustes do bot › Preferências › Navegador).'));
}

// ---------- aprovações ----------
function renderAprovacoes() {
  const lista = S.estado.aprovacoes || [];
  $('#principal').replaceChildren(topo('Esperando você', 'Permissões, exclusões e pedidos para assumir o navegador.'),
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
    h('label', { class: 'campo' }, 'Endereço do Atlas fora do computador', atlasPub, h('span', { class: 'dica' }, 'Os links localhost:4123 que o Editor manda viram este endereço quando você abre pelo celular.')),
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
  S.modalExclusao = null;
  m.replaceChildren(h('div', { class: 'caixa-m', onclick: (e) => e.stopPropagation() }, ...conteudo));
  m.onclick = fecharModal;
}
const fecharModal = () => { $('#modal').hidden = true; S.modalExclusao = null; };

// Caixa obrigatória antes de um bot excluir qualquer coisa (aberta pelo gancho guarda-exclusao.js no servidor).
// Fechar a caixa não decide nada: o pedido continua no chat do bot até "Excluir" ou "Não excluir".
function modalExclusao(ap) {
  if (!ap || S.modalExclusao === ap.id) return;
  modal(
    h('div', { class: 'excluir-cab' }, h('span', { class: 'excluir-ic' }, ic('lixeira', 22)),
      h('div', {}, h('b', {}, 'Confirmar exclusão'), h('small', {}, `${ap.botNome} quer excluir. Nada é apagado sem você confirmar.`))),
    h('code', { class: 'excluir-cmd' }, ap.resumo),
    h('p', { class: 'dica' }, 'Pode não ter volta. Se negar, o bot segue o trabalho sem apagar.'),
    h('div', { class: 'acoes-lin excluir-acoes' },
      h('button', { class: 'btn', onclick: () => decidir(ap, false) }, 'Não excluir'),
      h('button', { class: 'btn excluir', onclick: () => decidir(ap, true) }, 'Excluir')));
  S.modalExclusao = ap.id;
}
function proximaExclusao() {
  if (document.visibilityState !== 'visible' || (!$('#modal').hidden && !S.modalExclusao)) return;
  const ap = (S.estado?.aprovacoes || []).find((a) => a.tipo === 'exclusao');
  if (ap) modalExclusao(ap);
  else if (S.modalExclusao) fecharModal();
}

// Editor de avatar: prévia grande + grade de planetas com o nome embaixo.
function editorAvatar(av, aoMudar) {
  const prev = h('div', { class: 'av-prev' });
  const grade = h('div', { class: 'av-grade' });
  const escolher = (id) => { av.planeta = id; desenhar(); aoMudar?.(); };
  function desenhar() {
    prev.innerHTML = avatarSVG(av, { tamanho: 104 });
    grade.replaceChildren(...PLANETAS.map((p) => h('button', {
      class: `av-op${av.planeta === p.id ? ' sel' : ''}`, title: p.nome, onclick: () => escolher(p.id),
    }, h('span', { class: 'avatar', html: avatarSVG({ planeta: p.id }, { tamanho: 38 }) }), h('small', {}, p.nome))));
  }
  desenhar();
  const dado = h('button', { class: 'av-dado', title: 'Sortear', 'aria-label': 'Sortear', onclick: () => { Object.assign(av, avatarAleatorio(av.planeta)); desenhar(); aoMudar?.(); } }, ic('sortear', 17));
  return {
    desenhar,
    topo: h('div', { class: 'av-topo' }, prev, dado),
    opcoes: h('div', {}, h('div', { class: 'av-rot' }, 'Planeta'), grade),
  };
}

function cabModal(titulo) {
  return h('div', { class: 'm-cab' }, h('button', { class: 'btn-txt', title: 'Fechar', onclick: fecharModal }, ic('fechar', 18)), h('b', {}, titulo), h('span'));
}

function modalNovoBot(squadId) {
  const tpls = S.estado.templates;
  let tpl = tpls[0]?.id;
  let mexeu = false; // depois que a pessoa mexe no avatar, trocar de template não muda mais o desenho
  const avTpl = (t) => (avatarValido(t?.avatar) ? { ...t.avatar } : avatarAleatorio());
  const av = avTpl(template(tpl));
  const ed = editorAvatar(av, () => {
    mexeu = true;
    // No template em branco o bot ganha o nome do planeta, se a pessoa ainda não escreveu outro.
    if (tpl === 'em-branco' && (!nome.value.trim() || PLANETAS.some((p) => p.nome === nome.value.trim()))) { nome.value = nomePlaneta(av.planeta); atualizarCriar(); }
  });
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
        const nomeEraDoTemplate = !nome.value.trim() || tpls.some((x) => x.nome === nome.value.trim()) || PLANETAS.some((p) => p.nome === nome.value.trim());
        tpl = t.id;
        if (!mexeu) { Object.assign(av, avTpl(t)); ed.desenhar(); }
        if (nomeEraDoTemplate) nome.value = t.id === 'em-branco' ? nomePlaneta(av.planeta) : t.nome;
        atualizarCriar(); desenharTemplates();
      },
    }, h('span', { class: 'avatar', html: avatarSVG(avatarValido(t.avatar) ? t.avatar : { planeta: 'lua' }, { tamanho: 22 }) }), t.nome)));
    descricao.textContent = template(tpl)?.descricao || '';
    campoFuncao.hidden = tpl !== 'em-branco';
  };
  nome.value = tpl === 'em-branco' ? nomePlaneta(av.planeta) : template(tpl)?.nome || '';
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
  if (sub) sub.replaceChildren(subTopoBot(b));
  const fi = $('#fila-info');
  if (fi) fi.textContent = '';
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
    if (lista && m.papel === 'usuario') {
      const i = lista.findIndex((x) => x.provisoria && x.texto === m.texto);
      if (i >= 0) lista.splice(i, 1);
    }
    if (lista && !lista.some((x) => x.id === m.id)) lista.push(m);
    if (m.papel === 'bot') S.deltas.delete(m.bot);
    const vendo = S.rota.tela === 'bot' && S.rota.id === m.bot && document.visibilityState === 'visible';
    if (!vendo && ['bot', 'arquivo'].includes(m.papel)) { S.naoLidas.set(m.bot, (S.naoLidas.get(m.bot) || 0) + 1); renderLateral(); }
    if (S.rota.tela === 'bot' && S.rota.id === m.bot) renderMsgs();
    if (m.papel === 'entrada') {
      const l = S.sala.get(m.squad);
      if (l && !l.some((x) => x.id === m.id)) { l.push(m); if (S.rota.tela === 'squad' && S.rota.id === m.squad) renderSala(m.squad); }
    }
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
    else S.pendente.delete(e.id);
    renderLateral(); atualizarTopoBot();
    if (S.rota.tela === 'bot' && S.rota.id === e.id) renderMsgs();
    if (S.rota.tela === 'squad' && S.rota.id === b.squad) renderSala(b.squad);
    const subInfo = S.rota.id === e.id ? $('.info-perfil small') : null;
    if (subInfo) subInfo.textContent = subtituloBot(b);
  });
  on('sala', (d) => {
    if (d.roteando) S.salaRoteando = d.squad;
    if (d.msg) {
      if (S.salaRoteando === d.squad && d.msg.papel !== 'usuario') S.salaRoteando = null;
      const l = S.sala.get(d.squad);
      if (l && !l.some((x) => x.id === d.msg.id)) l.push(d.msg);
    }
    if (S.rota.tela === 'squad' && S.rota.id === d.squad) renderSala(d.squad);
  });
  on('rotinas', () => { if (S.rota.tela === 'bot' && infoAberta()) renderInfo(S.rota.id); });
  on('aprovacao', async () => { await recarregarEstado(); if (S.rota.tela === 'bot') renderMsgs(); if (S.rota.tela === 'aprovacoes') renderAprovacoes(); proximaExclusao(); });
  on('estado', async () => { await recarregarEstado(); if (['inicio', 'squad', 'conectores'].includes(S.rota.tela)) renderPrincipal(); });
  on('tarefa', (t) => {
    if (S.rota.tela === 'squad' && S.rota.id === t.squad && (localGet('abaSquad') || 'tarefas') === 'tarefas') { const sq = squad(t.squad); const c = $('.squad-corpo'); if (sq && c) renderKanban(sq, c); }
    if (S.rota.tela === 'bot' && infoAberta()) renderInfo(S.rota.id);
  });
  on('bot-arquivos', (d) => { if (S.rota.tela === 'bot' && S.rota.id === d.bot && infoAberta()) renderInfo(d.bot); });
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
  if (document.visibilityState === 'visible') proximaExclusao();
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
recarregarEstado().then(() => { renderPrincipal(); conectarEventos(); presenca(); proximaExclusao(); }).catch((e) => {
  $('#principal').replaceChildren(h('div', { class: 'vazio' }, `Não consegui falar com o servidor do Claude Flow: ${e.message}`));
});
