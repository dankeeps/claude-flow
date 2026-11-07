---
name: broll-youtube
description: Busca, escolhe pelas capas, baixa (um por vez, sem áudio) e importa para a biblioteca do Atlas B-rolls de YouTube Shorts gringos, verticais, para a edição de anúncio e VSL. Use quando a preferência de fonte de B-roll do bot incluir YouTube, quando pedirem "B-roll do YouTube", "Shorts", "busca no YouTube", ou quando o TikTok não trouxer clipe limpo.
---

# B-roll de YouTube Shorts

Script: `scripts/shorts.py` (nesta pasta). Trabalho em `$SHORTS_TRABALHO` ou `~/Edições/_shorts`.
Busca e download rodam com qualquer Python 3 (precisa de `yt-dlp` e `ffmpeg` no PATH); a importação roda com o Python
da `.venv` do Atlas (usa `lib/biblioteca.py`).

```
S=<pasta desta skill>/scripts/shorts.py
PYA=~/"Octo Edição/Atlas"/.venv/bin/python        # Mac
PYA=~/"Octo Edição/Atlas"/.venv/Scripts/python.exe # Windows (Git Bash)
```

1. **Termos**: um rótulo curto por tipo de imagem que falta (ex.: `agachamento`, `balanca`, `dor-lombar`), 2 a 4 termos
   em inglês de criador gringo por rótulo, com os modificadores que limpam o resultado: `aesthetic`, `raw`, `no text`,
   `cinematic`, `pov`. Ex.: `"woman squat glutes aesthetic"`, `"glute workout raw pov"`.
2. **Buscar**: `python "$S" buscar <rotulo> "termo 1" "termo 2"` → lista numerada + `busca/<rotulo>/folha.jpg`.
   **Olhe a folha** (Read na imagem) e escolha pelas capas: vertical, sem texto/meme queimado, sem pessoa falando para a
   câmera, imagem que ilustra a fala. Pegue o ID sempre do `res.json`, nunca digitado da miniatura (I/l confundem).
3. **Baixar**: `python "$S" baixar <rotulo> 3,7,12 [<rotulo2> 1,4]` — um por vez, com pausa. Se aparecer `BLOQUEIO`,
   pare: o YouTube libera depois de algumas horas. Nunca rode dois downloads em paralelo.
4. **Importar**: `"$PYA" "$S" importar --expert "<Expert>" --oferta "<Oferta>" --anuncio "<nome do anúncio>"`
   (cada clipe vai para `B-rolls/<workspace>/<Expert>/<Oferta>/Shorts <rotulo>/`). `--estudar` manda o Gemini estudar só
   os novos (cobra por clipe): use quando a edição precisa da ficha para encaixar (padrão do Puro DR).
5. **Triagem** antes de encaixar: folha de quadros do trecho (`tira.py`/`motor.py preview` do Atlas). Texto queimado no
   vídeo todo → descarta; só num pedaço → usa o trecho limpo (≥ 2 s), sem recortar a imagem.

Formato: tela cheia e canto só com clipe vertical; dividida aceita horizontal. Usado não volta (a biblioteca marca).
