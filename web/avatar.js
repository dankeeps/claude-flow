// Avatares dos bots: bloco arredondado (squircle) com um símbolo de linha, no espírito dos ícones da Apple.
// Duas variações de fundo: "cor" (bloco colorido, símbolo branco) e "escuro" (bloco grafite, símbolo colorido).
// O bot.json guarda só { glifo, cor, fundo }.

// Cores do sistema da Apple no modo escuro.
export const CORES = [
  { id: 'azul', nome: 'Azul', hex: '#0A84FF' },
  { id: 'indigo', nome: 'Índigo', hex: '#5E5CE6' },
  { id: 'roxo', nome: 'Roxo', hex: '#BF5AF2' },
  { id: 'rosa', nome: 'Rosa', hex: '#FF375F' },
  { id: 'vermelho', nome: 'Vermelho', hex: '#FF453A' },
  { id: 'laranja', nome: 'Laranja', hex: '#FF9F0A' },
  { id: 'amarelo', nome: 'Amarelo', hex: '#FFD60A' },
  { id: 'verde', nome: 'Verde', hex: '#30D158' },
  { id: 'menta', nome: 'Menta', hex: '#66D4CF' },
  { id: 'ciano', nome: 'Ciano', hex: '#64D2FF' },
  { id: 'marrom', nome: 'Marrom', hex: '#AC8E68' },
  { id: 'cinza', nome: 'Cinza', hex: '#8E8E93' },
  { id: 'branco', nome: 'Branco', hex: '#F2F2F7' },
];

export const FUNDOS = [
  { id: 'cor', nome: 'Cor' },
  { id: 'escuro', nome: 'Escuro' },
];

// Símbolos de linha numa grade de 24×24 (traço arredondado, sem preenchimento).
export const GLIFOS = [
  { id: 'faisca', nome: 'Faísca', d: 'M12 3.5c.6 4.4 2.6 6.4 7 7-4.4.6-6.4 2.6-7 7-.6-4.4-2.6-6.4-7-7 4.4-.6 6.4-2.6 7-7z' },
  { id: 'nos', nome: 'Rede', d: 'M12 4.2a2 2 0 1 1 0 4 2 2 0 0 1 0-4zM5.5 15.8a2 2 0 1 1 0 4 2 2 0 0 1 0-4zM18.5 15.8a2 2 0 1 1 0 4 2 2 0 0 1 0-4zM10.9 8l-4.3 7.9M13.1 8l4.3 7.9M7.5 17.8h9' },
  { id: 'filme', nome: 'Vídeo', d: 'M6 5h12a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V8a3 3 0 0 1 3-3zM10.2 9.2v5.6l4.6-2.8z' },
  { id: 'tesoura', nome: 'Corte', d: 'M6.5 4.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5zM6.5 14.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5zM8.6 8.4 20 17.5M8.6 15.6 20 6.5' },
  { id: 'caneta', nome: 'Escrita', d: 'M4.5 19.5l1-4.2L15.6 5.2a2.1 2.1 0 0 1 3 3L8.5 18.4zM13.8 7l3 3' },
  { id: 'onda', nome: 'Áudio', d: 'M4 10.5v3M8 7v10M12 4v16M16 8v8M20 10.5v3' },
  { id: 'camera', nome: 'Câmera', d: 'M5.5 7.5h2l1.6-2.3h5.8l1.6 2.3h2a2.5 2.5 0 0 1 2.5 2.5v7.5a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5V10a2.5 2.5 0 0 1 2.5-2.5zM12 10.5a3.2 3.2 0 1 1 0 6.4 3.2 3.2 0 0 1 0-6.4z' },
  { id: 'megafone', nome: 'Anúncio', d: 'M4 10.2v3.6a1.2 1.2 0 0 0 1.2 1.2H7l7 4V5L7 9H5.2A1.2 1.2 0 0 0 4 10.2zM17.5 9a4 4 0 0 1 0 6' },
  { id: 'grafico', nome: 'Métricas', d: 'M5 19.5v-6M12 19.5v-11M19 19.5v-15' },
  { id: 'alvo', nome: 'Alvo', d: 'M12 3.5a8.5 8.5 0 1 1 0 17 8.5 8.5 0 0 1 0-17zM12 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8zM12 11.4a.6.6 0 1 1 0 1.2.6.6 0 0 1 0-1.2z' },
  { id: 'lupa', nome: 'Pesquisa', d: 'M10.5 4a6.5 6.5 0 1 1 0 13 6.5 6.5 0 0 1 0-13zM15.3 15.3 20 20' },
  { id: 'envelope', nome: 'E-mail', d: 'M5.5 5.5h13A2.5 2.5 0 0 1 21 8v8a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 16V8a2.5 2.5 0 0 1 2.5-2.5zM3.6 7.2 12 13l8.4-5.8' },
  { id: 'calendario', nome: 'Agenda', d: 'M6.5 5h11A3 3 0 0 1 20.5 8v9.5a3 3 0 0 1-3 3h-11a3 3 0 0 1-3-3V8a3 3 0 0 1 3-3zM3.5 10h17M8 3v4M16 3v4' },
  { id: 'livro', nome: 'Estudo', d: 'M12 6.5C10.4 5 7.9 4.5 4 4.8v13.5c3.9-.3 6.4.2 8 1.7 1.6-1.5 4.1-2 8-1.7V4.8c-3.9-.3-6.4.2-8 1.7zM12 6.5V20' },
  { id: 'lampada', nome: 'Ideias', d: 'M9.5 18h5M10.5 21h3M12 3a6 6 0 0 0-3.6 10.8c.7.5 1.1 1.2 1.1 2V16h5v-.2c0-.8.4-1.5 1.1-2A6 6 0 0 0 12 3z' },
  { id: 'codigo', nome: 'Código', d: 'M8.5 7 3.5 12l5 5M15.5 7l5 5-5 5M13.5 4.5l-3 15' },
  { id: 'globo', nome: 'Web', d: 'M12 3.5a8.5 8.5 0 1 1 0 17 8.5 8.5 0 0 1 0-17zM12 3.5c-2.4 2.3-3.6 5.1-3.6 8.5s1.2 6.2 3.6 8.5c2.4-2.3 3.6-5.1 3.6-8.5S14.4 5.8 12 3.5zM3.5 12h17' },
  { id: 'cubo', nome: 'Produto', d: 'M12 3.3l7.8 4.4v8.6L12 20.7l-7.8-4.4V7.7zM4.4 7.8 12 12.2l7.6-4.4M12 12.2v8.4' },
];

const porId = (lista, id) => lista.find((x) => x.id === id) || lista[0];

function luminancia(hex) {
  const n = parseInt(hex.slice(1), 16);
  return (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
}

// Superelipse (|x|^5 + |y|^5 = 1): lados retos e cantos contínuos, como os ícones da Apple. Quadro de 100×100.
const SQUIRCLE = (() => {
  const n = 5, pts = [];
  for (let i = 0; i < 160; i++) {
    const t = (i / 160) * Math.PI * 2, c = Math.cos(t), s = Math.sin(t);
    const x = Math.sign(c) * Math.abs(c) ** (2 / n), y = Math.sign(s) * Math.abs(s) ** (2 / n);
    pts.push(`${(50 + 50 * x).toFixed(2)} ${(50 + 50 * y).toFixed(2)}`);
  }
  return `M${pts.join('L')}Z`;
})();

export function avatarSVG(av, { tamanho = 40 } = {}) {
  const glifo = porId(GLIFOS, av?.glifo);
  const cor = porId(CORES, av?.cor).hex;
  const escuro = av?.fundo === 'escuro';
  const fundo = escuro ? '#1C1C1E' : cor;
  const traco = escuro ? cor : luminancia(cor) > 0.72 ? '#1C1C1E' : '#FFFFFF';
  const borda = escuro ? `<path d="${SQUIRCLE}" fill="none" stroke="#FFFFFF" stroke-opacity=".09" stroke-width="2"/>` : '';
  return `<svg class="avatar-svg" viewBox="0 0 100 100" width="${tamanho}" height="${tamanho}" aria-hidden="true">`
    + `<path d="${SQUIRCLE}" fill="${fundo}"/>${borda}`
    + `<g transform="translate(22 22) scale(2.333)"><path d="${glifo.d}" fill="none" stroke="${traco}" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></g></svg>`;
}

function hash(txt) {
  let h = 2166136261;
  for (const ch of String(txt)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return h;
}

// Bot sem avatar salvo (ou com o formato antigo): um avatar fixo tirado do id.
export function avatarPadrao(id) {
  const h = hash(id);
  return { glifo: GLIFOS[h % GLIFOS.length].id, cor: CORES[(h >>> 8) % (CORES.length - 2)].id, fundo: 'cor' };
}

export function avatarValido(av) {
  return !!(av && GLIFOS.some((g) => g.id === av.glifo) && CORES.some((c) => c.id === av.cor));
}

export function avatarAleatorio() {
  const r = (l) => l[Math.floor(Math.random() * l.length)].id;
  return { glifo: r(GLIFOS), cor: r(CORES.slice(0, -2)), fundo: 'cor' };
}
