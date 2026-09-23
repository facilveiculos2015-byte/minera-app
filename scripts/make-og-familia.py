#!/usr/bin/env python3
"""Gera og-familia.png (1200x630) a partir de logo-escavadeira.png + icon-512.png."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
W, H = 1200, 630

def font(path, size):
    try:
        return ImageFont.truetype(path, size)
    except Exception:
        return ImageFont.load_default()

def main():
    img = Image.new('RGB', (W, H), '#0B1220')
    draw = ImageDraw.Draw(img)
    for y in range(H):
        t = y / (H - 1)
        draw.line([(0, y), (W, y)], fill=(int(11 + t * 18), int(18 + t * 10), int(32 + t * 8)))

    orb = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    od = ImageDraw.Draw(orb)
    od.ellipse([720, 80, 1280, 640], fill=(245, 166, 35, 55))
    od.ellipse([-120, -180, 420, 360], fill=(245, 166, 35, 28))
    orb = orb.filter(ImageFilter.GaussianBlur(48))
    img = Image.alpha_composite(img.convert('RGBA'), orb).convert('RGB')
    draw = ImageDraw.Draw(img)
    draw.rounded_rectangle([48, 48, W - 48, H - 48], radius=36, fill='#111827', outline='#F5A623', width=3)

    logo = Image.open(ROOT / 'logo-escavadeira.png').convert('RGBA').resize((280, 280), Image.LANCZOS)
    mask = Image.new('L', (280, 280), 0)
    ImageDraw.Draw(mask).ellipse([0, 0, 280, 280], fill=255)
    logo_circ = Image.new('RGBA', (280, 280), (0, 0, 0, 0))
    logo_circ.paste(logo, (0, 0), mask)
    ring = Image.new('RGBA', (296, 296), (0, 0, 0, 0))
    ImageDraw.Draw(ring).ellipse([0, 0, 295, 295], outline=(245, 166, 35, 255), width=6)
    ring.paste(logo_circ, (8, 8), logo_circ)
    img = img.convert('RGBA')
    img.paste(ring, (88, (H - 280) // 2 - 8), ring)
    draw = ImageDraw.Draw(img)

    bold = font('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 64)
    reg = font('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 32)
    small = font('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 26)
    brand = font('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 28)

    tx, ty = 420, 150
    draw.text((tx, ty), 'Família Mineira', font=bold, fill='#F5A623')
    draw.text((tx, ty + 90), 'Venha trabalhar conosco', font=reg, fill='#F8FAFC')
    draw.text((tx, ty + 140), 'e tenha renda extra no Minera Pará', font=reg, fill='#CBD5E1')
    badge = 'Minera Pará · indicação'
    bw = draw.textlength(badge, font=brand)
    bx, by = tx, ty + 230
    draw.rounded_rectangle([bx, by, bx + bw + 36, by + 40], radius=20, fill='#F5A623')
    draw.text((bx + 18, by + 6), badge, font=brand, fill='#0B1220')
    draw.text((tx, H - 120), 'Marketplace · Frete · Britagem · Bank', font=small, fill='#94A3B8')
    ic = Image.open(ROOT / 'icon-512.png').convert('RGBA').resize((72, 72), Image.LANCZOS)
    img.paste(ic, (W - 140, H - 130), ic)
    out = ROOT / 'og-familia.png'
    img.convert('RGB').save(out, 'PNG', optimize=True)
    print('ok', out, out.stat().st_size)

if __name__ == '__main__':
    main()
