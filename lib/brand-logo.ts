// Browser-side preparation of a workspace's logo (app/brand-settings.tsx, lib/branding.ts).
//
// - PNG, WebP or SVG, on a transparent background (a logo on a solid box is refused: it would sit as a
//   rectangle on every coloured surface). An SVG is drawn to a high-resolution PNG here: SVG files can
//   carry scripts, so they are never stored as they are, and PDFs need PNG anyway.
// - The empty transparent margins are trimmed, so any shape — wide, square, tall — fills its space.
// - Its tone is measured: a dark logo is shown in white on dark surfaces (sidebar, portal, calls); a
//   light one gets a dark twin for white surfaces (PDFs), made here.
export type LogoTone = 'dark' | 'light';
export type PreparedLogo = { logo: File; tone: LogoTone; forLight?: File; width: number; height: number };

const maxSide = 1024;          // enough for a sharp sidebar and PDF header, small to store
const darkTwin = [32, 35, 42]; // #20232a, the app's ink

async function toBitmap(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if (file.type !== 'image/svg+xml') return createImageBitmap(file).catch(() => { throw new Error('Image illisible.'); });
  // An SVG without a size draws at 300×150: give it one from its viewBox, large enough to stay sharp.
  const text = await file.text();
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  const svg = doc.documentElement;
  if (svg.nodeName.toLowerCase() !== 'svg') throw new Error('SVG illisible.');
  const box = (svg.getAttribute('viewBox') || '').split(/[\s,]+/).map(Number);
  const w = Number.parseFloat(svg.getAttribute('width') || '') || box[2] || 300;
  const h = Number.parseFloat(svg.getAttribute('height') || '') || box[3] || 150;
  const scale = maxSide / Math.max(w, h);
  svg.setAttribute('width', String(Math.round(w * scale)));
  svg.setAttribute('height', String(Math.round(h * scale)));
  const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(svg)], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode().catch(() => { throw new Error('SVG illisible.'); });
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

const toFile = async (canvas: HTMLCanvasElement, name: string) => {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('Impossible de préparer le logo.');
  return new File([blob], name, { type: 'image/png' });
};

export async function prepareBrandLogo(file: File): Promise<PreparedLogo> {
  if (!/^image\/(png|webp|svg\+xml)$/.test(file.type)) throw new Error('Le logo doit être un PNG, un SVG ou un WebP sur fond transparent.');
  const source = await toBitmap(file);
  const sw = source.width, sh = source.height;
  const scale = Math.min(1, maxSide / Math.max(sw, sh)) || 1;
  const w = Math.max(1, Math.round(sw * scale)), h = Math.max(1, Math.round(sh * scale));
  const full = document.createElement('canvas');
  full.width = w; full.height = h;
  const ctx = full.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(source, 0, 0, w, h);
  if ('close' in source) source.close();

  // Bounds of what is actually drawn, transparency, and tone (weighted by opacity).
  const { data } = ctx.getImageData(0, 0, w, h);
  let minX = w, minY = h, maxX = -1, maxY = -1, transparent = 0, weight = 0, light = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4, a = data[i + 3];
      if (a < 250) transparent++;
      if (a <= 10) continue;
      if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
      const lum = (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 255;
      weight += a; light += lum * a;
    }
  }
  if (maxX < 0) throw new Error('Ce logo est vide (entièrement transparent).');
  if (transparent / (w * h) < 0.02) throw new Error('Le logo doit avoir un fond transparent : exportez-le en PNG ou SVG sans fond.');
  const tone: LogoTone = light / weight > 0.6 ? 'light' : 'dark';

  // Trimmed to its drawing, with a hair of margin.
  const pad = 2;
  const x0 = Math.max(0, minX - pad), y0 = Math.max(0, minY - pad);
  const cw = Math.min(w, maxX + pad + 1) - x0, ch = Math.min(h, maxY + pad + 1) - y0;
  const trimmed = document.createElement('canvas');
  trimmed.width = cw; trimmed.height = ch;
  trimmed.getContext('2d')!.drawImage(full, x0, y0, cw, ch, 0, 0, cw, ch);
  const logo = await toFile(trimmed, 'logo.png');

  // A light logo disappears on white (PDFs): its twin keeps the shape, in the app's ink.
  let forLight: File | undefined;
  if (tone === 'light') {
    const twin = document.createElement('canvas');
    twin.width = cw; twin.height = ch;
    const t = twin.getContext('2d')!;
    t.drawImage(trimmed, 0, 0);
    t.globalCompositeOperation = 'source-in';
    t.fillStyle = `rgb(${darkTwin.join(',')})`;
    t.fillRect(0, 0, cw, ch);
    forLight = await toFile(twin, 'logo-on-light.png');
  }
  return { logo, tone, forLight, width: cw, height: ch };
}
