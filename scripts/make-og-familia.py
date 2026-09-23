#!/usr/bin/env python3
"""Gera og-familia.png 1080×1080 — logo preenchendo o quadro, texto Minera Pará, bg #0b1220. Sem URL/QR."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
W = H = 1080
BG = (0x0B, 0x12, 0x20)
ACCENT = (0xF5, 0xA6, 0x23)

def font(path, size):
    try:
        return ImageFont.truetype(path, size)
    except Exception:
        return ImageFont.load_default()

def main():
    img = Image.new('RGB', (W, H), BG)
    draw = ImageDraw.Draw(img)

    # Soft gold orbs (no text/URL)
    orb = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    od = ImageDraw.Draw(orb)
    od.ellipse([620, -80, 1220, 520], fill=(245, 166, 35, 48))
    od.ellipse([-160, 640, 420, 1220], fill=(245, 166, 35, 32))
    orb = orb.filter(ImageFilter.GaussianBlur(56))
    img = Image.alpha_composite(img.convert('RGBA'), orb).convert('RGB')
    draw = ImageDraw.Draw(img)

    # Prefer full logo; fall back to icon-512
    logo_path = ROOT / 'logo-escavadeira.png'
    if not logo_path.exists():
        logo_path = ROOT / 'icon-512.png'
    logo = Image.open(logo_path).convert('RGBA')

    # Logo fills most of the frame (centered square)
    side = 780
    logo = logo.resize((side, side), Image.LANCZOS)
    # Circular crop with gold ring
    mask = Image.new('L', (side, side), 0)
    ImageDraw.Draw(mask).ellipse([0, 0, side - 1, side - 1], fill=255)
    circ = Image.new('RGBA', (side, side), (0, 0, 0, 0))
    circ.paste(logo, (0, 0), mask)

    ring_pad = 18
    ring_sz = side + ring_pad * 2
    ring = Image.new('RGBA', (ring_sz, ring_sz), (0, 0, 0, 0))
    rd = ImageDraw.Draw(ring)
    rd.ellipse([0, 0, ring_sz - 1, ring_sz - 1], outline=ACCENT + (255,), width=10)
    ring.paste(circ, (ring_pad, ring_pad), circ)

    # Position: upper-center so room for "Minera Pará" below
    rx = (W - ring_sz) // 2
    ry = 70
    img = img.convert('RGBA')
    img.paste(ring, (rx, ry), ring)
    draw = ImageDraw.Draw(img)

    bold = font('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 78)
    title = 'Minera Pará'
    tw = draw.textlength(title, font=bold)
    tx = (W - tw) / 2
    ty = ry + ring_sz + 28
    # Soft shadow then gold text
    draw.text((tx + 2, ty + 2), title, font=bold, fill=(0, 0, 0, 160))
    draw.text((tx, ty), title, font=bold, fill=ACCENT + (255,))

    out = ROOT / 'og-familia.png'
    img.convert('RGB').save(out, 'PNG', optimize=True)
    im2 = Image.open(out)
    print('ok', out, im2.size, out.stat().st_size)

if __name__ == '__main__':
    main()
