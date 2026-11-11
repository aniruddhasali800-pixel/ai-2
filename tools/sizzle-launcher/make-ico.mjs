// Builds Sizzle.ico — the icon Windows puts on the desktop launcher. A .bat or .url file can never
// carry its own picture, so the launcher is a real shortcut pointing at this one file.
//   node tools/sizzle-launcher/make-ico.mjs
// Sizes 16 to 128 are stored as uncompressed 32-bit bitmaps because Explorer's small-icon paths
// still read those most reliably; 256 is a PNG, which is what Windows uses at large zoom.
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pngFromRgba, rasterize } from '../../frontend/scripts/sizzle-mark.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const SIZES = [16, 24, 32, 48, 64, 128, 256];

/** BITMAPINFOHEADER + bottom-up BGRA pixels + a blank 1-bit AND mask (alpha does the work). */
function bmpEntry(size) {
  const rgba = rasterize(size, 'plain');
  const pixels = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    const from = (size - 1 - y) * size * 4;
    for (let x = 0; x < size; x += 1) {
      const at = y * size * 4 + x * 4;
      pixels[at] = rgba[from + x * 4 + 2];
      pixels[at + 1] = rgba[from + x * 4 + 1];
      pixels[at + 2] = rgba[from + x * 4];
      pixels[at + 3] = rgba[from + x * 4 + 3];
    }
  }
  const maskRow = Math.ceil(size / 32) * 4;
  const mask = Buffer.alloc(maskRow * size);
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0);
  header.writeInt32LE(size, 4);
  header.writeInt32LE(size * 2, 8);
  header.writeUInt16LE(1, 12);
  header.writeUInt16LE(32, 14);
  header.writeUInt32LE(0, 16);
  header.writeUInt32LE(pixels.length + mask.length, 20);
  return Buffer.concat([header, pixels, mask]);
}

const images = SIZES.map((size) => ({ size, data: size === 256 ? pngFromRgba(size, rasterize(size, 'plain')) : bmpEntry(size) }));
const headerSize = 6 + images.length * 16;

let offset = headerSize;
const entries = images.map(({ size, data }) => {
  const entry = Buffer.alloc(16);
  entry[0] = size === 256 ? 0 : size;
  entry[1] = size === 256 ? 0 : size;
  entry.writeUInt16LE(1, 4);
  entry.writeUInt16LE(32, 6);
  entry.writeUInt32LE(data.length, 8);
  entry.writeUInt32LE(offset, 12);
  offset += data.length;
  return entry;
});

const dir = Buffer.alloc(6);
dir.writeUInt16LE(1, 2);
dir.writeUInt16LE(images.length, 4);

writeFileSync(join(here, 'Sizzle.ico'), Buffer.concat([dir, ...entries, ...images.map((i) => i.data)]));
console.log(`Sizzle.ico written — ${SIZES.join('/')} px, ${(offset / 1024).toFixed(1)} kB`);
