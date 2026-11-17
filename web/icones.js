// Ícones de linha da interface (grade 24×24, traço arredondado, cor = currentColor). Nada de emoji como ícone.

// Engrenagem de 8 dentes calculada (contorno + furo), para não depender de desenho à mão.
function engrenagem() {
  const n = 8, passo = (Math.PI * 2) / n, pt = (r, a) => `${(12 + r * Math.cos(a)).toFixed(2)} ${(12 + r * Math.sin(a)).toFixed(2)}`;
  const pts = [];
  for (let i = 0; i < n; i++) {
    const t = i * passo;
    pts.push(pt(6.9, t - passo * 0.32), pt(9.2, t - passo * 0.17), pt(9.2, t + passo * 0.17), pt(6.9, t + passo * 0.32));
  }
  return `M${pts.join('L')}ZM12 9.2a2.8 2.8 0 1 1 0 5.6 2.8 2.8 0 0 1 0-5.6z`;
}

const P = {
  mais: 'M12 5v14M5 12h14',
  fechar: 'M6.5 6.5l11 11M17.5 6.5l-11 11',
  voltar: 'M14.5 5.5 8 12l6.5 6.5',
  baixo: 'M6.5 9.5 12 15l5.5-5.5',
  direita: 'M9.5 5.5 16 12l-6.5 6.5',
  enviar: 'M12 19V5.5M6.5 11 12 5.5l5.5 5.5',
  parar: 'M8 7h8a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1z',
  anexo: 'M19.5 11.6l-7.7 7.7a4.7 4.7 0 0 1-6.6-6.6l8-8a3.1 3.1 0 0 1 4.4 4.4l-7.9 7.9a1.6 1.6 0 0 1-2.2-2.2l7.2-7.2',
  ajustes: 'M4 7h9M17 7h3M4 17h3M11 17h9M15 5v4M9 15v4',
  conversa: 'M6 5h12a2.5 2.5 0 0 1 2.5 2.5v7A2.5 2.5 0 0 1 18 17h-6.5L7 20.5V17H6a2.5 2.5 0 0 1-2.5-2.5v-7A2.5 2.5 0 0 1 6 5z',
  conector: 'M9 3.5v4.5M15 3.5v4.5M7 8h10v3.2a5 5 0 0 1-10 0zM12 16.2v4.3',
  globo: 'M12 3.5a8.5 8.5 0 1 1 0 17 8.5 8.5 0 0 1 0-17zM12 3.5c-2.4 2.3-3.6 5.1-3.6 8.5s1.2 6.2 3.6 8.5c2.4-2.3 3.6-5.1 3.6-8.5S14.4 5.8 12 3.5zM3.5 12h17',
  engrenagem: engrenagem(),
  cadeado: 'M7 11h10a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-6a2 2 0 0 1 2-2zM8.5 11V8a3.5 3.5 0 0 1 7 0v3',
  sortear: 'M3.5 7h3.3c4.6 0 5.8 10 10.4 10h3.3M3.5 17h3.3c1.6 0 2.7-1.2 3.6-2.8M13.6 9.8c.9-1.6 2-2.8 3.6-2.8h3.3M18 4.5 20.5 7 18 9.5M18 14.5l2.5 2.5-2.5 2.5',
  compactar: 'M4.5 14h5.5v5.5M19.5 10H14V4.5M14 10l6-6M10 14l-6 6',
  terminal: 'M5.5 4.5h13a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2v-11a2 2 0 0 1 2-2zM7.5 9.5l3 2.5-3 2.5M12.5 15h4',
  entrada: 'M6.5 6.5l11 11M17.5 9.5v8h-8',
  documento: 'M14 3.5H7.5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2V8zM14 3.5V8h4.5',
  squad: 'M12 4.2a2 2 0 1 1 0 4 2 2 0 0 1 0-4zM5.5 15.8a2 2 0 1 1 0 4 2 2 0 0 1 0-4zM18.5 15.8a2 2 0 1 1 0 4 2 2 0 0 1 0-4zM10.9 8l-4.3 7.9M13.1 8l4.3 7.9M7.5 17.8h9',
  bot: 'M7 8.5h10a2.5 2.5 0 0 1 2.5 2.5v6A2.5 2.5 0 0 1 17 19.5H7A2.5 2.5 0 0 1 4.5 17v-6A2.5 2.5 0 0 1 7 8.5zM12 8.5V5M12 4.6v.01M9.3 13.6v.6M14.7 13.6v.6',
  filme: 'M6 4.5h12a1.5 1.5 0 0 1 1.5 1.5v12a1.5 1.5 0 0 1-1.5 1.5H6A1.5 1.5 0 0 1 4.5 18V6A1.5 1.5 0 0 1 6 4.5zM8.5 4.5v15M15.5 4.5v15M4.5 9h4M4.5 15h4M15.5 9h4M15.5 15h4',
  pontos: 'M5.5 10.9a1.1 1.1 0 1 1 0 2.2 1.1 1.1 0 0 1 0-2.2zM12 10.9a1.1 1.1 0 1 1 0 2.2 1.1 1.1 0 0 1 0-2.2zM18.5 10.9a1.1 1.1 0 1 1 0 2.2 1.1 1.1 0 0 1 0-2.2z',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1.2 1.2M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1.2-1.2',
  tarefa: 'M8 6.5h11M8 12h11M8 17.5h11M4.5 6.5h.01M4.5 12h.01M4.5 17.5h.01',
  lixeira:'M4.5 7h15M9.5 7V5.5a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1V7M6.5 7l.8 11.2a1.5 1.5 0 0 0 1.5 1.3h6.4a1.5 1.5 0 0 0 1.5-1.3L17.5 7M10.2 10.5v5.5M13.8 10.5v5.5',
  relogio: 'M12 3.5a8.5 8.5 0 1 1 0 17 8.5 8.5 0 0 1 0-17zM12 7.5V12l3 2',
  microfone: 'M12 3.5a3 3 0 0 1 3 3v5a3 3 0 0 1-6 0v-5a3 3 0 0 1 3-3zM6 11.5a6 6 0 0 0 12 0M12 17.5v3',
  pausa: 'M8.5 5.5v13M15.5 5.5v13',
  play: 'M8 5.5v13l10.5-6.5z',
  cima: 'M12 19V5M6 11l6-6 6 6',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  etapas: 'M4.5 6.5h.01M4.5 12h.01M4.5 17.5h.01M9 6.5h10.5M9 12h10.5M9 17.5h10.5',
  onda: 'M4 10v4M8 7v10M12 4v16M16 7v10M20 10v4',
  mudo: 'M12 3.5a3 3 0 0 1 3 3v5a3 3 0 0 1-6 0v-5a3 3 0 0 1 3-3zM6 11.5a6 6 0 0 0 12 0M12 17.5v3M4 4l16 16',
  repetir: 'M4 12a8 8 0 0 1 14-5.3M20 4v4h-4M20 12a8 8 0 0 1-14 5.3M4 20v-4h4',
  // galáxia: núcleo + dois braços em espiral + duas estrelas
  galaxia: 'M12 10.6a1.4 1.4 0 1 1 0 2.8 1.4 1.4 0 0 1 0-2.8zM12 13.4c-3.4.2-6-1.6-5.6-4.6.4-2.7 3.4-4.4 7.6-3.6M12 10.6c3.4-.2 6 1.6 5.6 4.6-.4 2.7-3.4 4.4-7.6 3.6M19.5 5.5h.01M4.5 18.5h.01',
  faisca: 'M12 3.5c.6 4.4 2.6 6.4 7 7-4.4.6-6.4 2.6-7 7-.6-4.4-2.6-6.4-7-7 4.4-.6 6.4-2.6 7-7z',
};

export function icone(nome, tamanho = 18, { preenchido = false } = {}) {
  const d = P[nome] || P.mais;
  const fill = preenchido ? 'currentColor' : 'none';
  return `<svg class="ico" viewBox="0 0 24 24" width="${tamanho}" height="${tamanho}" aria-hidden="true"><path d="${d}" fill="${fill}" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}
