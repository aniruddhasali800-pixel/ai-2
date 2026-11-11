import { toast } from '../store/toasts';

/**
 * The QR images on screen are PNG data URLs the API already rendered, so saving one costs no
 * round trip — it only has to become a blob, because a browser will not let an anchor download a
 * data: URL it did not create. The file keeps the code exactly as printed on the card, so the
 * sticker and the screen can never disagree about where a scan leads.
 */
export function downloadQr(filename: string, dataUrl: string | null | undefined) {
  if (!dataUrl) return;
  const comma = dataUrl.indexOf(',');
  if (comma < 0) return;
  const mime = /:(.*?);/.exec(dataUrl.slice(0, comma))?.[1] ?? 'image/png';
  const binary = atob(dataUrl.slice(comma + 1));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);

  const href = URL.createObjectURL(new Blob([bytes], { type: mime }));
  const a = document.createElement('a');
  a.href = href;
  a.download = fileName(filename);
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(href);
  toast(`Saved ${fileName(filename)}`, 'success');
}

/** A table number can carry anything the owner typed, so keep only what a filename may hold. */
function fileName(name: string): string {
  const clean = name
    .replace(/\.png$/i, '')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return `${clean || 'qr'}.png`;
}
