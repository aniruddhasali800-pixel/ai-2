// The Sizzle mark, drawn from one set of cubic paths. Everything that shows the brand — the SVG
// favicons, the PNG icons in public/icons, and the Windows .ico behind the desktop launcher —
// rasterises from this file, so no shipped icon can disagree with another.
//   import { rasterize, renderPng, svgIcon } from './sizzle-mark.mjs';

import { deflateSync } from 'node:zlib';

const INK = [28, 25, 23];
const EMBER = [234, 88, 12];
const SAFFRON = [250, 204, 21];
const EMBER_SOFT = [253, 186, 116];

/** The house is charcoal, the flame is the ember family. */
const TILE = INK;
const ART_COLORS = [EMBER, SAFFRON, EMBER_SOFT];

/** The mark, drawn on a 512 grid, back to front. Each shape takes the colour of the same
 *  index in ART_COLORS. `cubics` entries are [c1x,c1y,c2x,c2y,x,y]. */
const ART = [
  {
    start: [318, 116],
    cubics: [
      [268, 190, 152, 250, 152, 338],
      [152, 384, 197, 410, 256, 410],
      [313, 410, 362, 381, 362, 331],
      [362, 259, 344, 180, 318, 116],
    ],
  },
  {
    start: [283, 247],
    cubics: [
      [262, 274, 209, 304, 209, 344],
      [209, 364, 230, 376, 256, 376],
      [281, 376, 303, 363, 303, 341],
      [303, 311, 295, 274, 283, 247],
    ],
  },
  { circle: [170, 198, 26] },
];

const STEPS = 40;

function cubicPoint([c1x, c1y, c2x, c2y, x, y], p0, t) {
  const m = 1 - t;
  const a = m * m * m;
  const b = 3 * m * m * t;
  const c = 3 * m * t * t;
  return [a * p0[0] + b * c1x + c * c2x + t * t * t * x, a * p0[1] + b * c1y + c * c2y + t * t * t * y];
}

/** Outline of one shape in 512-space, scaled about the mark's centre. */
function outline(shape, scale, dx, dy) {
  const map = ([x, y]) => [257 + (x - 257) * scale + dx, 263 + (y - 263) * scale + dy];
  if (shape.circle) {
    const [cx, cy, r] = shape.circle;
    const [mx, my] = map([cx, cy]);
    return Array.from({ length: 72 }, (_, i) => {
      const a = (i / 72) * Math.PI * 2;
      return [mx + r * scale * Math.cos(a), my + r * scale * Math.sin(a)];
    });
  }
  const pts = [];
  let p = shape.start;
  for (const seg of shape.cubics) {
    for (let i = 0; i < STEPS; i += 1) pts.push(map(cubicPoint(seg, p, i / STEPS)));
    p = [seg[4], seg[5]];
  }
  return pts;
}

/** `d` attribute for the same geometry, so the SVG and PNG share one source. */
export function shapePath(shape, scale, dx, dy) {
  const map = ([x, y]) => [257 + (x - 257) * scale + dx, 263 + (y - 263) * scale + dy];
  if (shape.circle) {
    const [cx, cy, r] = shape.circle;
    const [mx, my] = map([cx, cy]);
    const rr = r * scale;
    return `M${(mx - rr).toFixed(1)} ${my.toFixed(1)}a${rr.toFixed(1)} ${rr.toFixed(1)} 0 1 0 ${(rr * 2).toFixed(1)} 0a${rr.toFixed(1)} ${rr.toFixed(1)} 0 1 0 ${(-rr * 2).toFixed(1)} 0Z`;
  }
  const p = (v) => v.toFixed(1);
  const start = map(shape.start);
  let d = `M${p(start[0])} ${p(start[1])}`;
  for (const [c1x, c1y, c2x, c2y, x, y] of shape.cubics) {
    const a = map([c1x, c1y]);
    const b = map([c2x, c2y]);
    const e = map([x, y]);
    d += `C${p(a[0])} ${p(a[1])} ${p(b[0])} ${p(b[1])} ${p(e[0])} ${p(e[1])}`;
  }
  return `${d}Z`;
}

// Maskable icons lose their corners to the launcher, so the mark shrinks to the safe zone.
export const VARIANTS = {
  plain: { scale: 1, dx: 0, dy: 0, radius: 0.22 },
  maskable: { scale: 0.72, dx: 0, dy: 4, radius: 0 },
};

export const ART_SHAPES = ART;

export function svgIcon(size, variant) {
  const v = VARIANTS[variant];
  const tile = `#${TILE.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
  const bg = v.radius
    ? `<rect width="512" height="512" rx="${(512 * v.radius).toFixed(0)}" fill="${tile}"/>`
    : `<rect width="512" height="512" fill="${tile}"/>`;
  const body = ART.map((s, i) => `<path fill="rgb(${ART_COLORS[i].join(',')})" d="${shapePath(s, v.scale, v.dx, v.dy)}"/>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="${size}" height="${size}" role="img" aria-label="Sizzle">${bg}${body}</svg>`;
}

function coverage(poly, size, sub) {
  const hits = new Float32Array(size * size);
  const row = new Float32Array(size);
  const xs = [];
  for (let y = 0; y < size; y += 1) {
    row.fill(0);
    for (let s = 0; s < sub; s += 1) {
      const py = y + (s + 0.5) / sub;
      xs.length = 0;
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const [xi, yi] = poly[i];
        const [xj, yj] = poly[j];
        if (yi > py !== yj > py) xs.push(xi + ((py - yi) * (xj - xi)) / (yj - yi));
      }
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const a = xs[k];
        const b = xs[k + 1];
        for (let x = Math.floor(a); x < Math.ceil(b); x += 1) {
          row[x] += Math.min(x + 1, b) - Math.max(x, a);
        }
      }
    }
    const at = y * size;
    for (let x = 0; x < size; x += 1) hits[at + x] = row[x] / sub;
  }
  return hits;
}

/** Alpha of a rounded square tile along one scanline, with a one-pixel soft edge. */
function tileAlpha(size, radius, y) {
  if (!radius) return () => 1;
  const cy = y < radius ? radius : y > size - 1 - radius ? size - 1 - radius : null;
  if (cy === null) return () => 1;
  return (x) => {
    const cx = x < radius ? radius : x > size - 1 - radius ? size - 1 - radius : null;
    if (cx === null) return 1;
    const d = Math.hypot(x - cx, y - cy);
    if (d <= radius - 1) return 1;
    if (d >= radius + 1) return 0;
    return 1 - (d - radius + 1) / 2;
  };
}

const over = (dst, src, a) => (a <= 0 ? dst : a >= 1 ? src : dst.map((v, i) => Math.round(v + (src[i] - v) * a)));

/** Top-down RGBA pixels, one sample per byte, at exactly `size` square. */
export function rasterize(size, variant = 'plain') {
  const v = VARIANTS[variant];
  const k = size / 512;
  // Small tiles have sub-pixel flame detail, so they get more samples rather than a blurrier pass.
  const sub = size <= 48 ? 8 : 4;
  const shapes = ART.map((s, i) => ({ color: ART_COLORS[i], hits: coverage(outline(s, v.scale, v.dx, v.dy).map(([x, y]) => [x * k, y * k]), size, sub) }));
  const rgba = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    const tileAlphaAt = tileAlpha(size, v.radius * size, y);
    for (let x = 0; x < size; x += 1) {
      let px = TILE;
      for (const s of shapes) px = over(px, s.color, s.hits[y * size + x]);
      const at = (y * size + x) * 4;
      rgba[at] = px[0];
      rgba[at + 1] = px[1];
      rgba[at + 2] = px[2];
      rgba[at + 3] = Math.round(tileAlphaAt(x) * 255);
    }
  }
  return rgba;
}

const TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = TABLE[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

export function pngFromRgba(size, rgba) {
  const rows = [];
  for (let y = 0; y < size; y += 1) {
    const row = Buffer.alloc(size * 4 + 1);
    rgba.copy(row, 1, y * size * 4, (y + 1) * size * 4);
    rows.push(row);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.concat(rows), { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

export function renderPng(size, variant = 'plain') {
  return pngFromRgba(size, rasterize(size, variant));
}
