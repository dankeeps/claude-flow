// Avatares dos bots do Claude Flow: cabecinhas de robô/aparelho desenhadas em SVG, montadas com três escolhas —
// forma (a "cabeça"), rosto e cor. Tudo vetorial, sem imagem: o bot.json guarda só { forma, rosto, cor }.

export const CORES = [
  { id: 'menta', nome: 'Menta', hex: '#3DDC84' },
  { id: 'lima', nome: 'Lima', hex: '#B5FF00' },
  { id: 'sol', nome: 'Sol', hex: '#FFC83D' },
  { id: 'tangerina', nome: 'Tangerina', hex: '#FF8A2A' },
  { id: 'coral', nome: 'Coral', hex: '#FF6B5B' },
  { id: 'rosa', nome: 'Rosa', hex: '#FF5FA2' },
  { id: 'lavanda', nome: 'Lavanda', hex: '#B38CFF' },
  { id: 'indigo', nome: 'Índigo', hex: '#6C6CFF' },
  { id: 'ceu', nome: 'Céu', hex: '#4DA3FF' },
  { id: 'turquesa', nome: 'Turquesa', hex: '#2EC4C9' },
  { id: 'areia', nome: 'Areia', hex: '#E8C9A0' },
  { id: 'gelo', nome: 'Gelo', hex: '#F2F2F3' },
  { id: 'grafite', nome: 'Grafite', hex: '#5B5B66' },
];

// Cada forma desenha a cabeça (c = cor, s = sombra, l = luz) e diz onde fica o rosto (centro e escala).
export const FORMAS = [
  {
    id: 'orbe', nome: 'Orbe', rosto: [50, 60, 1],
    svg: ({ c, s }) => `<path d="M50 24V11" stroke="${s}" stroke-width="4.5" stroke-linecap="round"/><circle cx="50" cy="9" r="5.5" fill="${c}"/><circle cx="50" cy="59" r="33" fill="${c}"/>`,
  },
  {
    id: 'tela', nome: 'Tela', rosto: [50, 44, 1],
    svg: ({ c, s }) => `<rect x="43" y="68" width="14" height="14" fill="${s}"/><rect x="29" y="80" width="42" height="8" rx="4" fill="${c}"/><rect x="12" y="14" width="76" height="58" rx="15" fill="${c}"/>`,
  },
  {
    id: 'chip', nome: 'Chip', rosto: [50, 50, 1],
    svg: ({ c, s }) => [30, 46, 62].map((y) => `<rect x="8" y="${y}" width="14" height="8" rx="3" fill="${s}"/><rect x="78" y="${y}" width="14" height="8" rx="3" fill="${s}"/>`).join('')
      + [36, 58].map((x) => `<rect x="${x}" y="8" width="6" height="14" rx="3" fill="${s}"/>`).join('')
      + `<rect x="18" y="18" width="64" height="66" rx="14" fill="${c}"/>`,
  },
  {
    id: 'capacete', nome: 'Capacete', rosto: [50, 60, 1],
    svg: ({ c, s }) => `<path d="M36 22q14-14 28 0" fill="none" stroke="${s}" stroke-width="5" stroke-linecap="round"/><rect x="7" y="48" width="16" height="26" rx="7" fill="${s}"/><rect x="77" y="48" width="16" height="26" rx="7" fill="${s}"/><path d="M17 74V54a33 33 0 0 1 66 0v20q0 14-14 14H31q-14 0-14-14z" fill="${c}"/>`,
  },
  {
    id: 'planeta', nome: 'Planeta', rosto: [50, 51, 0.88],
    svg: ({ c, s, l }) => `<g transform="rotate(-16 50 56)"><ellipse cx="50" cy="56" rx="46" ry="12" fill="none" stroke="${s}" stroke-width="5"/></g><circle cx="50" cy="54" r="30" fill="${c}"/><g transform="rotate(-16 50 56)"><path d="M4 56a46 12 0 0 0 92 0" fill="none" stroke="${l}" stroke-width="5" stroke-linecap="round"/></g>`,
  },
  {
    id: 'fone', nome: 'Fone', rosto: [50, 60, 0.95],
    svg: ({ c, s }) => `<circle cx="50" cy="58" r="31" fill="${c}"/><path d="M17 56a33 33 0 0 1 66 0" fill="none" stroke="${s}" stroke-width="7" stroke-linecap="round"/><rect x="8" y="48" width="15" height="26" rx="7.5" fill="${s}"/><rect x="77" y="48" width="15" height="26" rx="7.5" fill="${s}"/>`,
  },
  {
    id: 'tv', nome: 'TV', rosto: [46, 58, 0.95],
    svg: ({ c, s }) => `<path d="M50 30L33 9M50 30L67 9" stroke="${s}" stroke-width="4.5" stroke-linecap="round"/><circle cx="33" cy="9" r="4.5" fill="${c}"/><circle cx="67" cy="9" r="4.5" fill="${c}"/><rect x="10" y="28" width="80" height="60" rx="17" fill="${c}"/><circle cx="79" cy="70" r="4" fill="${s}"/><circle cx="79" cy="56" r="4" fill="${s}"/>`,
  },
  {
    id: 'capsula', nome: 'Cápsula', rosto: [50, 40, 0.92],
    svg: ({ c, s }) => `<rect x="25" y="7" width="50" height="86" rx="25" fill="${c}"/><rect x="25" y="61" width="50" height="7" fill="${s}"/>`,
  },
  {
    id: 'hexa', nome: 'Hexa', rosto: [50, 52, 1],
    svg: ({ c, s }) => `<circle cx="11" cy="52" r="5" fill="${s}"/><circle cx="89" cy="52" r="5" fill="${s}"/><path d="M50 12L83 31V71L50 90L17 71V31Z" fill="${c}" stroke="${c}" stroke-width="10" stroke-linejoin="round"/>`,
  },
  {
    id: 'satelite', nome: 'Satélite', rosto: [50, 54, 0.85],
    svg: ({ c, s }) => `<path d="M22 54H30M70 54H78" stroke="${s}" stroke-width="4"/><rect x="3" y="43" width="20" height="22" rx="3" fill="${s}"/><rect x="77" y="43" width="20" height="22" rx="3" fill="${s}"/><path d="M13 43V65M87 43V65" stroke="${c}" stroke-width="2" opacity=".55"/><path d="M50 26V14" stroke="${s}" stroke-width="4" stroke-linecap="round"/><path d="M41 14a9 9 0 0 1 18 0z" fill="${c}"/><circle cx="50" cy="54" r="27" fill="${c}"/>`,
  },
];

// Rostos desenhados em volta de (0,0); f = cor do rosto, c = cor da cabeça (para o brilho dos olhos).
export const ROSTOS = [
  { id: 'pontos', nome: 'Pontos', svg: ({ f, c }) => `<circle cx="-11" cy="0" r="6" fill="${f}"/><circle cx="11" cy="0" r="6" fill="${f}"/><circle cx="-9" cy="-2.2" r="1.7" fill="${c}"/><circle cx="13" cy="-2.2" r="1.7" fill="${c}"/>` },
  { id: 'visor', nome: 'Visor', svg: ({ f, c }) => `<rect x="-23" y="-9" width="46" height="18" rx="9" fill="${f}"/><rect x="-15" y="-3.5" width="9" height="7" rx="3.5" fill="${c}"/><rect x="6" y="-3.5" width="9" height="7" rx="3.5" fill="${c}"/>` },
  { id: 'ciclope', nome: 'Ciclope', svg: ({ f, c }) => `<circle r="12" fill="${f}"/><circle cx="2.5" cy="-2.5" r="4.5" fill="${c}"/>` },
  { id: 'feliz', nome: 'Feliz', svg: ({ f }) => `<path d="M-16 3q5-9 10 0M6 3q5-9 10 0" fill="none" stroke="${f}" stroke-width="4.5" stroke-linecap="round"/><path d="M-6 11q6 5 12 0" fill="none" stroke="${f}" stroke-width="3.5" stroke-linecap="round"/>` },
  { id: 'pixel', nome: 'Pixel', svg: ({ f }) => `<rect x="-17" y="-6" width="10" height="10" fill="${f}"/><rect x="7" y="-6" width="10" height="10" fill="${f}"/><rect x="-7" y="10" width="4" height="4" fill="${f}"/><rect x="-3" y="12" width="6" height="4" fill="${f}"/><rect x="3" y="10" width="4" height="4" fill="${f}"/>` },
  { id: 'oculos', nome: 'Óculos', svg: ({ f }) => `<circle cx="-11" r="8.5" fill="none" stroke="${f}" stroke-width="3.5"/><circle cx="11" r="8.5" fill="none" stroke="${f}" stroke-width="3.5"/><path d="M-2.5 0h5" stroke="${f}" stroke-width="3"/><circle cx="-10" cy="1" r="3" fill="${f}"/><circle cx="12" cy="1" r="3" fill="${f}"/>` },
  { id: 'sono', nome: 'Sono', svg: ({ f }) => `<path d="M-17 2h11M6 2h11" stroke="${f}" stroke-width="4.5" stroke-linecap="round"/><path d="M14-17h6l-6 7h6" fill="none" stroke="${f}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>` },
  { id: 'led', nome: 'LED', svg: ({ f }) => `<circle cx="-13" r="4.5" fill="${f}"/><circle r="4.5" fill="${f}" opacity=".55"/><circle cx="13" r="4.5" fill="${f}"/>` },
];

const porId = (lista, id) => lista.find((x) => x.id === id) || lista[0];

function mistura(hex, alvo, t) {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [n >> 16, (n >> 8) & 255, n & 255];
  const m = (x) => Math.round(x + (alvo - x) * t);
  return `#${[m(r), m(g), m(b)].map((x) => x.toString(16).padStart(2, '0')).join('')}`;
}

function luminancia(hex) {
  const n = parseInt(hex.slice(1), 16);
  return (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
}

export function avatarSVG(av, { tamanho = 40, animar = false } = {}) {
  const forma = porId(FORMAS, av?.forma);
  const rosto = porId(ROSTOS, av?.rosto);
  const cor = porId(CORES, av?.cor).hex;
  const p = { c: cor, s: mistura(cor, 0, 0.32), l: mistura(cor, 255, 0.35) };
  const f = luminancia(cor) < 0.45 ? '#F4F4F6' : '#141416';
  const [fx, fy, esc] = forma.rosto;
  return `<svg class="avatar-svg${animar ? ' animado' : ''}" viewBox="0 0 100 100" width="${tamanho}" height="${tamanho}" aria-hidden="true">`
    + `<g class="cabeca">${forma.svg(p)}<g class="rosto" transform="translate(${fx} ${fy}) scale(${esc})"><g class="olhos">${rosto.svg({ f, c: cor })}</g></g></g></svg>`;
}

function hash(txt) {
  let h = 2166136261;
  for (const ch of String(txt)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return h;
}

// Bot criado antes dos avatares: um avatar fixo tirado do id (sempre o mesmo para o mesmo bot).
export function avatarPadrao(id) {
  const h = hash(id);
  return { forma: FORMAS[h % FORMAS.length].id, rosto: ROSTOS[(h >>> 8) % ROSTOS.length].id, cor: CORES[(h >>> 16) % CORES.length].id };
}

export function avatarAleatorio() {
  const r = (l) => l[Math.floor(Math.random() * l.length)].id;
  return { forma: r(FORMAS), rosto: r(ROSTOS), cor: r(CORES) };
}
