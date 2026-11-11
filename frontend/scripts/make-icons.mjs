// Writes the PWA and favicon icon set into public/icons. The geometry lives in sizzle-mark.mjs,
// which the Windows launcher icon in ../../tools/sizzle-launcher is also built from.
//   node scripts/make-icons.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderPng, svgIcon } from './sizzle-mark.mjs';

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');

mkdirSync(outDir, { recursive: true });
// One staff install, one guest install: both are the brand, so every file comes from one skin.
for (const [name, size, variant] of [
  ['icon-192.png', 192, 'plain'],
  ['icon-512.png', 512, 'plain'],
  ['maskable-512.png', 512, 'maskable'],
  ['apple-touch-icon.png', 180, 'maskable'],
]) {
  writeFileSync(join(outDir, name), renderPng(size, variant));
}
writeFileSync(join(outDir, 'favicon.svg'), svgIcon(64, 'plain'));
writeFileSync(join(outDir, 'icon.svg'), svgIcon(512, 'maskable'));
console.log('icons written to public/icons');
