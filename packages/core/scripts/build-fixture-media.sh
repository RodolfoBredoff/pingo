#!/usr/bin/env bash
# Gera mídia sintética (imagem, PDF, áudio) para o conjunto de referência.
# Só roda no macOS (usa `say`, `cupsfilter`, Pillow e ffmpeg). Uso: pnpm --filter @pingo/core fixtures:media
set -euo pipefail
cd "$(dirname "$0")/.."
OUT=fixtures/media
mkdir -p "$OUT"

# --- Imagens (Pillow) ---
python3 - <<'EOF'
from PIL import Image, ImageDraw, ImageFont
FONT = "/System/Library/Fonts/Helvetica.ttc"
def card(path, lines, bg=(255, 246, 229)):
    img = Image.new("RGB", (900, 600), bg)
    d = ImageDraw.Draw(img)
    y = 70
    for i, text in enumerate(lines):
        size = 54 if i == 0 else 40
        d.text((60, y), text, fill=(42, 29, 19), font=ImageFont.truetype(FONT, size))
        y += size + 38
    img.save(path)
card("fixtures/media/img-aviso.png", ["AVISO AOS PAIS", "Reunião de pais", "Quinta-feira, 12/11, às 19h", "Auditório da escola"])
card("fixtures/media/img-convite.png", ["Você está convidado!", "Aniversário do Pedro", "Sábado, 14/11 às 16h", "Rua das Acácias, 45"], (220, 240, 255))
card("fixtures/media/img-sem-data.png", ["Recado da professora", "Trazer fantasia de", "super-herói para a festa", "da turma."])
EOF

# --- PDFs (texto real, via cupsfilter) ---
cat > /tmp/circular.txt <<'EOF'
ESCOLA MUNDO COLORIDO - CIRCULAR 45/2026

Prezados pais e responsaveis,

Informamos que as turmas do 3o ano farao um passeio ao Museu de Ciencias
no dia 18/11 (quarta-feira). A saida sera as 8h30 e o retorno as 12h.

O valor de R$ 40,00 deve ser pago ate 12/11 na secretaria.
A autorizacao anexa deve ser devolvida assinada ate 13/11.

Atenciosamente,
Coordenacao pedagogica
EOF
cupsfilter -m application/pdf /tmp/circular.txt > "$OUT/pdf-circular.pdf" 2>/dev/null

cat > /tmp/cardapio.txt <<'EOF'
CARDAPIO DA SEMANA

Segunda: arroz, feijao, frango grelhado e salada
Terca: macarrao a bolonhesa, legumes cozidos
Quarta: arroz, feijao, carne moida e pure
Quinta: risoto de legumes e fruta
Sexta: pizza caseira e suco natural
EOF
cupsfilter -m application/pdf /tmp/cardapio.txt > "$OUT/pdf-cardapio.pdf" 2>/dev/null

# --- Áudios (voz sintética pt-BR + ffmpeg) ---
speak() { # $1=arquivo base, $2=texto
  say -v Luciana -o "/tmp/$1.aiff" "$2"
  ffmpeg -v error -y -i "/tmp/$1.aiff" -ar 16000 -ac 1 -b:a 48k "$OUT/$1.mp3"
}
speak audio-reuniao "Oi, aqui é a coordenadora. Lembrando que a reunião de pais é na quinta-feira, dia doze, às sete da noite, no auditório da escola."
speak audio-tarefas "Preciso lembrar de pagar a mensalidade até o dia dez, e comprar o presente da Sofia antes de quinta-feira."
# Formato que o WhatsApp realmente envia para notas de voz: Ogg/Opus.
ffmpeg -v error -y -i /tmp/audio-reuniao.aiff -ar 16000 -ac 1 -c:a libopus -b:a 24k "$OUT/audio-reuniao.ogg"

ls -la "$OUT"
