// Avatares dos bots: planetas desenhados em SVG (esfera com luz no alto à esquerda, faixas, crateras, anéis).
// O bot.json guarda só { planeta }. Avatares do formato antigo ({ glifo, cor }) viram um planeta fixo tirado do id.

// Cada planeta: tons da esfera (claro → base → escuro) e detalhes desenhados por cima, recortados no círculo.
export const PLANETAS = [
  { id: 'mercurio', nome: 'Mercúrio', tons: ['#cfcac4', '#9b958e', '#4f4a45'],
    detalhes: '<circle cx="36" cy="40" r="7" fill="#7d7771" opacity=".55"/><circle cx="60" cy="62" r="9" fill="#7d7771" opacity=".45"/><circle cx="62" cy="32" r="4" fill="#7d7771" opacity=".5"/><circle cx="40" cy="68" r="3.5" fill="#7d7771" opacity=".5"/>' },
  { id: 'venus', nome: 'Vênus', tons: ['#fbe7bf', '#e2b46e', '#8c5f2c'],
    detalhes: '<path d="M8 40c18-8 40 6 84-6M8 56c22-6 46 8 84-4M14 72c20-4 40 4 70-2" stroke="#f6d59c" stroke-width="5" fill="none" opacity=".55" stroke-linecap="round"/>' },
  { id: 'terra', nome: 'Terra', tons: ['#8cc8ff', '#2f78d6', '#123a7a'],
    detalhes: '<path d="M30 22c8-4 18 0 20 8s-6 10-4 18-8 12-14 8-4-12-10-16-2-14 8-18z" fill="#4caf6a"/><path d="M58 50c6-2 14 2 16 10s-4 16-12 16-10-8-8-14 0-10 4-12z" fill="#4caf6a"/><path d="M20 30c10-6 30-10 56-2" stroke="#fff" stroke-width="3" fill="none" opacity=".55" stroke-linecap="round"/><path d="M36 82c10 2 22 0 32-6" stroke="#fff" stroke-width="3" fill="none" opacity=".45" stroke-linecap="round"/>' },
  { id: 'marte', nome: 'Marte', tons: ['#f2a07c', '#c8553d', '#5e1f14'],
    detalhes: '<path d="M22 46c10-4 18 2 28-2s16-8 26-2" stroke="#9c3a25" stroke-width="7" fill="none" opacity=".55" stroke-linecap="round"/><circle cx="64" cy="64" r="6" fill="#9c3a25" opacity=".5"/><ellipse cx="50" cy="12" rx="14" ry="5" fill="#fff" opacity=".7"/>' },
  { id: 'jupiter', nome: 'Júpiter', tons: ['#f6dcc0', '#d3a27a', '#6e4428'],
    detalhes: '<rect x="0" y="28" width="100" height="7" fill="#b27a52" opacity=".75"/><rect x="0" y="42" width="100" height="5" fill="#f3e2cd" opacity=".7"/><rect x="0" y="52" width="100" height="9" fill="#a8693f" opacity=".75"/><rect x="0" y="68" width="100" height="5" fill="#c99168" opacity=".7"/><ellipse cx="62" cy="58" rx="9" ry="5.5" fill="#b8492e"/>' },
  { id: 'saturno', nome: 'Saturno', tons: ['#fbe9c6', '#dcbc85', '#7a5a2c'], raio: 30, anel: '#e9d3a6',
    detalhes: '<rect x="0" y="40" width="100" height="5" fill="#c9a46a" opacity=".7"/><rect x="0" y="54" width="100" height="6" fill="#c9a46a" opacity=".6"/>' },
  { id: 'urano', nome: 'Urano', tons: ['#d9fbfb', '#7fd0d6', '#2a6f78'],
    detalhes: '<rect x="0" y="30" width="100" height="4" fill="#fff" opacity=".18"/><rect x="0" y="62" width="100" height="5" fill="#2a8c95" opacity=".25"/>' },
  { id: 'netuno', nome: 'Netuno', tons: ['#9ab8ff', '#3a5fd9', '#14246b'],
    detalhes: '<path d="M10 38c24-6 50 4 80-2M12 64c22-4 48 6 76 0" stroke="#7d9cff" stroke-width="4" fill="none" opacity=".5" stroke-linecap="round"/><ellipse cx="40" cy="52" rx="8" ry="5" fill="#1b2d82" opacity=".8"/>' },
  { id: 'lua', nome: 'Lua', tons: ['#f4f4f2', '#bdbcb8', '#5c5b58'],
    detalhes: '<circle cx="38" cy="36" r="9" fill="#9d9c98" opacity=".55"/><circle cx="62" cy="58" r="7" fill="#9d9c98" opacity=".55"/><circle cx="40" cy="66" r="5" fill="#9d9c98" opacity=".5"/><circle cx="64" cy="30" r="3.5" fill="#9d9c98" opacity=".6"/>' },
  { id: 'plutao', nome: 'Plutão', tons: ['#f1dccb', '#b99579', '#5a4231'],
    detalhes: '<path d="M52 50c4-8 16-8 18 0 2 7-8 14-14 20-6-6-16-13-14-20 2-8 14-8 10 0z" fill="#f6e8da" opacity=".85"/><circle cx="30" cy="40" r="6" fill="#8a6a52" opacity=".5"/>' },
  { id: 'sol', nome: 'Sol', tons: ['#fff3b0', '#ffb627', '#d9530f'], brilho: true,
    detalhes: '<circle cx="40" cy="44" r="5" fill="#ffd25e" opacity=".6"/><circle cx="60" cy="60" r="7" fill="#ff9a1f" opacity=".45"/><circle cx="62" cy="36" r="3" fill="#ffd25e" opacity=".6"/>' },
];

const porId = (id) => PLANETAS.find((p) => p.id === id);

// Cor das mensagens que você manda para o bot: o tom predominante do planeta dele, um pouco mais fechado para o
// texto branco ficar legível (contraste de pelo menos 4,5:1).
const BOLHA = {
  mercurio: '#6a655f', venus: '#8f6428', terra: '#2c68bd', marte: '#ac432c', jupiter: '#8f6141', saturno: '#86693a',
  urano: '#2a7b83', netuno: '#3a5bd0', lua: '#68686c', plutao: '#7f624c', sol: '#ad5a0c',
};
export const corDoPlaneta = (id) => BOLHA[id] || BOLHA[PLANETAS[0].id];
let seq = 0;

// animado: indicador "trabalhando". O anel (ou uma órbita fina) se desenha em volta e a superfície gira sem parar
// (os detalhes passam da direita para a esquerda dentro da esfera, com uma cópia emendada para o giro não ter fim).
export function avatarSVG(av, { tamanho = 40, animado = false } = {}) {
  const p = porId(av?.planeta) || PLANETAS[0];
  const u = `pl${++seq}`;
  const r = p.raio || (p.brilho ? 38 : 42);
  const [claro, base, escuro] = p.tons;
  const superficie = animado ? `<g class="pl-gira">${p.detalhes}<g transform="translate(100 0)">${p.detalhes}</g></g>` : p.detalhes;
  const esfera = `<g class="pl-corpo"><circle cx="50" cy="50" r="${r}" fill="url(#${u}g)"/>`
    + `<g clip-path="url(#${u}c)"><g transform="translate(50 50) scale(${r / 42}) translate(-50 -50)">${superficie}</g></g>`
    + `<circle cx="50" cy="50" r="${r}" fill="url(#${u}s)"/></g>`;
  // Anel do Saturno: metade de trás antes da esfera, metade da frente depois.
  const anel = (frente) => (p.anel || animado
    ? `<path d="${frente ? 'M6 50a44 12 0 0 0 88 0' : 'M6 50a44 12 0 0 1 88 0'}" fill="none" class="pl-anel" pathLength="100" stroke="${p.anel || '#ffffff'}" stroke-width="${p.anel ? (frente ? 6 : 5) : 1.6}" opacity="${p.anel ? (frente ? 0.95 : 0.55) : (frente ? 0.45 : 0.25)}" transform="rotate(-16 50 50)"/>`
    : '');
  return `<svg class="avatar-svg${animado ? ' pl-anim' : ''}" viewBox="0 0 100 100" width="${tamanho}" height="${tamanho}" aria-hidden="true"><defs>`
    + `<radialGradient id="${u}g" cx="36%" cy="32%" r="75%"><stop offset="0" stop-color="${claro}"/><stop offset=".55" stop-color="${base}"/><stop offset="1" stop-color="${escuro}"/></radialGradient>`
    + `<radialGradient id="${u}s" cx="34%" cy="30%" r="80%"><stop offset=".5" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="${p.brilho ? 0.15 : 0.45}"/></radialGradient>`
    + (p.brilho ? `<radialGradient id="${u}b"><stop offset=".7" stop-color="${base}" stop-opacity=".4"/><stop offset="1" stop-color="${base}" stop-opacity="0"/></radialGradient>` : '')
    + `<clipPath id="${u}c"><circle cx="50" cy="50" r="${r}"/></clipPath></defs>`
    + (p.brilho ? `<circle cx="50" cy="50" r="50" fill="url(#${u}b)"/>` : '')
    + anel(false) + esfera + anel(true) + '</svg>';
}

function hash(txt) {
  let h = 2166136261;
  for (const ch of String(txt)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return h;
}

// Bot sem planeta salvo (ou com o avatar antigo): um planeta fixo tirado do id.
export function avatarPadrao(id) {
  return { planeta: PLANETAS[hash(id) % PLANETAS.length].id };
}

export function avatarValido(av) {
  return !!(av && porId(av.planeta));
}

export function avatarAleatorio(evitar) {
  const op = PLANETAS.filter((p) => p.id !== evitar);
  return { planeta: op[Math.floor(Math.random() * op.length)].id };
}

export const nomePlaneta = (id) => porId(id)?.nome || '';
