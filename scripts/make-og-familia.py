#!/usr/bin/env python3
"""Gera og-familia.png 1080×1080 a partir de media/banner-familia-minera.jpg (convite/WhatsApp)."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageOps

ROOT = Path(__file__).resolve().parent.parent
W = H = 1080
ACCENT = (0xF5, 0xA6, 0x23)

def font(size):
    try:
        return ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', size)
    except Exception:
        return ImageFont.load_default()

def main():
    banner = Image.open(ROOT / 'media' / 'banner-familia-minera.jpg').convert('RGB')
    img = ImageOps.fit(banner, (W, H), method=Image.Resampling.LANCZOS, centering=(0.42, 0.35))
    overlay = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    od = ImageDraw.Draw(overlay)
    for y in range(H // 2, H):
        a = int(180 * ((y - H // 2) / (H // 2)))
        od.line([(0, y), (W, y)], fill=(11, 18, 32, a))
    img = Image.alpha_composite(img.convert('RGBA'), overlay)
    draw = ImageDraw.Draw(img)
    draw.rectangle([0, H - 10, W, H], fill=ACCENT + (255,))
    bold, sub = font(64), font(36)
    title, subtitle = 'Família Minera', 'Minera Pará · convite'
    tw, sw = draw.textlength(title, font=bold), draw.textlength(subtitle, font=sub)
    tx, sx = (W - tw) / 2, (W - sw) / 2
    ty, sy = H - 160, H - 88
    draw.text((tx + 2, ty + 2), title, font=bold, fill=(0, 0, 0, 180))
    draw.text((tx, ty), title, font=bold, fill=ACCENT + (255,))
    draw.text((sx + 1, sy + 1), subtitle, font=sub, fill=(0, 0, 0, 160))
    draw.text((sx, sy), subtitle, font=sub, fill=(255, 255, 255, 230))
    out = ROOT / 'og-familia.png'
    img.convert('RGB').save(out, 'PNG', optimize=True)
    print('ok', out, Image.open(out).size, out.stat().st_size)

if __name__ == '__main__':
    main()
