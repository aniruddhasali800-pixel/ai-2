/**
 * The guest's table sticker, read by this browser's own camera.
 *
 * The decoder is bundled rather than borrowed: the platform's built-in barcode reader is
 * missing from Chrome on Windows and from Firefox everywhere, so a waiter's tablet or a
 * guest's laptop would otherwise be left typing codes by hand. jsQR only needs pixels,
 * which every browser can give us from a <video> frame.
 */
import jsQR from 'jsqr';

export class CameraUnavailable extends Error {}

// A QR on a laminated sticker fills a corner of the frame; 640px decodes it comfortably
// and keeps one pass fast enough to run between animation ticks.
const DECODE_WIDTH = 640;

function drawFrame(video: HTMLVideoElement, canvas: HTMLCanvasElement): ImageData | null {
  const w = video.videoWidth;
  const h = video.videoHeight;
  if (!w || !h) return null;
  const scale = Math.min(1, DECODE_WIDTH / w);
  const cw = Math.round(w * scale);
  const ch = Math.round(h * scale);
  if (canvas.width !== cw || canvas.height !== ch) {
    canvas.width = cw;
    canvas.height = ch;
  }
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(video, 0, 0, cw, ch);
  return ctx.getImageData(0, 0, cw, ch);
}

/**
 * Opens the rear camera and calls onCode with the first QR it reads, then releases the
 * lens. The returned function stops the stream early — a left-open camera on a phone
 * drains the battery and keeps the privacy light on.
 */
export async function startQrCamera(
  video: HTMLVideoElement,
  onCode: (code: string) => void,
): Promise<() => void> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new CameraUnavailable('This page cannot reach a camera — type the code instead');
  }

  let stream: MediaStream | null = null;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } },
      audio: false,
    });
  } catch (e) {
    const name = (e as DOMException)?.name;
    if (name === 'NotAllowedError') throw new CameraUnavailable('Camera blocked — allow it in the browser, or type the code');
    if (name === 'NotFoundError') throw new CameraUnavailable('No camera found — type the code instead');
    if (name === 'NotReadableError') throw new CameraUnavailable('The camera is busy in another app — close it and try again');
    throw new CameraUnavailable('The camera could not start — type the code instead');
  }

  video.srcObject = stream;
  video.setAttribute('playsinline', 'true');
  await video.play().catch(() => undefined);
  if (!video.videoWidth) {
    await new Promise<void>((resolve) => {
      video.addEventListener('loadedmetadata', () => resolve(), { once: true });
      window.setTimeout(resolve, 2500);
    });
  }

  const canvas = document.createElement('canvas');
  let reading = true;
  let finished = false;
  let timer = 0;

  const stop = () => {
    reading = false;
    window.clearTimeout(timer);
    stream?.getTracks().forEach((track) => track.stop());
    video.srcObject = null;
  };

  const readFrame = () => {
    if (!reading || finished) return;
    try {
      const pixels = drawFrame(video, canvas);
      if (pixels) {
        const found = jsQR(pixels.data, pixels.width, pixels.height, { inversionAttempts: 'attemptBoth' });
        if (found?.data) {
          finished = true;
          navigator.vibrate?.(35);
          stop();
          onCode(found.data);
          return;
        }
      }
    } catch {
      // A blurry or mid-scroll frame is normal; the next tick tries again.
    }
    if (reading && !finished) timer = window.setTimeout(readFrame, 90);
  };

  timer = window.setTimeout(readFrame, 90);
  return stop;
}
