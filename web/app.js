// Claude Flow — app (PWA). Sem build: JavaScript puro (avatares em avatar.js, ícones de linha em icones.js).
import { avatarSVG, avatarPadrao, avatarAleatorio, avatarValido, nomePlaneta, PLANETAS, corDoPlaneta } from './avatar.js';
import { icone } from './icones.js';

const S = {
  estado: null,
  demandas: new Map(), // execução -> demanda (cartão no chat)
  modelosDem: new Map(), // squad -> modelos de demanda
  demandaVer: new Map(), demandaFechada: new Set(), demandaEscolhida: new Map(), demandaBuscando: new Set(),
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
        // o ícone da galáxia abre a tela do squad (Relevantes, Tarefas, Spy…); a Galáxia em si é um chat, logo abaixo
        h('button', { class: 'btn-txt', title: 'Abrir o squad (Relevantes, Tarefas, Spy…)', onclick: (e) => { e.stopPropagation(); ir(`#/squad/${sq.id}`); } }, ic('galaxia', 16)),
        h('button', { class: 'btn-txt', title: 'Novo bot neste squad', onclick: (e) => { e.stopPropagation(); modalNovoBot(sq.id); } }, ic('mais', 15))),
      h('div', { class: 'bots' }, bs.length ? h('a', { class: `item galaxia-item${S.rota.tela === 'galaxia' && S.rota.id === sq.id ? ' ativo' : ''}`, href: `#/galaxia/${sq.id}`, title: 'Galáxia: o grupo do squad' },
        h('div', { class: 'av av-galaxia' }, ic('galaxia', 18)),
        h('div', { class: 'txt' }, h('b', {}, 'Galáxia'), h('small', {}, 'o grupo do squad'))) : null,
      bs.length ? bs.map((b) => {
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
    convitePush() || '',
    h('div', { class: 'barra' },
      aprov ? h('a', { class: 'item', href: '#/aprovacoes', title: 'Esperando você' }, ic('cadeado'), h('span', { class: 'rot' }, 'Esperando você'), h('span', { class: 'contador' }, aprov)) : null,
      h('a', { class: `item${S.rota.tela === 'conectores' ? ' ativo' : ''}`, href: '#/conectores', title: 'Conectores' }, ic('conector'), h('span', { class: 'rot' }, 'Conectores')),
      h('a', { class: `item${S.rota.tela === 'navegador' ? ' ativo' : ''}`, href: '#/navegador', title: 'Navegador' }, ic('globo'), h('span', { class: 'rot' }, 'Navegador')),
      h('a', { class: `item${S.rota.tela === 'ajustes' ? ' ativo' : ''}`, href: '#/ajustes', title: 'Ajustes' }, ic('engrenagem'), h('span', { class: 'rot' }, 'Ajustes'))),
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
    cerebro: () => [cerebroInfo(botId)],
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
const ABAS_INFO = [['geral', 'Geral'], ['galeria', 'Galeria'], ['recursos', 'Recursos'], ['cerebro', 'Cérebro'], ['rotinas', 'Rotinas']];

// Cérebro: modelos, biblioteca e agentes que valem para todos os bots (~/ClaudeFlow/cerebro). Ligado = o item entra
// inteiro no contexto deste bot a partir da próxima sessão; desligado = o bot sabe que existe e lê quando precisar.
const SECOES_CEREBRO = [['modelos', 'Modelos'], ['biblioteca', 'Biblioteca'], ['agentes', 'Agentes']];
function cerebroInfo(botId) {
  const corpo = h('div', {}, h('p', { class: 'info-vazio' }, 'Carregando…'));
  api('GET', '/api/cerebro').then(({ itens, pasta }) => {
    const ativos = new Set(bot(botId)?.cerebro || []);
    const mudar = tenta(async (c, liga) => {
      if (liga) ativos.add(c); else ativos.delete(c);
      const b = await api('PATCH', `/api/bots/${botId}`, { cerebro: [...ativos] });
      const local = bot(botId); if (local) local.cerebro = b.cerebro;
      aviso(liga ? 'No contexto do bot' : 'Fora do contexto', 'Vale a partir da próxima sessão dele.');
    });
    corpo.replaceChildren(...SECOES_CEREBRO.map(([sec, nome]) => {
      const lista = itens.filter((i) => i.secao === sec);
      return secaoInfo(nome, lista.length ? h('div', { class: 'info-cartao' }, lista.map((i) => h('div', { class: 'info-item' },
        h('span', { class: 'ic-item' }, ic('documento', 15)),
        h('button', { class: 'txt btn-txt', style: { textAlign: 'left' }, onclick: () => abrirCerebro(i) }, h('b', {}, i.nome), h('small', {}, `${Math.max(1, Math.round(i.tamanho / 1024))} KB`)),
        alternar(ativos.has(i.caminho), (liga) => mudar(i.caminho, liga)))))
        : h('div', { class: 'info-cartao pad' }, h('p', { class: 'info-vazio' }, `Vazio. Ponha arquivos .md em ClaudeFlow/cerebro/${sec}.`)));
    }), h('p', { class: 'dica', style: { margin: '4px 4px 0' } }, 'Ligado: o bot já começa a sessão com o item no contexto. Desligado: ele sabe que existe e lê quando precisar.'));
  }).catch(() => corpo.replaceChildren(h('p', { class: 'info-vazio' }, 'Não deu para abrir o cérebro.')));
  return corpo;
}
async function abrirCerebro(i) {
  const d = await api('GET', `/api/cerebro/item?caminho=${encodeURIComponent(i.caminho)}`).catch(() => null);
  if (!d) return;
  modal(cabModal(i.nome), h('div', { class: 'md', style: { maxHeight: '70vh', overflow: 'auto' }, html: md(d.texto) }));
}

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
async function modalRotina(botId, id, { squad = null, aoSalvar = null } = {}) {
  const r = id ? await api('GET', `/api/rotinas/${id}`).catch(() => null) : null;
  const q = r?.quando || { tipo: 'diario', hora: '09:00', dias: [1, 2, 3, 4, 5], horas: 6 };
  const escolheBot = !botId ? h('select', { class: 'ent' }, S.estado.bots.filter((b) => !squad || b.squad === squad).map((b) => h('option', { value: b.id }, b.nome))) : null;
  const depois = () => { if (aoSalvar) aoSalvar(); else if (botId) renderInfo(botId); };
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
    else await api('POST', '/api/rotinas', { bot: botId || escolheBot.value, ...dados() });
    fecharModal(); aviso('Rotina salva'); depois();
  });
  modal(cabModal(r ? 'Rotina' : 'Nova rotina'),
    escolheBot ? h('label', { class: 'campo', style: { marginTop: '10px' } }, 'Bot', escolheBot) : null,
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
      r ? h('button', { class: 'btn perigo', onclick: tenta(async () => { if (!confirm(`Apagar a rotina "${r.nome}"? Isso não tem volta.`)) return; await api('DELETE', `/api/rotinas/${r.id}`); fecharModal(); depois(); }) }, 'Apagar') : null));
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
// Responsável: um bot do squad ou "Keeps" (você mesmo, para a sua gestão de tarefas).
const KEEPS = 'keeps';
function seletorBot(squadId, atual) {
  return h('select', { class: 'ent' }, h('option', { value: '' }, 'Ninguém ainda'),
    h('option', { value: KEEPS, selected: atual === KEEPS }, 'Keeps (eu)'),
    S.estado.bots.filter((x) => x.squad === squadId).map((x) => h('option', { value: x.id, selected: x.id === atual }, x.nome)));
}
const ehBot = (id) => !!id && id !== KEEPS && !!bot(id);
function quemTarefa(t, tamanho = 18) {
  if (t.bot === KEEPS) return h('span', { class: 'quem keeps' }, h('span', { class: 'av-keeps', style: { width: tamanho + 'px', height: tamanho + 'px' } }, 'K'), 'Keeps');
  const b = bot(t.bot);
  return b ? h('span', { class: 'quem' }, iconeBot(b, tamanho), b.nome) : h('span', { class: 'quem sem' }, 'sem responsável');
}
// datas: <input type="datetime-local"> ⇄ milissegundos
const paraCampoData = (ms) => { if (!ms) return ''; const d = new Date(ms); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); };
const doCampoData = (v) => (v ? new Date(v).getTime() : null);
const dataCurta = (ms) => new Date(ms).toLocaleString('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).replace(',', ' ·');
function seloPrazo(t) {
  if (!t.prazo) return null;
  const atrasada = t.status !== 'feito' && t.prazo < Date.now();
  return h('span', { class: `selo-data${atrasada ? ' atrasada' : ''}`, title: atrasada ? 'Prazo passou' : 'Prazo' }, ic('relogio', 12), dataCurta(t.prazo));
}
function seloInicio(t) {
  if (!t.inicio || t.iniciado || t.status !== 'afazer') return null;
  return h('span', { class: 'selo-data agendada', title: 'O bot começa sozinho nesse horário' }, ic('play', 11), dataCurta(t.inicio));
}
// "Início" de uma tarefa de bot: agora, num horário marcado ou depois (você manda quando quiser)
function campoInicio(inicial = 'agora', quando = null) {
  const modo = h('select', { class: 'ent' },
    h('option', { value: 'agora', selected: inicial === 'agora' }, 'Começar agora'),
    h('option', { value: 'agendar', selected: inicial === 'agendar' }, 'Agendar dia e hora'),
    h('option', { value: 'depois', selected: inicial === 'depois' }, 'Não começar ainda'));
  const data = h('input', { class: 'ent', type: 'datetime-local', value: paraCampoData(quando || Date.now() + 3600000), hidden: inicial !== 'agendar' });
  modo.addEventListener('change', () => { data.hidden = modo.value !== 'agendar'; });
  const el = h('label', { class: 'campo' }, 'Início', h('div', { class: 'lin-inicio' }, modo, data),
    h('small', { class: 'dica' }, 'Se o bot estiver ocupado, a tarefa entra na fila dele e começa quando a anterior terminar.'));
  return { el, modo, data };
}



function modalNovaTarefa({ squad: squadId, bot: botId = '', status = 'afazer' }) {
  const titulo = h('input', { class: 'ent', placeholder: 'O que precisa ser feito', maxlength: 200 });
  const desc = h('textarea', { class: 'ent', rows: 5, style: { minHeight: '110px' }, placeholder: 'Objetivo e contexto: links, arquivos, decisões…' });
  const pronto = h('input', { class: 'ent', placeholder: 'Pronto quando… (opcional)' });
  const resp = seletorBot(squadId, botId);
  const prazo = h('input', { class: 'ent', type: 'datetime-local' });
  const ini = campoInicio(botId ? 'agora' : 'depois');
  const mostrarInicio = () => { ini.el.hidden = !ehBot(resp.value); };
  resp.addEventListener('change', mostrarInicio);
  mostrarInicio();
  const criar = tenta(async () => {
    const deBot = ehBot(resp.value);
    const agendar = deBot && ini.modo.value === 'agendar';
    if (agendar && !ini.data.value) throw new Error('escolha o dia e a hora do início');
    const t = await api('POST', '/api/tarefas', { squad: squadId, bot: resp.value || null, titulo: titulo.value, descricao: desc.value, entregaveis: pronto.value, status,
      prazo: doCampoData(prazo.value), inicio: agendar ? doCampoData(ini.data.value) : null, enviar: deBot && ini.modo.value === 'agora' });
    fecharModal();
    aviso(`Tarefa #${t.id} criada`, !deBot ? '' : agendar ? `${bot(resp.value)?.nome} começa em ${dataCurta(t.inicio)}.` : ini.modo.value === 'agora' ? `Enviada para ${bot(resp.value)?.nome}.` : '');
  });
  titulo.addEventListener('keydown', (e) => { if (e.key === 'Enter') criar(); });
  modal(cabModal('Nova tarefa'),
    h('label', { class: 'campo', style: { marginTop: '10px' } }, 'Título', titulo),
    h('label', { class: 'campo' }, 'Descrição', desc),
    h('label', { class: 'campo' }, 'Pronto quando', pronto),
    h('label', { class: 'campo' }, 'Responsável', resp),
    h('label', { class: 'campo' }, 'Prazo (opcional)', prazo),
    ini.el,
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
  const prazo = h('input', { class: 'ent', type: 'datetime-local', value: paraCampoData(t.prazo) });
  const ini = campoInicio(t.inicio && !t.iniciado ? 'agendar' : 'depois', t.inicio);
  ini.modo.querySelector('option[value="agora"]').remove(); // aqui "começar agora" é o botão "Enviar para o bot"
  const mostrarInicio = () => { ini.el.hidden = !ehBot(resp.value) || status !== 'afazer'; };
  resp.addEventListener('change', mostrarInicio);
  let status = t.status;
  const seg = h('div', { class: 'segmento' });
  const desenharSeg = () => seg.replaceChildren(...Object.entries(ROTULO_STATUS).map(([k, n]) => h('button', { class: k === status ? 'sel' : '', onclick: () => { status = k; desenharSeg(); mostrarInicio(); } }, n)));
  desenharSeg();
  mostrarInicio();
  const nota = h('input', { class: 'ent', placeholder: 'Escrever uma nota…' });
  const autor = (a) => (a === 'usuario' ? 'Você' : bot(a)?.nome || a);
  const historico = h('div', { class: 'historico' }, r.eventos.slice().reverse().map((e) => h('div', { class: `ev ${e.tipo}` },
    h('small', {}, `${autor(e.autor)} · ${quando(e.criado)}`), e.tipo === 'nota' ? h('div', { class: 'md', html: md(e.texto) }) : h('span', {}, ({ criada: 'criou a tarefa', status: `moveu: ${e.texto}`, enviada: `enviou ${e.texto}`, repasse: e.texto }[e.tipo] || e.texto)))));
  const salvar = async () => {
    const agendar = ehBot(resp.value) && ini.modo.value === 'agendar';
    if (agendar && !ini.data.value) throw new Error('escolha o dia e a hora do início');
    const inicio = agendar ? doCampoData(ini.data.value) : (t.iniciado ? t.inicio : null);
    return api('PATCH', `/api/tarefas/${id}`, { titulo: titulo.value, descricao: desc.value, entregaveis: pronto.value, bot: resp.value || null, status, prazo: doCampoData(prazo.value), inicio });
  };
  modal(cabModal(`Tarefa #${t.id}`),
    titulo,
    h('div', { style: { margin: '12px 0' } }, seg),
    h('label', { class: 'campo' }, 'Responsável', resp),
    h('label', { class: 'campo' }, 'Prazo', prazo),
    ini.el,
    t.iniciado ? h('p', { class: 'dica', style: { marginTop: '-6px' } }, `Começou sozinha no horário agendado (${dataCurta(t.iniciado)}).`) : null,
    h('label', { class: 'campo' }, 'Descrição', desc),
    h('label', { class: 'campo' }, 'Pronto quando', pronto),
    r.pasta ? h('p', { class: 'dica', style: { marginTop: '-6px' } }, 'Pasta: ', h('code', {}, r.pasta)) : null,
    h('div', { class: 'acoes-lin' },
      h('button', { class: 'btn prim', onclick: tenta(async () => { await salvar(); fecharModal(); aviso('Tarefa salva'); }) }, 'Salvar'),
      ehBot(t.bot) || !t.bot ? h('button', { class: 'btn', onclick: tenta(async () => { await salvar(); const x = await api('POST', `/api/tarefas/${id}/enviar`); fecharModal(); aviso(`Enviada para ${bot(x.bot)?.nome}`); }) }, 'Enviar para o bot') : null,
      h('button', { class: 'btn perigo', onclick: tenta(async () => { if (!confirm(`Apagar a tarefa #${t.id} "${t.titulo}" e o histórico dela? Não tem volta.`)) return; await api('DELETE', `/api/tarefas/${id}`); fecharModal(); }) }, 'Apagar')),
    h('h2', { class: 'sec' }, 'Histórico'),
    h('div', { class: 'acoes-lin', style: { flexWrap: 'nowrap', marginBottom: '10px' } }, nota,
      h('button', { class: 'btn', onclick: tenta(async () => { if (!nota.value.trim()) return; await api('POST', `/api/tarefas/${id}/notas`, { texto: nota.value }); modalTarefa(id); }) }, 'Anotar')),
    historico);
}

const tipoMidia = (nome) => { const e = (String(nome).split('.').pop() || '').toLowerCase(); return ['mp4', 'mov', 'webm', 'm4v'].includes(e) ? 'video' : ['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(e) ? 'imagem' : ['mp3', 'm4a', 'wav'].includes(e) ? 'audio' : ''; };
function blocoQuadro(meta) {
  const itens = meta.itens || [];
  return h('div', { class: 'quadro' },
    meta.titulo ? h('div', { class: 'quadro-tit' }, meta.titulo) : null,
    h('div', { class: 'quadro-grade' }, itens.map((x, i) => {
      const tipo = tipoMidia(x.nome);
      const url = `/api/arquivo/${x.token}`;
      const abrir = () => abrirMidia({ ...x, tipo: tipo || 'imagem', legenda: [x.titulo, x.texto].filter(Boolean).join(' · '), pasta: 'Quadro' });
      return h('div', { class: 'quadro-item' },
        h('button', { class: 'quadro-capa', title: 'Ver grande', onclick: abrir },
          tipo === 'video' ? h('video', { src: url, preload: 'metadata', muted: true, playsinline: true })
            : tipo === 'imagem' ? h('img', { src: url, alt: x.titulo || x.nome, loading: 'lazy' })
              : h('span', { class: 'gal-ic' }, ic(tipo === 'audio' ? 'microfone' : 'documento', 22)),
          tipo === 'video' ? h('span', { class: 'gal-play' }, ic('play', 14, { preenchido: true })) : null,
          h('span', { class: 'quadro-num' }, String(i + 1))),
        h('div', { class: 'quadro-txt' }, x.titulo ? h('b', {}, x.titulo) : null, x.texto ? h('span', {}, x.texto) : null));
    })));
}


// ---------- Demandas: trabalho em etapas num cartão só ----------
// O modelo fica no squad (aba Demandas). Aberta, a demanda aparece no chat do bot como UM cartão no fim da conversa:
// as etapas em cima (feita, atual, próximas) e o resultado da etapa embaixo, com Aprovar / Pedir ajuste. As mensagens
// vão subindo; o cartão continua sendo o mesmo. Concluída, ela fica compacta no histórico, no ponto onde começou.
const ROTULO_ETAPA = { pendente: 'A fazer', trabalhando: 'Fazendo', aguardando: 'Esperando você', aprovada: 'Aprovada', pulada: 'Pulada' };
const demandaAtivaDo = (botId) => [...S.demandas.values()].find((x) => x.bot === botId && x.status === 'andamento') || null;
function guardarDemandas(lista = []) { for (const x of lista) S.demandas.set(x.id, x); }
async function carregarModelosDem(squadId) {
  const r = await api('GET', `/api/demandas?squad=${encodeURIComponent(squadId)}`).catch(() => null);
  if (!r) return [];
  S.modelosDem.set(squadId, r.modelos);
  guardarDemandas(r.execucoes);
  return r.modelos;
}
const modelosDoBot = (b) => (S.modelosDem.get(b.squad) || []).filter((m) => m.bot === b.id);

function gradeItens(itens = []) {
  return h('div', { class: 'quadro-grade' }, itens.map((x, i) => {
    const tipo = tipoMidia(x.nome);
    const url = `/api/arquivo/${x.token}`;
    const abrir = () => abrirMidia({ ...x, tipo: tipo || 'imagem', legenda: [x.titulo, x.texto].filter(Boolean).join(' · '), pasta: 'Demanda' });
    return h('div', { class: 'quadro-item' },
      h('button', { class: 'quadro-capa', title: 'Ver grande', onclick: abrir },
        tipo === 'video' ? h('video', { src: `${url}#t=0.5`, preload: 'metadata', muted: true, playsinline: true })
          : tipo === 'imagem' ? h('img', { src: url, alt: x.titulo || x.nome, loading: 'lazy' })
            : h('span', { class: 'gal-ic' }, ic(tipo === 'audio' ? 'microfone' : 'documento', 22)),
        tipo === 'video' ? h('span', { class: 'gal-play' }, ic('play', 14, { preenchido: true })) : null,
        h('span', { class: 'quadro-num' }, String(i + 1))),
      h('div', { class: 'quadro-txt' }, x.titulo ? h('b', {}, x.titulo) : null, x.texto ? h('span', {}, x.texto) : null));
  }));
}

function cartaoDemanda(x, { compacto = false } = {}) {
  const aberta = x.status === 'andamento';
  const chave = compacto ? `abrir:${x.id}` : x.id;
  const recolhido = compacto ? !S.demandaFechada.has(chave) : S.demandaFechada.has(chave);
  const ver = Math.min(S.demandaVer.has(x.id) ? S.demandaVer.get(x.id) : x.atual, x.etapas.length - 1);
  const e = x.etapas[ver];
  const atual = x.etapas[x.atual];
  const situacao = !aberta ? (x.status === 'concluida' ? 'Concluída' : 'Encerrada') : atual.status === 'aguardando' ? 'Esperando você' : 'Trabalhando';
  const alternar = () => { S.demandaFechada.has(chave) ? S.demandaFechada.delete(chave) : S.demandaFechada.add(chave); renderMsgs(); };

  const cab = h('button', { class: 'dem-cab', onclick: alternar, title: recolhido ? 'Abrir' : 'Recolher' },
    h('span', { class: 'dem-ic' }, ic('etapas', 16)),
    h('span', { class: 'dem-tit' }, h('b', {}, x.nome), x.titulo ? h('small', {}, x.titulo) : null),
    h('span', { class: `dem-sit${aberta && atual.status === 'aguardando' ? ' voce' : ''}` }, aberta ? `${situacao} · ${x.atual + 1}/${x.etapas.length}` : situacao),
    h('span', { class: `dem-seta${recolhido ? '' : ' aberta'}` }, ic('baixo', 14)));
  if (recolhido) return h('div', { class: `demanda${aberta ? ' ativa' : ''} recolhida` }, cab);

  const passos = h('div', { class: 'dem-passos' }, x.etapas.map((t, i) => h('button', {
    class: `dem-passo ${t.status}${i === ver ? ' sel' : ''}`, title: `${t.nome} · ${ROTULO_ETAPA[t.status] || ''}`,
    onclick: () => { S.demandaVer.set(x.id, i); renderMsgs(); },
  }, h('span', { class: 'dem-bola' }, t.status === 'aprovada' ? ic('check', 12) : t.status === 'pulada' ? '–' : String(i + 1)), h('span', { class: 'dem-nome' }, t.nome))));

  const corpo = [];
  const vazio = !e.texto && !e.itens?.length;
  if (e.status === 'trabalhando' || (aberta && ver === x.atual && e.status !== 'aguardando')) {
    corpo.push(h('div', { class: 'dem-trab' }, h('span', { class: 'dem-pulso' }), e.progresso || (vazio ? `Trabalhando em ${e.nome}…` : 'Refazendo com o seu ajuste…')));
  }
  if (e.status === 'pendente' && vazio) corpo.push(h('p', { class: 'dica' }, 'Esta etapa ainda não começou.'));
  if (e.status === 'pulada') corpo.push(h('p', { class: 'dica' }, 'Etapa pulada.'));
  if (e.texto) corpo.push(h('div', { class: 'md dem-texto', html: md(e.texto) }));
  if (e.itens?.length) corpo.push(gradeItens(e.itens));
  if (e.ajustes?.length) corpo.push(h('details', { class: 'dem-ajustes' }, h('summary', {}, `${e.ajustes.length} ${e.ajustes.length === 1 ? 'ajuste pedido' : 'ajustes pedidos'}`),
    e.ajustes.map((a) => h('div', { class: 'dem-ajuste' }, a.texto))));

  // ações
  const campo = h('textarea', { class: 'ent', rows: 2, placeholder: 'O que mudar? Ex.: "a cena 4 com a Ana de frente", "cabelo mais curto"' });
  const caixaAjuste = h('div', { class: 'dem-ajuste-caixa', hidden: true }, campo);
  const acoes = [];
  if (aberta && ver === x.atual) {
    if (e.status === 'aguardando') acoes.push(h('button', { class: 'btn prim', onclick: tenta(async () => { S.demandaVer.delete(x.id); await api('POST', `/api/execucoes/${x.id}/aprovar`); }) }, ic('check', 15), x.atual === x.etapas.length - 1 ? 'Aprovar e concluir' : 'Aprovar'));
    acoes.push(h('button', { class: 'btn', onclick: () => {
      if (caixaAjuste.hidden) { caixaAjuste.hidden = false; campo.focus(); return; }
      enviarAjuste();
    } }, 'Pedir ajuste'));
  } else if (ver < x.atual || x.status === 'concluida') {
    if (e.status === 'aprovada' || e.status === 'pulada') acoes.push(h('button', { class: 'btn', onclick: () => {
      if (caixaAjuste.hidden) { caixaAjuste.hidden = false; campo.placeholder = 'O que refazer nesta etapa? (opcional)'; campo.focus(); return; }
      reabrir();
    } }, 'Reabrir esta etapa'));
  }
  const enviarAjuste = tenta(async () => {
    if (!campo.value.trim()) { campo.focus(); return aviso('Escreva o que mudar'); }
    await api('POST', `/api/execucoes/${x.id}/ajuste`, { texto: campo.value.trim() });
  });
  const reabrir = tenta(async () => {
    if (!confirm(`Reabrir a etapa "${e.nome}"? As etapas seguintes vão precisar de aprovação de novo (o que já foi feito nelas continua visível).`)) return;
    await api('POST', `/api/execucoes/${x.id}/reabrir`, { etapa: ver, texto: campo.value.trim() });
    S.demandaVer.delete(x.id);
  });
  campo.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' && (ev.metaKey || ev.ctrlKey)) { ev.preventDefault(); (aberta && ver === x.atual ? enviarAjuste : reabrir)(); } });
  const encerrar = aberta ? h('button', { class: 'btn-txt dem-encerrar', onclick: tenta(async () => {
    if (!confirm(`Encerrar a demanda "${x.nome}" sem concluir? Nada é apagado: os arquivos e o que já foi feito continuam.`)) return;
    await api('POST', `/api/execucoes/${x.id}/encerrar`);
  }) }, 'Encerrar') : null;

  return h('div', { class: `demanda${aberta ? ' ativa' : ''}` }, cab, passos,
    h('div', { class: 'dem-etapa' },
      h('div', { class: 'dem-etapa-tit' }, h('b', {}, `${ver + 1}. ${e.nome}`), h('small', {}, ROTULO_ETAPA[e.status] || '')),
      corpo),
    acoes.length || encerrar ? h('div', { class: 'dem-acoes' }, caixaAjuste, h('div', { class: 'acoes-lin' }, acoes, h('span', { class: 'esp' }), encerrar)) : null);
}

// Marcador no histórico (onde a demanda começou). Aberta: só uma linha (o cartão está no fim). Fechada: o cartão compacto.
function marcadorDemanda(m) {
  const id = m.meta?.demanda;
  const x = id && S.demandas.get(id);
  if (!x) {
    if (id && !S.demandaBuscando.has(id)) { S.demandaBuscando.add(id); api('GET', `/api/execucoes/${id}`).then((d) => { S.demandas.set(d.id, d); renderMsgs(); }).catch(() => {}); }
    return h('div', { class: 'msg sistema' }, m.texto);
  }
  if (x.status === 'andamento') return h('div', { class: 'dem-marco' }, ic('etapas', 13), h('span', {}, `Começou a demanda ${x.nome}${x.titulo ? ` · ${x.titulo}` : ''}`));
  return cartaoDemanda(x, { compacto: true });
}

// Escolher a demanda pela caixa de mensagem: a próxima mensagem (com anexos) vira o briefing e abre a demanda.
function escolherDemanda(b) {
  const lista = modelosDoBot(b);
  if (demandaAtivaDo(b.id)) return aviso('Já tem uma demanda aberta', 'Aprove até o fim ou encerre no cartão antes de começar outra.');
  modal(cabModal('Iniciar demanda'),
    lista.length ? h('div', { class: 'info-cartao' }, lista.map((m) => h('button', { class: 'dem-opcao', onclick: () => {
      S.demandaEscolhida.set(b.id, m.id); fecharModal(); S.renderEscolhaDem?.(); $('#entrada')?.focus();
    } }, h('b', {}, m.nome), h('small', {}, m.etapas.map((t) => t.nome).join(' → ')))))
      : h('p', { class: 'dica' }, `${b.nome} ainda não tem demandas. Crie uma na aba Demandas do squad.`),
    h('div', { class: 'acoes-lin', style: { marginTop: '12px' } },
      h('button', { class: 'btn', onclick: () => { fecharModal(); localSet('abaSquad', 'demandas'); ir(`#/squad/${b.squad}`); } }, 'Gerenciar demandas')));
}

// Aba Demandas do squad: os modelos (por bot) e as demandas abertas e recentes.
async function renderDemandasSquad(sq, corpo) {
  const r = await api('GET', `/api/demandas?squad=${encodeURIComponent(sq.id)}`).catch(() => ({ modelos: [], execucoes: [] }));
  S.modelosDem.set(sq.id, r.modelos); guardarDemandas(r.execucoes);
  const recarregar = () => { if (S.rota.tela === 'squad' && S.rota.id === sq.id && abaSquadAtual() === 'demandas') renderDemandasSquad(sq, corpo); };
  const bs = S.estado.bots.filter((b) => b.squad === sq.id);
  const porBot = bs.map((b) => [b, r.modelos.filter((m) => m.bot === b.id)]).filter(([, ms]) => ms.length);
  const orfaos = r.modelos.filter((m) => !bs.some((b) => b.id === m.bot));
  const iniciar = (m) => { if (demandaAtivaDo(m.bot)) return aviso('Já tem uma demanda aberta', `${m.botNome} precisa terminar ou encerrar a atual.`); S.demandaEscolhida.set(m.bot, m.id); ir(`#/bot/${m.bot}`); };
  const linhaModelo = (m) => h('div', { class: 'info-item' },
    h('button', { class: 'rot-abrir', onclick: () => modalDemanda(sq, m.id, recarregar) },
      h('span', { class: 'ic-item' }, ic('etapas', 15)),
      h('span', { class: 'txt' }, h('b', {}, m.nome), h('small', {}, m.etapas.map((t) => t.nome).join(' → ')))),
    h('button', { class: 'btn min', onclick: () => iniciar(m) }, 'Iniciar'));
  const linhaExec = (x) => h('div', { class: 'info-item' },
    h('button', { class: 'rot-abrir', onclick: () => ir(`#/bot/${x.bot}`) },
      h('span', { class: 'ic-item' }, ic(x.status === 'andamento' ? 'relogio' : 'check', 15)),
      h('span', { class: 'txt' }, h('b', {}, `${x.nome}${x.titulo ? ` · ${x.titulo}` : ''}`),
        h('small', {}, `${x.botNome} · ${x.status === 'andamento' ? `etapa ${x.atual + 1} de ${x.etapas.length}: ${x.etapas[x.atual].nome}${x.etapas[x.atual].status === 'aguardando' ? ' (esperando você)' : ''}` : x.status === 'concluida' ? 'concluída' : 'encerrada'} · ${dataCurta(x.atualizado || x.criado)}`))));
  const abertas = r.execucoes.filter((x) => x.status === 'andamento');
  const recentes = r.execucoes.filter((x) => x.status !== 'andamento').slice(0, 10);
  corpo.replaceChildren(h('div', { class: 'estreito largo rotinas-squad' },
    h('div', { class: 'acoes-lin', style: { justifyContent: 'space-between', marginBottom: '6px' } },
      h('p', { class: 'dica', style: { margin: 0 } }, 'Trabalhos em etapas (ex.: roteiro → personagens → cenas → storyboard). Aberta, a demanda vira um cartão só no chat do bot, e você aprova etapa por etapa.'),
      h('button', { class: 'btn min', onclick: () => modalDemanda(sq, null, recarregar) }, ic('mais', 14), 'Nova demanda')),
    abertas.length ? secaoInfo('Em andamento', h('div', { class: 'info-cartao' }, abertas.map(linhaExec))) : null,
    porBot.map(([b, ms]) => secaoInfo(b.nome, h('div', { class: 'info-cartao' }, ms.map(linhaModelo)))),
    orfaos.length ? secaoInfo('Sem bot (troque o bot no editor)', h('div', { class: 'info-cartao' }, orfaos.map(linhaModelo))) : null,
    !r.modelos.length ? h('div', { class: 'info-cartao pad' }, h('p', { class: 'info-vazio' }, 'Nenhuma demanda ainda.')) : null,
    recentes.length ? secaoInfo('Recentes', h('div', { class: 'info-cartao' }, recentes.map(linhaExec))) : null));
}

// Criar / editar o modelo de uma demanda: nome, bot responsável, instrução geral e as etapas (cada uma com a sua instrução).
async function modalDemanda(sq, id, aoSalvar) {
  const lista = S.modelosDem.get(sq.id) || await carregarModelosDem(sq.id);
  const m = id ? lista.find((x) => x.id === id) : null;
  const bs = S.estado.bots.filter((b) => b.squad === sq.id);
  const nome = h('input', { class: 'ent', value: m?.nome || '', placeholder: 'Ex.: Novo roteiro', maxlength: 80 });
  const botSel = h('select', { class: 'ent' }, bs.map((b) => h('option', { value: b.id, selected: m?.bot === b.id }, b.nome)));
  const desc = h('input', { class: 'ent', value: m?.descricao || '', placeholder: 'Uma linha sobre o que ela entrega', maxlength: 400 });
  const instr = h('textarea', { class: 'ent', rows: 3, style: { fontFamily: 'var(--sans)', fontSize: '14px' }, placeholder: 'Vale para todas as etapas (opcional). Ex.: "estilo Pixar, vídeo vertical"' }, m?.instrucao || '');
  let etapas = (m?.etapas || [{ nome: '', instrucao: '' }]).map((e) => ({ ...e }));
  const listaEl = h('div', { class: 'dem-edit-etapas' });
  const desenhar = () => listaEl.replaceChildren(...etapas.map((e, i) => {
    const n = h('input', { class: 'ent', value: e.nome, placeholder: `Etapa ${i + 1}`, maxlength: 60, oninput: () => { e.nome = n.value; } });
    const t = h('textarea', { class: 'ent', rows: 2, placeholder: 'O que o bot faz e entrega nesta etapa', oninput: () => { e.instrucao = t.value; } }, e.instrucao || '');
    const mover = (d) => { const j = i + d; if (j < 0 || j >= etapas.length) return; [etapas[i], etapas[j]] = [etapas[j], etapas[i]]; desenhar(); };
    return h('div', { class: 'dem-edit-etapa' },
      h('div', { class: 'acoes-lin', style: { flexWrap: 'nowrap' } }, h('span', { class: 'dem-bola' }, String(i + 1)), n,
        h('button', { class: 'btn-txt', title: 'Subir', onclick: () => mover(-1) }, ic('cima', 15)),
        h('button', { class: 'btn-txt', title: 'Descer', onclick: () => mover(1) }, ic('baixo', 15)),
        h('button', { class: 'btn-txt', title: 'Tirar esta etapa', onclick: () => { if (etapas.length > 1) { etapas.splice(i, 1); desenhar(); } } }, ic('fechar', 15))),
      t);
  }));
  desenhar();
  const salvar = tenta(async () => {
    const corpo = { nome: nome.value.trim(), bot: botSel.value, descricao: desc.value.trim(), instrucao: instr.value.trim(), etapas: etapas.filter((e) => e.nome.trim()) };
    if (m) await api('PATCH', `/api/demandas/${m.id}`, corpo); else await api('POST', '/api/demandas', corpo);
    fecharModal(); aviso('Demanda salva'); await carregarModelosDem(sq.id); aoSalvar?.();
  });
  modal(cabModal(m ? 'Editar demanda' : 'Nova demanda'),
    h('label', { class: 'campo' }, 'Nome', nome),
    h('label', { class: 'campo' }, 'Bot responsável', botSel),
    h('label', { class: 'campo' }, 'Descrição', desc),
    h('label', { class: 'campo' }, 'Instrução geral', instr),
    h('div', { class: 'campo' }, 'Etapas', listaEl, h('button', { class: 'btn min', style: { alignSelf: 'flex-start' }, onclick: () => { etapas.push({ nome: '', instrucao: '' }); desenhar(); } }, ic('mais', 14), 'Etapa')),
    h('div', { class: 'acoes-lin' },
      h('button', { class: 'btn prim', onclick: salvar }, 'Salvar'),
      m ? h('button', { class: 'btn perigo', onclick: tenta(async () => {
        if (!confirm(`Apagar o modelo da demanda "${m.nome}"? As demandas que já rodaram continuam no histórico.`)) return;
        await api('DELETE', `/api/demandas/${m.id}`); fecharModal(); await carregarModelosDem(sq.id); aoSalvar?.();
      }) }, 'Apagar') : null));
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
      tarefa_criar: `Criou tarefa ${r}`, tarefa_atualizar: 'Atualizou a tarefa', bot_enviar: `Falou com @${r}`, arquivo_entregar: `Entregou ${arq(r)}`, quadro_entregar: 'Montou o quadro', demanda_etapa: 'Atualizou o cartão da demanda', demanda_ver: 'Olhou a demanda', historico_buscar: 'Procurando no histórico',
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
    if (m.papel === 'voz') { nos.push(cartaoVoz(m)); continue; }
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
    } else if (m.papel === 'quadro') {
      nos.push(blocoQuadro(m.meta || {}));
    } else if (m.papel === 'demanda') {
      nos.push(marcadorDemanda(m));
    } else {
      nos.push(h('div', { class: 'msg sistema' }, m.texto));
    }
  }
  fecharGrupo(trabalhando && !S.deltas.get(b.id));
  for (const ap of (S.estado.aprovacoes || []).filter((a) => a.bot === b.id)) nos.push(cartaoAprovacao(ap));
  const delta = S.deltas.get(b.id);
  if (delta) nos.push(h('div', { class: 'msg bot md digitando', html: md(delta) }));
  const demAtiva = demandaAtivaDo(b.id);
  if (demAtiva) nos.push(cartaoDemanda(demAtiva));

  if (!lista.length && !delta && !demAtiva) {
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
  const escolhaDem = h('div', { class: 'dem-escolha' });
  const renderEscolhaDem = () => {
    const mid = S.demandaEscolhida.get(b.id);
    const m = mid && (S.modelosDem.get(b.squad) || []).find((x) => x.id === mid);
    ta.placeholder = m ? 'Mande o briefing (texto, roteiro, imagens): ele abre a demanda' : `Mensagem para ${b.nome}`;
    escolhaDem.replaceChildren(...(m ? [h('span', { class: 'anexo dem-chip' }, ic('etapas', 13), h('span', {}, `Nova demanda: ${m.nome}`),
      h('button', { class: 'btn-txt', title: 'Cancelar', style: { fontSize: '13px', padding: '0 2px' }, onclick: () => { S.demandaEscolhida.delete(b.id); renderEscolhaDem(); } }, ic('fechar', 13)))] : []));
    btDem.hidden = !modelosDoBot(b).length && !m;
  };
  const btDem = h('button', { class: 'btn-txt', title: 'Iniciar uma demanda (trabalho em etapas)', onclick: () => escolherDemanda(b) }, ic('etapas', 19));
  S.renderEscolhaDem = renderEscolhaDem;
  if (!S.modelosDem.has(b.squad)) carregarModelosDem(b.squad).then(renderEscolhaDem); else setTimeout(renderEscolhaDem);
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
  const mic = botaoMicrofone(ta, (f) => subir(f), () => { ajustar(); atualizarBotao(); localSet(`rascunho:${b.id}`, ta.value); }, () => enviar());
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
    const demEscolhida = S.demandaEscolhida.get(b.id);
    try {
      if (demEscolhida) {
        const x = await api('POST', `/api/demandas/${demEscolhida}/iniciar`, { bot: b.id, texto, anexos: tokens });
        S.demandaEscolhida.delete(b.id); S.demandas.set(x.id, x); renderEscolhaDem(); renderMsgs(true);
      } else await api('POST', `/api/bots/${b.id}/mensagens`, { texto, anexos: tokens });
    }
    catch (e) {
      const l = S.msgs.get(b.id); l.splice(l.indexOf(provisoria), 1); S.pendente.delete(b.id); renderMsgs();
      if (!ta.value) ta.value = texto; S.anexos = anexosAntes; renderAnexos(); ajustar(); atualizarBotao(); throw e;
    }
  });
  const parar = tenta(() => api('POST', `/api/bots/${b.id}/parar`, {}));

  return h('div', { class: 'compositor' }, h('div', { class: 'estreito' },
    h('div', { class: 'fila-painel', id: 'fila-painel' }),
    h('div', { class: 'caixa', ondragover: (e) => e.preventDefault(), ondrop: (e) => { e.preventDefault(); for (const f of e.dataTransfer.files) subir(f); } },
      escolhaDem, anexos, ta,
      h('div', { class: 'linha' },
        h('button', { class: 'btn-txt', title: 'Anexar arquivo (vídeo, roteiro…)', onclick: () => arquivo.click() }, ic('mais', 20)), arquivo, btDem,
        seletorModelo(b), ...seletoresMidia(b), seletorContexto(b),
        h('span', { class: 'esp', id: 'fila-info' }),
        mic, h('button', { type: 'button', class: 'btn-txt mic', title: `Conversa ao vivo com ${b.nome}`, 'aria-label': 'Conversa ao vivo', onclick: () => conversaAoVivo(b) }, ic('onda', 19)), botaoParar, botao))));
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
// Os modelos vêm do servidor: no motor ChatGPT, os que a conta do usuário tem (lidos pelo Codex); no Claude, a lista fixa.
let MODELOS = [
  ['fable', 'Fable 5.1', 'O mais capaz, para o trabalho mais difícil'],
  ['opus', 'Opus 5.5', 'Raciocínio forte para trabalho complexo'],
  ['sonnet', 'Sonnet 5.5', 'Equilíbrio entre qualidade e velocidade'],
  ['haiku', 'Haiku 5.5', 'O mais rápido, para tarefas simples'],
];
// Cada bot pode rodar num motor: ChatGPT (codex) ou Claude. Guardamos a lista de modelos de cada um.
const LISTA_DE = { claude: MODELOS.slice(), codex: [], grok: [] };
const ESFORCOS_DE = { claude: {}, codex: {}, grok: {} }; // motor -> modelo -> esforços aceitos
const PADRAO_DE = { claude: 'opus', codex: null, grok: null };
const motorDe = (bb) => bb?.motor || S.estado?.config?.motor || 'claude';
const NOMES_MOTOR = { codex: 'ChatGPT', claude: 'Claude', grok: 'Grok' };
let GROK_PRONTO = false; // instalado e com login (Conectores › Grok)
function carregarModelos() {
  // a lista do Claude é fixa (MODELOS, acima); a do motor padrão do servidor vem da conta (ChatGPT: lida pelo Codex)
  {
    api('GET', '/api/modelos').then((r) => {
      if (!r?.modelos?.length) return;
      const mo = r.motor === 'codex' ? 'codex' : 'claude';
      LISTA_DE[mo] = r.modelos.map((m) => [m.id, m.nome, m.descricao]);
      ESFORCOS_DE[mo] = Object.fromEntries(r.modelos.map((m) => [m.id, m.esforcos || []]));
      PADRAO_DE[mo] = (r.modelos.find((m) => m.padrao) || r.modelos[0]).id;
      document.querySelectorAll('.seletor-modelo').forEach((el) => el.atualizar?.());
    }).catch(() => {});
  }
  api('GET', '/api/modelos/grok').then((r) => {
    GROK_PRONTO = !!(r?.instalado && r?.logado);
    if (!r?.modelos?.length) return;
    LISTA_DE.grok = r.modelos.map((m) => [m.id, m.nome, m.descricao]);
    ESFORCOS_DE.grok = Object.fromEntries(r.modelos.map((m) => [m.id, m.esforcos || []]));
    PADRAO_DE.grok = (r.modelos.find((m) => m.padrao) || r.modelos[0]).id;
    document.querySelectorAll('.seletor-modelo').forEach((el) => el.atualizar?.());
  }).catch(() => {});
}
const ESFORCOS = [['low', 'Baixo'], ['medium', 'Médio'], ['high', 'Alto'], ['xhigh', 'Extra'], ['max', 'Máximo'], ['ultra', 'Ultra']];
// o modelo salvo no bot pode ser de outro motor (ex.: "opus" depois de mudar para o ChatGPT): aí vale o padrão
const listaDoBot = (bb) => (LISTA_DE[motorDe(bb)]?.length ? LISTA_DE[motorDe(bb)] : LISTA_DE.claude);
const modeloAtual = (bb) => {
  const l = listaDoBot(bb), pad = PADRAO_DE[motorDe(bb)];
  const m = bb.modelo || pad || 'opus';
  return l.some(([v]) => v === m) ? m : (pad || l[0][0]);
};
// IA de vídeo/imagem do bot (templates com "seletorMidia", ex.: Roteirista → kie.ai). Grava na preferência do bot
// (o bot lê nas preferências a cada turno). Valor "Nome · id-do-modelo": o botão mostra só o nome.
const nomeMidia = (v) => String(v || '').split(' · ')[0];
function seletoresMidia(b) {
  const t = template(b.template);
  return (t?.seletorMidia || []).map((chave) => {
    const p = (t.preferencias || []).find((x) => x.chave === chave);
    if (!p) return null;
    const atual = () => (bot(b.id) || b).prefs?.[chave] || p.padrao || '';
    const bt = h('button', { class: 'seletor-modelo seletor-midia', title: p.rotulo }, ic(p.icone || 'filme', 14), h('span', {}, nomeMidia(atual())), ic('baixo', 12));
    const mudar = (v) => tenta(async () => {
      fecharMenu();
      const bb = bot(b.id) || b;
      const prefs = { ...(bb.prefs || {}), [chave]: v };
      bb.prefs = prefs;
      bt.querySelector('span').textContent = nomeMidia(v);
      await salvarBot(b.id, { prefs });
      aviso(`${p.rotulo}: ${nomeMidia(v)}`, 'A próxima geração do bot já usa esta.');
    })();
    bt.onclick = (e) => {
      e.stopPropagation();
      if ($('#menu-pop')) return fecharMenu();
      const sel = atual();
      const m = h('div', { class: 'menu-pop menu-modelo', id: 'menu-pop', role: 'menu', onclick: (ev) => ev.stopPropagation() },
        h('div', { class: 'menu-rot' }, p.rotulo),
        ...(p.opcoes || []).map((v) => h('button', { class: `menu-item${v === sel ? ' sel' : ''}`, onclick: () => mudar(v) },
          h('span', { class: 'txt' }, h('b', {}, nomeMidia(v)), h('small', {}, (v.split(' · ')[1] || '') + (v === p.padrao ? ' · padrão' : ''))),
          v === sel ? h('span', { class: 'marca-sel' }, ic('check', 16)) : null)));
      document.body.append(m);
      const r = bt.getBoundingClientRect();
      m.style.left = `${Math.max(8, Math.min(r.left, innerWidth - m.offsetWidth - 8))}px`;
      m.style.top = `${Math.max(8, r.top - m.offsetHeight - 8)}px`;
    };
    return bt;
  }).filter(Boolean);
}

function seletorModelo(b) {
  const rotulo = () => {
    const bb = bot(b.id) || b;
    const m = modeloAtual(bb);
    const nome = (listaDoBot(bb).find(([v]) => v === m)?.[1] || m).replace(/ [\d.]+$/, '');
    const esf = ESFORCOS.find(([v]) => v === bb.esforco)?.[1];
    return esf ? `${nome} · ${esf}` : nome;
  };
  const bt = h('button', { class: 'seletor-modelo', title: 'Modelo de IA deste bot' }, h('span', {}, rotulo()), ic('baixo', 12));
  bt.atualizar = () => { bt.firstChild.textContent = rotulo(); };
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
    const atual = modeloAtual(bb);
    // Esforço: um controle deslizante (Padrão → Máximo) preenchido com um degradê na cor do planeta do bot.
    const aceitos = ESFORCOS_DE[motorDe(bb)]?.[atual];
    const niveis = [['', 'Padrão'], ...ESFORCOS.filter(([v]) => aceitos ? aceitos.includes(v) : v !== 'ultra')];
    const idx = Math.max(0, niveis.findIndex(([v]) => v === (bb.esforco || '')));
    const valor = h('span', { class: 'esforco-valor' }, niveis[idx][1]);
    const faixa = h('input', { type: 'range', class: 'esforco-faixa', min: 0, max: niveis.length - 1, step: 1, value: idx, 'aria-label': 'Esforço de raciocínio' });
    const pintar = () => { const i = Number(faixa.value); faixa.style.setProperty('--pct', `${(i / (niveis.length - 1)) * 100}%`); valor.textContent = niveis[i][1]; };
    faixa.addEventListener('input', pintar);
    faixa.addEventListener('change', () => mudar({ esforco: niveis[Number(faixa.value)][0] }, { fechar: false }));
    pintar();
    // interruptor do motor: troca e já escolhe o modelo padrão do outro (a memória e a função continuam)
    const motor = motorDe(bb);
    const trocarMotor = (mo) => { if (mo === 'grok' && !GROK_PRONTO && motor !== 'grok') { fecharMenu(); aviso('O Grok ainda não está pronto', 'Instale e entre na sua conta em Conectores › Grok.', { erro: true }); return; } if (mo !== motor) { fecharMenu(); mudar({ motor: mo, modelo: PADRAO_DE[mo] || '' }); aviso(`${bb.nome} agora no ${NOMES_MOTOR[mo]}`, 'A próxima mensagem já usa o motor novo. Memória, função e tarefas continuam.'); } };
    const m = h('div', { class: 'menu-pop menu-modelo', id: 'menu-pop', role: 'menu', style: `--bolha: ${corDoPlaneta(avatarDe(bb).planeta)}`, onclick: (ev) => ev.stopPropagation() },
      h('div', { class: 'segmento motor-seg' }, ['codex', 'claude', 'grok'].map((mo) => h('button', { class: mo === motor ? 'sel' : '', onclick: () => trocarMotor(mo) }, NOMES_MOTOR[mo]))),
      ...listaDoBot(bb).map(([v, nome, desc]) => h('button', { class: `menu-item${v === atual ? ' sel' : ''}`, onclick: () => mudar({ modelo: v }) },
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
  // "na fila" = esperando (outro trabalho pesado, limite do ChatGPT): a fila também aparece
  const ocupado = b.status === 'trabalhando' || b.status === 'na fila' || b.esperandoPesado;
  if (!b.pausado && !(itens.length && ocupado)) { el.replaceChildren(); el.hidden = true; return; }
  el.hidden = false;
  const acao = (metodo, url) => tenta(() => api(metodo, url));
  // minimizar/maximizar (fica lembrado): minimizada, só o cabeçalho com a contagem, para não tapar o chat
  const minimizada = localGet('filaMin') === '1';
  const alternarFila = () => { localSet('filaMin', minimizada ? '0' : '1'); renderFila(b); };
  el.classList.toggle('minimizada', minimizada);
  el.replaceChildren(
    h('div', { class: 'fila-cab' },
      h('button', { class: 'fila-titulo', title: minimizada ? 'Mostrar a fila' : 'Minimizar a fila', onclick: alternarFila },
        h('span', { class: 'fila-seta' }, ic(minimizada ? 'cima' : 'baixo', 13)),
        b.pausado ? `Fila pausada${itens.length ? ` · ${itens.length} esperando` : ''}` : `Na fila · ${itens.length}`),
      h('button', { class: 'fila-acao', onclick: tenta(() => api('POST', `/api/bots/${b.id}/pausar`, { pausado: !b.pausado })) },
        ic(b.pausado ? 'play' : 'pausa', 13, { preenchido: b.pausado }), b.pausado ? 'Retomar' : 'Pausar fila')),
    ...(minimizada ? [] : itens).map((it, i) => h('div', { class: 'fila-item' },
      h('span', { class: 'txt' }, it.de ? h('small', {}, `${it.de} · `) : null, it.texto),
      i > 0 ? h('button', { class: 'btn-txt', title: 'Passar na frente', onclick: acao('POST', `/api/bots/${b.id}/fila/${it.id}/frente`) }, ic('cima', 14)) : null,
      h('button', { class: 'btn-txt', title: 'Tirar da fila', onclick: acao('DELETE', `/api/bots/${b.id}/fila/${it.id}`) }, ic('fechar', 14)))));
}

const ehIOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const ehApp = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const avisoMicBloqueado = () => aviso('Microfone bloqueado', ehIOS ? 'Libere o microfone em Ajustes › Safari › Microfone (ou toque em "Permitir" quando o iPhone perguntar).' : 'Libere o microfone para este site nas permissões do navegador.', { erro: true });
const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

// Onda do microfone: barrinhas que sobem com o volume, desenhadas num canvas a partir de um AnalyserNode.
function ondaAoVivo(stream) {
  const cv = h('canvas', { class: 'onda-cv' });
  let ctx = null, an = null, raf = 0;
  try {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    an = ctx.createAnalyser(); an.fftSize = 512;
    ctx.createMediaStreamSource(stream).connect(an);
  } catch {}
  const dados = an ? new Uint8Array(an.fftSize) : null;
  const hist = [];
  let ultimo = 0;
  const desenhar = (t) => {
    raf = requestAnimationFrame(desenhar);
    const w = cv.clientWidth, alt = cv.clientHeight, dpr = devicePixelRatio || 1;
    if (!w) return;
    if (cv.width !== w * dpr) { cv.width = w * dpr; cv.height = alt * dpr; }
    if (t - ultimo > 60) {
      ultimo = t;
      let pico = 0;
      if (an) { an.getByteTimeDomainData(dados); for (const v of dados) pico = Math.max(pico, Math.abs(v - 128) / 128); }
      hist.push(Math.min(1, pico * 2.2));
    }
    const g = cv.getContext('2d');
    g.clearRect(0, 0, cv.width, cv.height);
    g.fillStyle = getComputedStyle(cv).color;
    const passo = 5 * dpr, larg = 2.5 * dpr, n = Math.floor(cv.width / passo);
    while (hist.length > n) hist.shift();
    hist.forEach((v, i) => {
      const hh = Math.max(2 * dpr, v * cv.height * 0.9);
      const x = cv.width - (hist.length - i) * passo;
      g.beginPath(); g.roundRect ? g.roundRect(x, (cv.height - hh) / 2, larg, hh, larg / 2) : g.rect(x, (cv.height - hh) / 2, larg, hh); g.fill();
    });
  };
  raf = requestAnimationFrame(desenhar);
  cv.parar = () => { cancelAnimationFrame(raf); try { ctx?.close(); } catch {} };
  return cv;
}

// Ditado: o microfone grava (MediaRecorder) e o áudio vai para o PC, que transcreve com o Whisper na placa de vídeo
// (/api/ditado). Gravando, a caixa vira uma faixa com a onda do som e três botões: cancelar, parar (o texto cai na
// caixa para revisar) e enviar direto. Se a transcrição falhar, a gravação fica guardada: tentar de novo, anexar o
// áudio à mensagem ou descartar.
function botaoMicrofone(ta, anexar, aoMudar, enviarJa = null) {
  const bt = h('button', { type: 'button', class: 'btn-txt mic', title: 'Falar (vira texto)', 'aria-label': 'Microfone' }, ic('microfone', 19));
  let faixa = null;
  const fechar = () => { faixa?.cv?.parar?.(); faixa?.remove(); faixa = null; bt.closest('.caixa')?.classList.remove('com-faixa'); };
  const escrever = (txt) => {
    if (!txt) return;
    ta.value = (ta.value ? `${ta.value.replace(/\s+$/, '')} ` : '') + txt;
    aoMudar();
  };
  const montar = (...filhos) => {
    const caixa = bt.closest('.caixa');
    faixa?.cv?.parar?.(); faixa?.remove();
    faixa = h('div', { class: 'faixa-mic' }, ...filhos);
    caixa.classList.add('com-faixa');
    caixa.append(faixa);
    return faixa;
  };
  const botao = (cls, titulo, icn, fn, txt = null) => h('button', { type: 'button', class: `fm-bt ${cls}`, title: titulo, 'aria-label': titulo, onclick: (e) => { e.preventDefault(); fn(); } }, ic(icn, 17), txt ? h('span', {}, txt) : null);

  async function transcrever(blob, tipo, mandar) {
    montar(h('span', { class: 'fm-status' }, 'Transcrevendo', h('i', { class: 'pontinhos' }, h('b', {}, '.'), h('b', {}, '.'), h('b', {}, '.'))));
    try {
      const r = await fetch('/api/ditado', { method: 'PUT', headers: { 'x-claude-flow': '1', 'content-type': tipo }, body: blob });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.erro || `erro ${r.status}`);
      fechar();
      if (!j.texto) { aviso('Não entendi', 'Não deu para ouvir nada no áudio. Tente de novo mais perto do microfone.'); return; }
      escrever(j.texto);
      if (mandar && enviarJa) enviarJa(); else ta.focus();
    } catch (e) {
      const ext = tipo.includes('mp4') ? 'm4a' : 'webm';
      montar(
        h('span', { class: 'fm-status erro' }, 'A transcrição falhou'),
        h('span', { class: 'esp' }),
        botao('', 'Descartar a gravação', 'fechar', fechar),
        botao('', 'Anexar o áudio à mensagem', 'anexo', () => { fechar(); anexar(new File([blob], `audio-${new Date().toTimeString().slice(0, 8).replace(/:/g, '')}.${ext}`, { type: tipo })); }),
        botao('prim', 'Tentar de novo', 'repetir', () => transcrever(blob, tipo, mandar), 'Tentar de novo'));
      faixa.title = e.message;
    }
  }

  async function gravar() {
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }); }
    catch { avisoMicBloqueado(); return; }
    const tipos = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm'];
    const mime = tipos.find((t) => window.MediaRecorder?.isTypeSupported?.(t)) || '';
    const partes = [];
    const gravador = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    let acao = 'cancelar';
    gravador.ondataavailable = (e) => { if (e.data?.size) partes.push(e.data); };
    gravador.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      clearInterval(relogio);
      const tipo = (gravador.mimeType || mime || 'audio/webm').split(';')[0];
      const blob = new Blob(partes, { type: tipo });
      if (acao === 'cancelar' || blob.size < 1200) { fechar(); return; } // cancelado, ou toque sem fala
      transcrever(blob, tipo, acao === 'enviar');
    };
    const parar = (a) => { acao = a; if (gravador.state !== 'inactive') gravador.stop(); };
    const tempo = h('span', { class: 'fm-tempo' }, '0:00');
    const inicio = Date.now();
    const relogio = setInterval(() => { tempo.textContent = mmss((Date.now() - inicio) / 1000); }, 500);
    const f = montar(
      botao('', 'Cancelar', 'fechar', () => parar('cancelar')),
      ondaAoVivo(stream), tempo,
      botao('', 'Parar: o texto vai para a caixa', 'check', () => parar('caixa')),
      enviarJa ? botao('prim redondo', 'Enviar direto', 'enviar', () => parar('enviar')) : null);
    f.cv = f.querySelector('canvas');
    gravador.start(250);
    if (navigator.vibrate) navigator.vibrate(15);
  }
  bt.onclick = (ev) => { ev.preventDefault(); if (!faixa) gravar(); };
  return bt;
}


// ---------- conversa ao vivo por voz (servidor: voz.js) ----------
// O áudio vai direto entre este aparelho e a OpenAI (WebRTC); o servidor só abre a chamada com a chave. Pela
// conexão de dados chegam os eventos: o que você falou, o que a voz falou e os pedidos ao bot de verdade
// (pedir_ao_bot), que este app repassa ao servidor e devolve o resultado. Ao desligar, o texto vira um cartão no chat.
const LIMITE_CHAMADA = 30 * 60;
async function conversaAoVivo(b) {
  if (S.chamada) return;
  const est = await api('GET', '/api/voz').catch(() => null);
  if (!est) return aviso('Conversa por voz indisponível', 'O servidor ainda não tem essa função. Tente de novo em alguns minutos.', { erro: true });
  if (!est.ligada) return modalChaveVoz(() => conversaAoVivo(b));
  if (typeof RTCPeerConnection === 'undefined') return aviso('Este navegador não faz chamada de voz', '', { erro: true });

  const ch = { bot: b.id, falas: [], porItem: new Map(), chamadas: new Set(), inicio: 0, segundos: 0, mudo: false, fim: false, pendente: false, ativa: false };
  S.chamada = ch;
  const status = h('span', { class: 'vz-status' }, 'Conectando…');
  const tempo = h('span', { class: 'vz-tempo' }, '0:00');
  const legenda = h('div', { class: 'vz-legenda' });
  const btMudo = h('button', { class: 'vz-bt', title: 'Mudo', 'aria-label': 'Mudo', onclick: () => mudo() }, ic('microfone', 20));
  const planeta = h('span', { class: 'vz-planeta', html: avatarSVG(avatarDe(b), { tamanho: 44, animado: true }) });
  const painel = h('div', { class: 'vz-painel', role: 'dialog', 'aria-label': `Conversa por voz com ${b.nome}` },
    h('div', { class: 'vz-cab' }, planeta, h('div', { class: 'vz-txt' }, h('b', {}, b.nome), h('div', {}, status, ' · ', tempo))),
    legenda,
    h('div', { class: 'vz-acoes' }, btMudo, h('button', { class: 'vz-bt desligar', title: 'Desligar', 'aria-label': 'Desligar', onclick: () => desligar() }, ic('fechar', 20))));
  document.body.append(painel);
  const estado = (txt, cls = '') => { status.textContent = txt; painel.dataset.estado = cls; };

  let stream = null, pc = null, dc = null, audio = null, relogio = null;
  const enviarEvento = (ev) => { try { if (dc?.readyState === 'open') dc.send(JSON.stringify(ev)); } catch {} };
  const fala = (id, papel) => {
    let f = ch.porItem.get(id);
    if (!f) { f = { papel, texto: '' }; ch.porItem.set(id, f); ch.falas.push(f); }
    return f;
  };
  const mostrarLegenda = (f) => { legenda.textContent = f.texto.slice(-180); legenda.dataset.papel = f.papel; };
  const responder = () => { if (ch.ativa) { ch.pendente = true; return; } ch.ativa = true; enviarEvento({ type: 'response.create' }); };

  async function ferramenta(call) {
    if (!call?.call_id || ch.chamadas.has(call.call_id)) return;
    ch.chamadas.add(call.call_id);
    let r;
    try {
      if (call.name !== 'pedir_ao_bot') throw new Error('ferramenta desconhecida');
      const { pedido } = JSON.parse(call.arguments || '{}');
      estado(`Pedindo ao ${b.nome}…`, 'trabalhando');
      ch.falas.push({ papel: 'usuario', texto: `(pedido ao ${b.nome}) ${pedido}`, pedido: true });
      r = await api('POST', `/api/voz/${b.id}/pedir`, { pedido });
    } catch (e) { r = { erro: e.message }; }
    if (ch.fim) return;
    estado('Ouvindo', 'ouvindo');
    enviarEvento({ type: 'conversation.item.create', item: { type: 'function_call_output', call_id: call.call_id, output: JSON.stringify(r) } });
    responder();
  }

  function evento(ev) {
    switch (ev.type) {
      case 'input_audio_buffer.speech_started': estado('Ouvindo você', 'ouvindo'); break;
      case 'input_audio_buffer.committed': fala(ev.item_id, 'usuario'); break;
      case 'conversation.item.input_audio_transcription.completed': { const f = fala(ev.item_id, 'usuario'); f.texto = String(ev.transcript || '').trim(); mostrarLegenda(f); break; }
      case 'response.created': ch.ativa = true; break;
      case 'response.output_audio_transcript.delta': { const f = fala(ev.item_id, 'bot'); f.texto += ev.delta || ''; mostrarLegenda(f); break; }
      case 'response.output_audio_transcript.done': { const f = fala(ev.item_id, 'bot'); f.texto = String(ev.transcript || f.texto).trim(); break; }
      case 'output_audio_buffer.started': estado('Falando', 'falando'); break;
      case 'output_audio_buffer.stopped': if (painel.dataset.estado === 'falando') estado('Ouvindo', 'ouvindo'); break;
      case 'output_audio_buffer.cleared': { const ult = [...ch.falas].reverse().find((f) => f.papel === 'bot'); if (ult) ult.interrompida = true; estado('Ouvindo', 'ouvindo'); break; }
      case 'response.done': {
        ch.ativa = false;
        for (const it of ev.response?.output || []) if (it.type === 'function_call') ferramenta(it);
        if (ch.pendente) { ch.pendente = false; responder(); }
        break;
      }
      case 'error':
        if (ev.error?.code === 'conversation_already_has_active_response') { ch.ativa = true; ch.pendente = true; break; }
        aviso('Erro na conversa por voz', ev.error?.message || '', { erro: true });
        break;
    }
  }

  function mudo() {
    ch.mudo = !ch.mudo;
    stream?.getAudioTracks().forEach((t) => { t.enabled = !ch.mudo; });
    btMudo.classList.toggle('sel', ch.mudo);
    btMudo.replaceChildren(ic(ch.mudo ? 'mudo' : 'microfone', 20));
    if (ch.mudo) estado('No mudo', 'mudo'); else estado('Ouvindo', 'ouvindo');
  }

  function desligar(motivo = null) {
    if (ch.fim) return;
    ch.fim = true;
    clearInterval(relogio);
    try { dc?.close(); } catch {}
    try { pc?.close(); } catch {}
    stream?.getTracks().forEach((t) => t.stop());
    if (audio) { audio.pause(); audio.srcObject = null; audio.remove(); }
    painel.remove();
    S.chamada = null;
    if (motivo) aviso('Conversa por voz encerrada', motivo, { erro: true });
    const falas = ch.falas.filter((f) => f.texto && !f.pedido).map((f) => ({ papel: f.papel, texto: f.texto, ...(f.interrompida ? { interrompida: true } : {}) }));
    if (falas.length) api('POST', `/api/voz/${b.id}/fim`, { transcricao: falas, segundos: ch.segundos }).catch((e) => aviso('Não salvou a conversa por voz', e.message, { erro: true }));
  }

  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    if (ch.fim) { stream.getTracks().forEach((t) => t.stop()); return; }
    pc = new RTCPeerConnection();
    audio = h('audio', { autoplay: true, playsinline: true });
    audio.hidden = true;
    document.body.append(audio);
    pc.ontrack = (e) => { audio.srcObject = e.streams[0] || new MediaStream([e.track]); audio.play().catch(() => aviso('Som bloqueado', 'Toque na tela e tente de novo.', { erro: true })); };
    pc.onconnectionstatechange = () => { if (['failed', 'disconnected'].includes(pc.connectionState)) desligar('A conexão caiu. O que foi falado até aqui ficou salvo no chat.'); };
    for (const t of stream.getAudioTracks()) pc.addTrack(t, stream);
    dc = pc.createDataChannel('oai-events');
    dc.onmessage = (e) => { try { evento(JSON.parse(e.data)); } catch {} };
    dc.onopen = () => {
      ch.inicio = Date.now();
      estado('Pode falar', 'ouvindo');
      relogio = setInterval(() => {
        ch.segundos = Math.floor((Date.now() - ch.inicio) / 1000);
        tempo.textContent = mmss(ch.segundos);
        if (ch.segundos >= LIMITE_CHAMADA) desligar('A chamada chegou a 30 minutos. Ligue de novo se quiser continuar.');
      }, 1000);
      if (navigator.vibrate) navigator.vibrate(20);
    };
    const oferta = await pc.createOffer();
    await pc.setLocalDescription(oferta);
    const r = await api('POST', `/api/voz/${b.id}/chamada`, { sdp: oferta.sdp });
    if (ch.fim) return;
    await pc.setRemoteDescription({ type: 'answer', sdp: r.sdp });
  } catch (e) {
    if (e?.name === 'NotAllowedError' || e?.name === 'NotFoundError') { desligar(); avisoMicBloqueado(); return; }
    desligar(e.message || 'Não deu para ligar.');
  }
}

function modalChaveVoz(depois = null) {
  const ent = h('input', { class: 'ent', type: 'password', placeholder: 'sk-…', autocomplete: 'off', spellcheck: false });
  modal(cabModal('Conversa por voz'),
    h('p', { class: 'dica' }, 'A conversa ao vivo usa o modelo de voz em tempo real da OpenAI (gpt-realtime). Ele precisa de uma chave da API da OpenAI (platform.openai.com › API keys), que é cobrada por minuto de conversa — a assinatura do ChatGPT não cobre. A chave fica só neste PC.'),
    h('label', { class: 'campo' }, 'Chave da API da OpenAI', ent),
    h('div', { class: 'acoes-lin', style: { marginTop: '12px' } },
      h('button', { class: 'btn prim', onclick: tenta(async () => {
        if (!ent.value.trim()) throw new Error('Cole a chave.');
        await api('PUT', '/api/voz/chave', { chave: ent.value.trim() });
        fecharModal(); aviso('Chave salva', 'A conversa por voz está ligada.');
        depois?.();
      }) }, 'Salvar'),
      h('button', { class: 'btn', onclick: fecharModal }, 'Cancelar')));
  setTimeout(() => ent.focus(), 50);
}

function cartaoVoz(m) {
  const t = m.meta?.transcricao || [];
  const min = Math.max(1, Math.round((m.meta?.segundos || 0) / 60));
  return h('div', { class: 'msg voz-cartao' },
    h('div', { class: 'de' }, ic('onda', 14), `Conversa por voz · ${m.meta?.segundos ? `${min} min` : `${t.length} falas`}`),
    h('div', { class: 'md', html: md(m.texto) }),
    t.length ? h('details', {}, h('summary', {}, 'Ver a conversa'),
      h('div', { class: 'voz-transcricao' }, t.map((x) => h('p', { class: x.papel }, h('b', {}, x.papel === 'usuario' ? 'Você' : (bot(m.bot)?.nome || 'Bot')), ` ${x.texto}${x.interrompida ? ' (interrompida)' : ''}`)))) : null);
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
// Tudo do squad numa tela, em abas: Relevantes, Tarefas (kanban), Spy e Conectores.
// A Galáxia (o grupo do squad) não é aba daqui: é um chat próprio (#/galaxia/<squad>), aberto pela lateral.
const ABAS_SQUAD = [['relevantes', 'Relevantes'], ['tarefas', 'Tarefas'], ['spy', 'Spy'], ['rotinas', 'Rotinas'], ['demandas', 'Demandas'], ['conectores', 'Conectores']];
async function renderSquad(sq) {
  const p = $('#principal');
  const bs = S.estado.bots.filter((b) => b.squad === sq.id);
  const aba = abaSquadAtual();
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
  if (aba === 'spy') return renderSpy(sq, corpo);
  if (aba === 'relevantes') return renderRelevantes(sq, corpo);
  if (aba === 'rotinas') return renderRotinasSquad(sq, corpo);
  if (aba === 'demandas') return renderDemandasSquad(sq, corpo);
  if (aba === 'conectores') {
    const ligados = new Set(sq.conectores || []);
    corpo.replaceChildren(h('div', { class: 'estreito largo' },
      h('p', { class: 'dica' }, 'Todos os bots deste squad usam os conectores ligados aqui. Ligue só o que o squad usa: cada conector ocupa contexto em toda mensagem.'),
      h('div', { class: 'grade-con' }, S.estado.conectores.filter((c) => !c.motor).map((c) => linhaConector(c, {
        direita: alternar(ligados.has(c.id), tenta(async (on) => {
          on ? ligados.add(c.id) : ligados.delete(c.id);
          await api('PUT', `/api/squads/${sq.id}/conectores`, { conectores: [...ligados] });
        })),
      })))));
    return;
  }

}
// Rotinas: as de todos os bots do squad num lugar só. Tocar abre a rotina; a chave liga e desliga.
async function renderRotinasSquad(sq, corpo) {
  const lista = await api('GET', `/api/rotinas?squad=${encodeURIComponent(sq.id)}`).catch(() => []);
  const bs = S.estado.bots.filter((b) => b.squad === sq.id);
  const recarregar = () => { if (S.rota.tela === 'squad' && S.rota.id === sq.id && abaSquadAtual() === 'rotinas') renderRotinasSquad(sq, corpo); };
  const porBot = bs.map((b) => [b, lista.filter((r) => r.bot === b.id)]).filter(([, rs]) => rs.length);
  corpo.replaceChildren(h('div', { class: 'estreito largo rotinas-squad' },
    h('div', { class: 'acoes-lin', style: { justifyContent: 'space-between', marginBottom: '6px' } },
      h('p', { class: 'dica', style: { margin: 0 } }, lista.length ? `${lista.length} rotina(s) · ${lista.filter((r) => r.ativa).length} ligada(s)` : 'Instruções que rodam sozinhas num horário. Também dá para pedir no chat de qualquer bot.'),
      h('button', { class: 'btn min', onclick: () => modalRotina(null, null, { squad: sq.id, aoSalvar: recarregar }) }, ic('mais', 14), 'Nova rotina')),
    porBot.length ? porBot.map(([b, rs]) => secaoInfo(b.nome, h('div', { class: 'info-cartao' }, rs.map((r) => h('div', { class: `info-item${r.ativa ? '' : ' apagado'}` },
      h('button', { class: 'rot-abrir', onclick: () => modalRotina(b.id, r.id, { aoSalvar: recarregar }) },
        h('span', { class: 'ic-item' }, ic('relogio', 15)),
        h('span', { class: 'txt' }, h('b', {}, r.nome), h('small', {}, r.ativa ? r.descricao : `Desligada · ${r.descricao}`))),
      alternar(r.ativa, tenta(async (on) => { await api('PATCH', `/api/rotinas/${r.id}`, { ativa: on }); recarregar(); }))))))) : null));
}

function abaSquadAtual() {
  const aba = localGet('abaSquad');
  return ABAS_SQUAD.some(([k]) => k === aba) ? aba : 'relevantes';
}

// ---------- Galáxia: o chat do grupo do squad ----------
// Um chat como o de qualquer bot, com o nome Galáxia. O ⋯ abre a lista de agentes do squad.
const galaxiaAberta = () => (ehCelular() ? !!S.galaxiaCelular : localGet('infoGalaxia') !== '0');
function alternarGalaxia(sq) {
  const abrir = !galaxiaAberta();
  if (ehCelular()) S.galaxiaCelular = abrir; else localSet('infoGalaxia', abrir ? '1' : '0');
  const el = $('#info-bot');
  if (el) el.hidden = !abrir;
  $('.area-chat')?.classList.toggle('com-info', abrir);
  if (abrir) renderAgentes(sq);
}
function renderAgentes(sq) {
  const el = $('#info-bot');
  if (!el) return;
  const bs = S.estado.bots.filter((b) => b.squad === sq.id);
  el.replaceChildren(
    h('div', { class: 'info-fechar' },
      h('button', { class: 'btn pilula', onclick: () => ir(`#/squad/${sq.id}`) }, ic('squad', 15), sq.nome),
      h('button', { class: 'btn-txt redondo', title: 'Fechar', 'aria-label': 'Fechar', onclick: () => alternarGalaxia(sq) }, ic('fechar', 16))),
    h('div', { class: 'info-perfil' },
      h('span', { class: 'av-galaxia grande' }, ic('galaxia', 44)),
      h('b', {}, 'Galáxia'), h('small', {}, `${bs.length} agente(s) no squad ${sq.nome}`)),
    secaoInfo('Agentes', bs.length ? h('div', { class: 'info-cartao' }, bs.map((b) => h('a', { class: 'info-item', href: `#/bot/${b.id}`, onclick: () => { S.galaxiaCelular = false; } },
      h('span', { class: 'av-agente' }, iconeBot(b, 30), h('i', { class: `ponto ${classeStatus(b)}` })),
      h('span', { class: 'txt' }, h('b', {}, b.nome), subtituloBot(b) !== b.nome ? h('small', {}, subtituloBot(b)) : null),
      h('span', { class: 'seta-dir' }, ic('direita', 14)))))
      : h('div', { class: 'info-cartao pad' }, h('p', { class: 'info-vazio' }, 'Nenhum bot neste squad ainda.')),
    acaoInfo('Novo bot', () => modalNovoBot(sq.id))));
}

async function renderGalaxia(sq) {
  const p = $('#principal');
  const bs = S.estado.bots.filter((b) => b.squad === sq.id);
  const cab = topo('Galáxia', `${bs.length} agente(s) · ${sq.nome}`,
    h('button', { class: 'btn-txt mais-info acao-topo', id: 'botao-info', title: 'Agentes do squad', 'aria-label': 'Agentes do squad', onclick: () => alternarGalaxia(sq) }, ic('pontos', 22, { preenchido: true })));
  cab.insertBefore(h('span', { class: 'avatar-topo av-galaxia' }, ic('galaxia', 22)), cab.querySelector('.titulo'));
  // Sala: você escreve uma vez; "@nome" chama alguém, "@todos" chama todos, e sem @ o Claude Flow escolhe quem
  // responde pelo assunto (a escolha aparece na conversa). As respostas e as conversas entre os bots ficam aqui.
  const lista = h('div', { class: 'estreito sala-lista', id: 'sala-lista' });
  const vivos = h('div', { class: 'estreito', id: 'sala-vivos' });
  const ta = h('textarea', { rows: 1, placeholder: bs.length > 1 ? 'Mensagem na Galáxia · @nome chama alguém, @todos chama todos' : 'Mensagem na Galáxia' });
  const ajustar = () => { ta.style.height = 'auto'; ta.style.height = `${Math.min(ta.scrollHeight, innerHeight * 0.35)}px`; };
  const enviarSala = tenta(async () => {
    const texto = ta.value.trim();
    if (!texto) return;
    ta.value = ''; ajustar();
    await api('POST', `/api/squads/${sq.id}/sala`, { texto });
  });
  ta.addEventListener('input', ajustar);
  ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !ehToque && !e.isComposing) { e.preventDefault(); enviarSala(); } });
  p.replaceChildren(h('div', { class: `area-chat${galaxiaAberta() ? ' com-info' : ''}` },
    h('div', { class: 'coluna-chat sobreposto' }, cab,
    h('div', { class: 'mensagens rolagem-sob', id: 'sala-rolagem' }, lista, vivos),
    h('div', { class: 'compositor sala-compositor' }, h('div', { class: 'estreito' }, h('div', { class: 'caixa' }, ta,
      h('div', { class: 'linha' }, h('span', { class: 'esp' }), botaoMicrofone(ta, () => aviso('Na Galáxia, o microfone só faz ditado'), ajustar, () => enviarSala()),
        h('button', { class: 'enviar', title: 'Enviar', onclick: enviarSala }, h('span', { class: 'ic', html: icone('enviar', 18) }))))))),
    h('aside', { class: 'info-bot', id: 'info-bot', hidden: !galaxiaAberta() })));
  sobreporCompositor(p.querySelector('.coluna-chat'));
  if (galaxiaAberta()) renderAgentes(sq);
  const sala = await api('GET', `/api/squads/${sq.id}/sala`).catch(() => ({ mensagens: [] }));
  if (S.rota.tela !== 'galaxia' || S.rota.id !== sq.id) return;
  S.sala.set(sq.id, sala.mensagens);
  renderSala(sq.id, true);
}

function renderSala(squadId, rolar = false) {
  const lista = $('#sala-lista');
  if (!lista) return;
  const caixa = $('#sala-rolagem');
  const noFim = rolar || caixa.scrollHeight - caixa.scrollTop - caixa.clientHeight < 120;
  const msgs = S.sala.get(squadId) || [];
  const nomeBot = (id) => bot(id)?.nome || id;
  // registros técnicos de repasse de tarefa ficam fora da Galáxia (as falas automáticas dos bots já contam isso)
  const visiveis = msgs.filter((m) => !(m.papel === 'entrada' && String(m.texto || '').startsWith('[Tarefa #')));
  lista.replaceChildren(...(visiveis.length ? visiveis.map((m) => {
    if (m.papel === 'usuario') return h('div', { class: 'msg usuario' }, m.texto);
    if (m.papel === 'roteamento') return h('div', { class: 'msg roteamento' }, ic('entrada', 13), m.texto);
    if (m.papel === 'sistema') return h('div', { class: 'msg sistema' }, m.texto);
    if (m.papel === 'entrada') {
      return h('div', { class: 'msg-bots entre' },
        h('div', { class: 'de' }, iconeBot(bot(m.de) || { id: m.de }, 18), h('b', {}, nomeBot(m.de) || m.meta?.deNome), h('span', { class: 'para' }, 'para'), h('b', {}, nomeBot(m.para)),
          h('small', {}, `${quando(m.criado)}${m.meta?.aguardar ? ' · esperando resposta' : ''}`)),
        h('details', {}, h('summary', {}, String(m.texto).replace(/\s+/g, ' ').slice(0, 140)), h('div', { class: 'md', html: md(m.texto) })));
    }
    return h('div', { class: `msg-bots${m.meta?.auto ? ' auto' : ''}` },
      h('div', { class: 'de' }, h('a', { href: `#/bot/${m.de}`, class: 'quem' }, iconeBot(bot(m.de) || { id: m.de }, 22), h('b', {}, nomeBot(m.de))), h('small', {}, quando(m.criado))),
      h('div', { class: 'md', html: md(m.texto) }));
  }) : [h('div', { class: 'vazio' }, 'A Galáxia é o grupo do squad: escreva como num grupo. Com @nome você chama alguém direto; sem @, quem recebe distribui. Os bots também conversam aqui quando passam trabalho um para o outro.')]));
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
// Tarefas do squad em duas vistas: Kanban (colunas por status, arrastar) e Lista (prazo, responsável, início).
async function renderKanban(sq, corpo) {
  const r = await api('GET', `/api/squads/${sq.id}/tarefas`).catch(() => ({ tarefas: [], notas: {} }));
  if (S.rota.tela !== 'squad' || S.rota.id !== sq.id) return;
  const vista = localGet('vistaTarefas') === 'lista' ? 'lista' : 'kanban';
  const trocar = h('div', { class: 'vista-tarefas' },
    h('div', { class: 'segmento' }, [['kanban', 'Kanban'], ['lista', 'Lista']].map(([k, n]) =>
      h('button', { class: k === vista ? 'sel' : '', onclick: () => { localSet('vistaTarefas', k); renderKanban(sq, corpo); } }, n))),
    h('button', { class: 'btn min', onclick: () => modalNovaTarefa({ squad: sq.id }) }, ic('mais', 14), 'Nova tarefa'));
  if (vista === 'lista') return corpo.replaceChildren(trocar, listaTarefas(sq, r));
  const colunas = Object.entries(ROTULO_STATUS).map(([status, nome]) => {
    const ts = r.tarefas.filter((t) => t.status === status);
    const col = h('div', { class: `coluna-k ${status}` },
      h('div', { class: 'coluna-cab' }, h('span', { class: `bolinha ${status}` }), h('b', {}, nome), h('small', {}, ts.length || ''),
        h('button', { class: 'btn-txt', title: 'Nova tarefa', onclick: () => modalNovaTarefa({ squad: sq.id, status }) }, ic('mais', 15))),
      h('div', { class: 'cartoes-k' }, ts.map((t) => {
        const c = h('div', { class: 'cartao-k', draggable: true, onclick: () => modalTarefa(t.id) },
          h('b', {}, t.titulo),
          t.descricao ? h('p', {}, t.descricao.slice(0, 120)) : null,
          seloPrazo(t) || seloInicio(t) ? h('div', { class: 'datas-k' }, seloPrazo(t), seloInicio(t)) : null,
          h('div', { class: 'rodape-k' },
            quemTarefa(t),
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
  corpo.replaceChildren(trocar, h('div', { class: 'kanban' }, colunas));
}

// ---------- aba Spy: bibliotecas monitoradas e blacklist ----------
// O bot de spy acha as ofertas e, com o seu OK, elas entram aqui; o monitoramento atualiza os anúncios ativos.
const TIPO_OFERTA = { vsl: 'VSL', quiz: 'Quiz', 'quiz+vsl': 'Quiz + VSL' };
async function renderSpy(sq, corpo) {
  const d = await api('GET', `/api/squads/${sq.id}/spy`).catch(() => ({ monitoradas: [], blacklist: [] }));
  if (S.rota.tela !== 'squad' || S.rota.id !== sq.id) return;
  const sub = localGet('subSpy') === 'blacklist' ? 'blacklist' : 'monitoradas';
  const topoSpy = h('div', { class: 'vista-tarefas' },
    h('div', { class: 'segmento' }, [['monitoradas', `Monitoradas${d.monitoradas.length ? ` · ${d.monitoradas.length}` : ''}`], ['blacklist', `Blacklist${d.blacklist.length ? ` · ${d.blacklist.length}` : ''}`]].map(([k, n]) =>
      h('button', { class: k === sub ? 'sel' : '', onclick: () => { localSet('subSpy', k); renderSpy(sq, corpo); } }, n))),
    sub === 'blacklist' ? h('button', { class: 'btn min', onclick: () => modalBlacklist(sq, corpo) }, ic('mais', 14), 'Adicionar') : null);
  const recarregar = () => renderSpy(sq, corpo);
  if (sub === 'blacklist') {
    corpo.replaceChildren(topoSpy, d.blacklist.length ? h('div', { class: 'lista-t spy-t' },
      h('div', { class: 'spy-cab bl' }, h('span', {}, 'Página'), h('span', {}, 'Motivo'), h('span', {}, 'Desde'), h('span', {})),
      d.blacklist.map((b) => h('div', { class: 'spy-lin bl' },
        h('span', { class: 'spy-pag' }, h('b', {}, b.pagina || '(sem nome)'), b.page_id ? h('small', {}, `page_id ${b.page_id}`) : null),
        h('span', { class: 'dica' }, b.motivo || '—'),
        h('span', { class: 'dica' }, new Date(b.adicionado).toLocaleDateString('pt-BR')),
        h('span', { class: 'spy-acoes' }, h('button', { class: 'btn-txt redondo', title: 'Tirar da blacklist', onclick: tenta(async () => {
          if (!confirm(`Tirar "${b.pagina}" da blacklist? Ela volta a aparecer nas buscas.`)) return;
          await api('DELETE', `/api/squads/${sq.id}/spy/blacklist/${encodeURIComponent(b.page_id || b.pagina)}`); recarregar();
        }) }, ic('fechar', 15))))))
      : h('div', { class: 'info-cartao pad' }, h('p', { class: 'info-vazio' }, 'Anunciantes que você não quer ver: o spy pula eles nas buscas. Também dá para pedir no chat do Spy: "põe X na blacklist".')));
    return;
  }
  const lista = [...d.monitoradas].sort((a, b) => (b.ativa !== false) - (a.ativa !== false) || (b.ativos ?? -1) - (a.ativos ?? -1));
  corpo.replaceChildren(topoSpy, lista.length ? h('div', { class: 'lista-t spy-t' },
    h('div', { class: 'spy-cab' }, h('span', {}, 'Página'), h('span', {}, 'Anúncios ativos'), h('span', {}, 'Tipo'), h('span', {}, 'Biblioteca'), h('span', {})),
    lista.map((m) => {
      const hist = m.historico || [];
      const ant = hist.length > 1 ? hist[hist.length - 2].ativos : null;
      const varia = ant !== null && m.ativos != null ? m.ativos - ant : null;
      return h('div', { class: `spy-lin${m.ativa === false ? ' pausada' : ''}` },
        h('span', { class: 'spy-pag' }, h('b', {}, m.pagina || m.page_id), h('small', {}, [m.nicho, m.ativa === false ? 'monitoramento pausado' : null].filter(Boolean).join(' · ') || '—')),
        h('button', { class: 'spy-ativos', title: 'Ver o histórico de anúncios ativos', onclick: () => modalHistoricoSpy(m) }, h('b', {}, m.ativos ?? '—'), varia ? h('small', { class: 'dica' }, `${varia > 0 ? '+' : ''}${varia}`) : null,
          h('small', { class: 'dica' }, m.conferido ? dataCurta(m.conferido) : 'sem conferência')),
        h('span', { class: 'spy-tipo' }, m.tipo ? h('span', { class: 'selo-data' }, TIPO_OFERTA[m.tipo] || m.tipo) : h('small', { class: 'dica' }, '—')),
        h('span', {}, h('a', { class: 'btn min', href: m.biblioteca, target: '_blank', rel: 'noopener' }, ic('link', 13), 'Abrir')),
        h('span', { class: 'spy-acoes' },
          h('button', { class: 'btn-txt redondo', title: m.ativa === false ? 'Voltar a monitorar' : 'Pausar o monitoramento', onclick: tenta(async () => {
            await api('PATCH', `/api/squads/${sq.id}/spy/monitoradas/${m.page_id}`, { ativa: m.ativa === false }); recarregar();
          }) }, ic(m.ativa === false ? 'play' : 'pausa', 15)),
          h('button', { class: 'btn-txt redondo', title: 'Excluir do spy', onclick: tenta(async () => {
            if (!confirm(`Excluir "${m.pagina}" do spy? O histórico de anúncios dela some junto.`)) return;
            await api('DELETE', `/api/squads/${sq.id}/spy/monitoradas/${m.page_id}`); recarregar();
          }) }, ic('lixeira', 15))));
    }))
    : h('div', { class: 'info-cartao pad' }, h('p', { class: 'info-vazio' }, 'Nenhuma biblioteca monitorada ainda. Peça ofertas ao bot Spy no chat; as que você aprovar entram aqui.')));
}

// Histórico dos anúncios ativos de uma biblioteca: gráfico de linha (um ponto por dia de conferência) e a lista dos dias.
function modalHistoricoSpy(m) {
  const hist = (m.historico || []).filter((x) => Number.isFinite(x.ativos));
  const dia = (d) => { const [a, mm, dd] = String(d).split('-'); return `${dd}/${mm}`; };
  let grafico;
  if (hist.length < 2) {
    grafico = h('p', { class: 'info-vazio' }, hist.length ? 'Só uma conferência até agora. O gráfico aparece a partir do segundo dia.' : 'Ainda sem conferência.');
  } else {
    const W = 520, H = 200, pe = 36, pd = 14, pt = 14, pb = 26;
    const vals = hist.map((x) => x.ativos);
    let lo = Math.min(...vals), hi = Math.max(...vals);
    if (lo === hi) { lo = Math.max(0, lo - 1); hi = hi + 1; }
    const folga = (hi - lo) * 0.12; lo = Math.max(0, lo - folga); hi += folga;
    const x = (i) => pe + (i * (W - pe - pd)) / (hist.length - 1);
    const y = (v) => pt + (1 - (v - lo) / (hi - lo)) * (H - pt - pb);
    const pts = hist.map((p, i) => `${x(i).toFixed(1)},${y(p.ativos).toFixed(1)}`);
    const area = `M${x(0).toFixed(1)},${H - pb} L${pts.join(' L')} L${x(hist.length - 1).toFixed(1)},${H - pb} Z`;
    const marcas = [hi, (hi + lo) / 2, lo].map((v) => `<line x1="${pe}" x2="${W - pd}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}" class="g-grade"/><text x="${pe - 6}" y="${(y(v) + 4).toFixed(1)}" text-anchor="end" class="g-eixo">${Math.round(v)}</text>`).join('');
    const passo = Math.max(1, Math.ceil(hist.length / 7));
    const datas = hist.map((p, i) => (i % passo === 0 || i === hist.length - 1) ? `<text x="${x(i).toFixed(1)}" y="${H - 8}" text-anchor="middle" class="g-eixo">${dia(p.data)}</text>` : '').join('');
    const bolas = hist.map((p, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(p.ativos).toFixed(1)}" r="${hist.length > 40 ? 0 : 3}" class="g-ponto"><title>${dia(p.data)}: ${p.ativos} ativos</title></circle>`).join('');
    grafico = h('div', { class: 'spy-grafico', html: `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Anúncios ativos por dia">${marcas}<path d="${area}" class="g-area"/><polyline points="${pts.join(' ')}" class="g-linha"/>${bolas}${datas}</svg>` });
  }
  const linhas = [...hist].reverse().map((p, i, arr) => {
    const ant = arr[i + 1]?.ativos;
    const v = ant === undefined ? null : p.ativos - ant;
    return h('div', { class: 'spy-hist-lin' }, h('span', {}, dia(p.data) + '/' + String(p.data).slice(0, 4)), h('b', {}, p.ativos),
      h('small', { class: 'dica' }, v === null ? '' : v === 0 ? '=' : `${v > 0 ? '+' : ''}${v}`));
  });
  modal(cabModal(`${m.pagina || m.page_id} — anúncios ativos`), grafico,
    hist.length ? h('div', { class: 'spy-hist' }, linhas) : null,
    h('div', { class: 'acoes-lin', style: { marginTop: '14px' } },
      m.biblioteca ? h('a', { class: 'btn', href: m.biblioteca, target: '_blank', rel: 'noopener' }, ic('link', 13), 'Abrir biblioteca') : null,
      h('button', { class: 'btn', onclick: fecharModal }, 'Fechar')));
}

function modalBlacklist(sq, corpo) {
  const nome = h('input', { class: 'ent', placeholder: 'Nome da página' });
  const link = h('input', { class: 'ent', placeholder: 'Link da biblioteca ou page_id (opcional)' });
  const motivo = h('input', { class: 'ent', placeholder: 'Motivo (opcional): marca grande, cliente…' });
  modal(cabModal('Adicionar à blacklist'), nome, link, motivo,
    h('div', { class: 'acoes-lin', style: { marginTop: '14px' } },
      h('button', { class: 'btn prim', onclick: tenta(async () => {
        const pid = (link.value.match(/view_all_page_id=(\d+)/) || link.value.match(/^\s*(\d{5,})\s*$/) || [])[1] || '';
        if (!nome.value.trim() && !pid) throw new Error('dê o nome da página ou o link da biblioteca');
        await api('POST', `/api/squads/${sq.id}/spy/blacklist`, { pagina: nome.value.trim(), page_id: pid, motivo: motivo.value.trim() });
        fecharModal(); renderSpy(sq, corpo);
      }) }, 'Adicionar'),
      h('button', { class: 'btn', onclick: fecharModal }, 'Cancelar')));
  setTimeout(() => nome.focus(), 50);
}

// ---------- aba Relevantes: o que os bots publicam para você olhar (relatórios, alertas) ----------
async function renderRelevantes(sq, corpo) {
  const { itens } = await api('GET', `/api/squads/${sq.id}/relevantes`).catch(() => ({ itens: [] }));
  if (S.rota.tela !== 'squad' || S.rota.id !== sq.id) return;
  const arquivados = localGet('relArquivados') === '1';
  const lista = itens.filter((x) => !!x.arquivado === arquivados);
  const novos = itens.filter((x) => !x.visto && !x.arquivado).length;
  const marcar = (x, campos) => tenta(async (e) => { e?.stopPropagation?.(); await api('PATCH', `/api/squads/${sq.id}/relevantes/${x.id}`, campos); renderRelevantes(sq, corpo); });
  corpo.replaceChildren(
    h('div', { class: 'vista-tarefas' },
      h('div', { class: 'segmento' }, [['0', `Abertos${novos ? ` · ${novos} novo${novos > 1 ? 's' : ''}` : ''}`], ['1', 'Arquivados']].map(([k, n]) =>
        h('button', { class: (arquivados ? '1' : '0') === k ? 'sel' : '', onclick: () => { localSet('relArquivados', k); renderRelevantes(sq, corpo); } }, n)))),
    lista.length ? h('div', { class: 'relevantes' }, lista.map((x) => {
      const b = bot(x.bot);
      const corpoTxt = h('div', { class: 'md rel-texto', html: md(x.texto || '') });
      const c = h('div', { class: `rel-item${x.visto ? '' : ' novo'}` },
        h('div', { class: 'rel-cab' },
          b ? iconeBot(b, 22) : null,
          h('div', { class: 'txt' }, h('b', {}, x.titulo), h('small', {}, [b?.nome, x.tipo, quando(x.criado)].filter(Boolean).join(' · '))),
          h('div', { class: 'spy-acoes' },
            !x.visto ? h('button', { class: 'btn min', onclick: marcar(x, { visto: true }) }, 'Visto') : null,
            h('button', { class: 'btn min', onclick: marcar(x, { arquivado: !x.arquivado, visto: true }) }, x.arquivado ? 'Desarquivar' : 'Arquivar'))),
        corpoTxt);
      return c;
    })) : h('div', { class: 'info-cartao pad' }, h('p', { class: 'info-vazio' }, arquivados ? 'Nada arquivado.' : 'Os relatórios importantes dos bots aparecem aqui: anúncio faltando na triagem, relatório de criativos, reembolso ou disputa, conta vencendo.')));
}

function listaTarefas(sq, r) {
  if (!r.tarefas.length) return h('div', { class: 'info-cartao pad' }, h('p', { class: 'info-vazio' }, 'Nenhuma tarefa ainda.'));
  const ordemStatus = { fazendo: 0, afazer: 1, revisao: 2, feito: 3 };
  const lista = [...r.tarefas].sort((a, b) => (a.status === 'feito') - (b.status === 'feito')
    || (a.prazo || Infinity) - (b.prazo || Infinity) || ordemStatus[a.status] - ordemStatus[b.status] || a.id - b.id);
  return h('div', { class: 'lista-t' },
    h('div', { class: 'lista-t-cab' }, h('span', {}, 'Tarefa'), h('span', {}, 'Responsável'), h('span', {}, 'Prazo'), h('span', {}, 'Início'), h('span', {}, 'Status')),
    lista.map((t) => h('button', { class: `lista-t-lin${t.status === 'feito' ? ' feita' : ''}`, onclick: () => modalTarefa(t.id) },
      h('span', { class: 'lt-tarefa' }, h('b', {}, t.titulo), t.descricao ? h('small', {}, t.descricao.replace(/\s+/g, ' ').slice(0, 140)) : null),
      h('span', { class: 'lt-quem' }, quemTarefa(t)),
      h('span', { class: `lt-data lt-prazo${t.prazo ? '' : ' sem-data'}` }, seloPrazo(t) || h('small', { class: 'dica' }, '—')),
      h('span', { class: `lt-data lt-inicio${seloInicio(t) || t.iniciado ? '' : ' sem-data'}` }, seloInicio(t) || h('small', { class: 'dica' }, t.iniciado ? 'começou sozinha' : '—')),
      h('span', { class: 'lt-status' }, h('span', { class: `bolinha ${t.status}` }), ROTULO_STATUS[t.status]))));
}

// ---------- conectores ----------
// Situação de cada conector em texto cinza; só o que pede ação ganha um pontinho de cor (selo falta/erro).
const SITUACAO = {
  conectado: ['Conectado', ''], entrar: ['Entre de novo no claude.ai', 'falta'], falhou: ['Falhou', 'erro'],
  desconectado: ['Não conectado', 'falta'], verificando: ['Verificando…', ''], configurar: ['Falta configurar', 'falta'],
  login: ['Login pelo terminal', ''], local: ['Neste computador', ''], chatgpt: ['Pelo app do ChatGPT', ''],
  instalar: ['Falta instalar', 'falta'], entrarGrok: ['Falta entrar', 'falta'],
};
function situacaoTexto(c) {
  if (c.tipo === 'atlas') { const a = S.estado.atlas; return a.noAr ? ['No ar', ''] : a.instalado ? ['Desligado', ''] : ['Não instalado', 'falta']; }
  if (c.tipo === 'voicestudio') { const v = S.estado.voicestudio || {}; return v.noAr ? ['No ar', ''] : v.instalado ? ['Liga sozinho quando precisar', ''] : ['Não instalado', 'falta']; }
  return SITUACAO[c.situacao] || ['', ''];
}
const precisaAcao = (c) => ['entrar', 'desconectado', 'configurar', 'falhou', 'instalar', 'entrarGrok'].includes(c.situacao);
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
      !ok && c.urlMcp ? h('div', { class: 'passo-grok' },
        h('b', {}, `No claude.ai › Conectores › Adicionar conector personalizado: nome "${c.nome}" e este endereço`),
        h('div', { class: 'cmd-linha' }, h('code', {}, c.urlMcp),
          h('button', { class: 'btn min', onclick: tenta(async () => { await navigator.clipboard.writeText(c.urlMcp); aviso('Copiado', 'Cole no claude.ai.'); }) }, 'Copiar')),
        h('small', { class: 'dica' }, `Depois toque em Conectar e entre na sua conta da ${c.nome}. Se ele já aparecer na lista de conectores do claude.ai, é só conectar por lá.`)) : null,
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
  } else if (c.tipo === 'voicestudio') {
    const v = S.estado.voicestudio || {};
    out.push(h('div', { class: 'cartao' },
      h('p', { class: 'dica', style: { marginTop: 0 } }, v.instalado ? 'Roda neste computador, na placa de vídeo, só em 127.0.0.1:3900. Não gasta créditos. Quando um bot com ele ligado vai trabalhar, o Claude Flow liga o servidor sozinho.' : 'Não está instalado em ~/VoiceStudio.'),
      v.instalado ? h('p', { class: 'dica' }, `Áudios de referência e áudios gerados ficam em ${v.pasta}.`) : null,
      v.noAr ? h('span', { class: 'dica' }, 'No ar agora.')
        : h('button', { class: 'btn', disabled: !v.instalado, onclick: tenta(async () => { aviso('Ligando', 'A primeira vez pode levar um ou dois minutos.'); await api('POST', '/api/voicestudio/ligar'); await redesenharConectores(); }) }, 'Ligar agora')));
  } else if (c.tipo === 'grok') {
    out.push(cartaoGrok(c));
    return out; // motor: não liga por squad
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
// Grok: o passo a passo para instalar o Grok Build e entrar com a conta do plano. Os comandos rodam no PowerShell
// do PC (você mesmo roda; o login é seu, no navegador). Depois, "Verificar de novo".
function cartaoGrok(c) {
  const passo = (n, titulo, cmd, dica) => h('div', { class: 'passo-grok' },
    h('b', {}, `${n}. ${titulo}`),
    h('div', { class: 'cmd-linha' }, h('code', {}, cmd),
      h('button', { class: 'btn min', onclick: tenta(async () => { await navigator.clipboard.writeText(cmd); aviso('Copiado', 'Cole no PowerShell do PC.'); }) }, 'Copiar')),
    dica ? h('small', { class: 'dica' }, dica) : null);
  const st = c.situacao;
  return h('div', { class: 'cartao' },
    h('p', { class: 'dica', style: { marginTop: 0 } }, st === 'conectado'
      ? 'Instalado e com login. O Grok usa o seu plano, sem chave paga.'
      : 'Faça no PC, no PowerShell (menu Iniciar › PowerShell). É uma vez só.'),
    st === 'instalar' ? passo(1, 'Instalar o Grok Build', 'irm https://x.ai/cli/install.ps1 | iex', 'Instalador oficial da xAI. Depois, feche e abra o PowerShell de novo.') : null,
    st !== 'conectado' ? passo(st === 'instalar' ? 2 : 1, 'Entrar com a sua conta', 'grok login', 'Abre o navegador: entre na conta do seu plano do Grok (SuperGrok). O login fica salvo neste PC.') : null,
    st === 'conectado' ? h('p', { class: 'dica' }, 'Para trocar de conta: "grok logout" e depois "grok login" no PowerShell.') : null,
    h('div', { class: 'acoes-lin', style: { marginTop: '10px' } }, h('button', { class: 'btn', onclick: tenta(async () => { await redesenharConectores(); aviso(S.estado.conectores.find((x) => x.id === c.id)?.situacao === 'conectado' ? 'Grok conectado' : 'Ainda não', ''); }) }, 'Verificar de novo')));
}

function logoConector(c, tam = 44) {
  const caixa = h('span', { class: `logo-app${c.iconeCheio ? ' cheio' : ''}`, style: { width: `${tam}px`, height: `${tam}px`, borderRadius: `${Math.round(tam * 0.26)}px` } });
  const reserva = () => { caixa.classList.add('sem-logo'); caixa.replaceChildren(c.tipo === 'grok' ? h('b', { class: 'logo-letra', style: { fontSize: `${Math.round(tam * 0.42)}px` } }, 'Grok') : c.tipo === 'voicestudio' ? h('b', { class: 'logo-letra', style: { fontSize: `${Math.round(tam * 0.3)}px` } }, 'Voice') : ic(c.tipo === 'atlas' ? 'filme' : 'conector', Math.round(tam * 0.5))); };
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
  const voz = await api('GET', '/api/voz').catch(() => null);
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
    h('h2', { class: 'sec' }, 'Conversa por voz'),
    h('div', { class: 'cartao' },
      h('p', { class: 'dica', style: { marginTop: 0 } }, voz?.ligada ? `Ligada (modelo ${voz.modelo}, voz ${voz.voz}). Toque no ícone de onda ao lado do microfone, no chat de um bot.` : 'Desligada. Precisa de uma chave da API da OpenAI (cobrada por minuto de conversa).'),
      h('div', { class: 'acoes-lin' },
        h('button', { class: 'btn', onclick: () => modalChaveVoz(() => renderAjustes()) }, voz?.ligada ? 'Trocar a chave' : 'Colocar a chave'),
        voz?.ligada ? h('button', { class: 'btn', onclick: tenta(async () => { if (!confirm('Tirar a chave da OpenAI deste PC? A conversa por voz fica desligada.')) return; await api('PUT', '/api/voz/chave', { chave: '' }); renderAjustes(); }) }, 'Tirar a chave') : null)),
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

// Na lateral, até o aparelho receber avisos: "Receber avisos neste aparelho". No iPhone só aparece no app instalado
// (no Safari comum o iPhone não deixa).
function convitePush() {
  if (!('Notification' in window) || !('PushManager' in window) || Notification.permission !== 'default') return null;
  if (ehIOS && !ehApp) return null;
  if (localGet('convitePush') === 'nao') return null;
  return h('div', { class: 'convite-push' },
    h('div', { class: 'txt' }, h('b', {}, 'Avisos neste aparelho'), h('small', {}, 'Quando um bot terminar uma entrega ou precisar de você, mesmo com o app fechado.')),
    h('div', { class: 'acoes-lin' },
      h('button', { class: 'btn prim min', onclick: tenta(async () => { await ativarNotificacoes(); renderLateral(); }) }, 'Ativar'),
      h('button', { class: 'btn min', onclick: () => { localSet('convitePush', 'nao'); renderLateral(); } }, 'Agora não')));
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
  if (tela === 'galaxia' && squad(id)) return renderGalaxia(squad(id));
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
  guardarDemandas(S.estado.demandas || []);
  carregarModelos();
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
    if (!vendo && ['bot', 'arquivo', 'quadro'].includes(m.papel)) { S.naoLidas.set(m.bot, (S.naoLidas.get(m.bot) || 0) + 1); renderLateral(); }
    if (S.rota.tela === 'bot' && S.rota.id === m.bot) renderMsgs();
    if (m.papel === 'entrada') {
      const l = S.sala.get(m.squad);
      if (l && !l.some((x) => x.id === m.id)) { l.push(m); if (S.rota.tela === 'galaxia' && S.rota.id === m.squad) renderSala(m.squad); }
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
    if (S.rota.tela === 'galaxia' && S.rota.id === b.squad) { renderSala(b.squad); if (galaxiaAberta()) renderAgentes(squad(b.squad)); }
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
    if (S.rota.tela === 'galaxia' && S.rota.id === d.squad) renderSala(d.squad);
  });
  on('rotinas', () => {
    if (S.rota.tela === 'bot' && infoAberta()) renderInfo(S.rota.id);
    if (S.rota.tela === 'squad' && abaSquadAtual() === 'rotinas') { const sq = squad(S.rota.id); const c = $('.squad-corpo'); if (sq && c) renderRotinasSquad(sq, c); }
  });
  on('aprovacao', async () => { await recarregarEstado(); if (S.rota.tela === 'bot') renderMsgs(); if (S.rota.tela === 'aprovacoes') renderAprovacoes(); proximaExclusao(); });
  on('estado', async () => { await recarregarEstado(); if (['inicio', 'squad', 'conectores'].includes(S.rota.tela)) renderPrincipal(); else if (S.rota.tela === 'galaxia') renderLateral(); });
  on('tarefa', (t) => {
    if (S.rota.tela === 'squad' && S.rota.id === t.squad && abaSquadAtual() === 'tarefas') { const sq = squad(t.squad); const c = $('.squad-corpo'); if (sq && c) renderKanban(sq, c); }
    if (S.rota.tela === 'bot' && infoAberta()) renderInfo(S.rota.id);
  });
  const naAba = (sq, aba) => S.rota.tela === 'squad' && S.rota.id === sq && abaSquadAtual() === aba;
  on('spy', (d) => { if (naAba(d.squad, 'spy')) { const sq = squad(d.squad); const c = $('.squad-corpo'); if (sq && c) renderSpy(sq, c); } });
  on('relevante', (d) => { if (naAba(d.squad, 'relevantes')) { const sq = squad(d.squad); const c = $('.squad-corpo'); if (sq && c) renderRelevantes(sq, c); } });
  on('bot-arquivos', (d) => { if (S.rota.tela === 'bot' && S.rota.id === d.bot && infoAberta()) renderInfo(d.bot); });
  on('demanda', (x) => {
    S.demandas.set(x.id, x);
    if (S.rota.tela === 'bot' && S.rota.id === x.bot) renderMsgs();
    if (naAba(x.squad, 'demandas')) { const sq = squad(x.squad); const c = $('.squad-corpo'); if (sq && c) renderDemandasSquad(sq, c); }
  });
  on('demandas', () => {
    for (const sqId of [...S.modelosDem.keys()]) carregarModelosDem(sqId).then(() => S.renderEscolhaDem?.());
    if (S.rota.tela === 'squad' && abaSquadAtual() === 'demandas') { const sq = squad(S.rota.id); const c = $('.squad-corpo'); if (sq && c) renderDemandasSquad(sq, c); }
  });
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

// ---------- tela do celular ----------
// Altura real da área visível (--app-h) e a margem de baixo (--sab). No app instalado do iPhone, às vezes a área
// visível já termina acima da barrinha do iPhone e o env(safe-area-inset-bottom) ainda soma 34 px: sobrava um vão
// embaixo da caixa de digitar. Aqui medimos e só usamos a margem quando ela é necessária. Com o teclado aberto, a
// tela encolhe junto (a caixa fica colada no teclado) e a margem de baixo some.
(function telaDoCelular() {
  const raiz = document.documentElement;
  const sonda = document.createElement('div');
  sonda.style.cssText = 'position:fixed;left:0;bottom:0;width:0;height:0;visibility:hidden;pointer-events:none;padding-bottom:env(safe-area-inset-bottom)';
  document.body.appendChild(sonda);
  const medir = () => {
    const vv = window.visualViewport;
    const alt = Math.round(vv ? vv.height : window.innerHeight);
    const teclado = !!vv && window.innerHeight - vv.height > 120;
    const sab = parseFloat(getComputedStyle(sonda).paddingBottom) || 0;
    const tela = window.innerWidth < window.innerHeight ? Math.max(screen.width, screen.height) : Math.min(screen.width, screen.height);
    const jaDescontado = sab > 0 && tela - window.innerHeight >= sab - 2; // a área visível já para antes da barrinha
    raiz.style.setProperty('--app-h', `${alt}px`);
    raiz.style.setProperty('--sab', `${teclado || jaDescontado ? 0 : sab}px`);
    document.body.classList.toggle('teclado', teclado);
    if (teclado || window.scrollY) window.scrollTo(0, 0);
  };
  medir();
  window.visualViewport?.addEventListener('resize', medir);
  window.visualViewport?.addEventListener('scroll', () => { if (window.scrollY) window.scrollTo(0, 0); });
  window.addEventListener('resize', medir);
  window.addEventListener('orientationchange', () => setTimeout(medir, 300));
  document.addEventListener('focusout', () => setTimeout(medir, 80));
})();

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
