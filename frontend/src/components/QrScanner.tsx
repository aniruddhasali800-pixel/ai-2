import { useEffect, useRef, useState } from 'react';
import { CameraOff, Keyboard, ScanLine, X } from 'lucide-react';
import { startQrCamera } from '../lib/scan';

/**
 * The shared "hold up your phone" control. The camera opens first because the decoder
 * ships with the app, not with the browser; the text box is the escape for a device with
 * no lens at all, or one whose owner denied the camera.
 */
export function QrScanner({
  onCode,
  onCancel,
  hint = 'Point at the printed code',
  tall = false,
  defaultMode,
}: {
  onCode: (code: string) => void;
  onCancel?: () => void;
  hint?: string;
  tall?: boolean;
  defaultMode?: 'camera' | 'type';
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [mode, setMode] = useState<'camera' | 'type'>(defaultMode ?? 'camera');
  const [error, setError] = useState('');
  const [typed, setTyped] = useState('');

  // Held in a ref so a parent that re-renders (every keystroke in the name box) does not
  // tear the camera down and ask for the permission again.
  const codeHandler = useRef(onCode);
  useEffect(() => {
    codeHandler.current = onCode;
  }, [onCode]);

  useEffect(() => {
    if (mode !== 'camera') return;
    const video = videoRef.current;
    if (!video) return;

    let stop = () => {};
    let alive = true;
    void (async () => {
      try {
        const done = await startQrCamera(video, (code) => {
          if (alive) codeHandler.current(code);
        });
        stop = done;
      } catch (e) {
        if (alive) {
          setError(e instanceof Error ? e.message : 'The camera would not open');
          setMode('type');
        }
      }
    })();

    return () => {
      alive = false;
      stop();
    };
  }, [mode]);

  return (
    <div className="card overflow-hidden">
      <div className="flex items-center gap-2 border-b border-ink-100 px-3.5 py-2.5">
        <ScanLine size={15} className="text-ember-600" />
        <p className="min-w-0 flex-1 truncate text-[13px] font-semibold text-ink-800">
          {mode === 'camera' ? hint : 'Type the code'}
        </p>
        {mode === 'camera' && (
          <button onClick={() => setMode('type')} className="inline-flex items-center gap-1 text-[12px] font-semibold text-ink-500 hover:text-ink-900">
            <Keyboard size={12} /> Type instead
          </button>
        )}
        {onCancel && (
          <button onClick={onCancel} className="grid h-7 w-7 place-items-center rounded-lg text-ink-400 hover:bg-ink-100 hover:text-ink-800" aria-label="Close the scanner">
            <X size={15} />
          </button>
        )}
      </div>

      {mode === 'camera' ? (
        <div className={`relative bg-ink-950 ${tall ? 'aspect-[4/3]' : 'aspect-video'}`}>
          <video ref={videoRef} className="h-full w-full object-cover opacity-90" muted playsInline />
          <div className="pointer-events-none absolute inset-0 grid place-items-center">
            <span className="h-40 w-40 rounded-2xl border-2 border-white/70 shadow-[0_0_0_9999px_rgba(28,25,23,0.45)]" />
          </div>
          {!error && (
            <p className="absolute inset-x-0 bottom-2 text-center text-[11.5px] font-medium text-white/80">
              Hold steady — it reads itself
            </p>
          )}
        </div>
      ) : (
        <form
          className="space-y-2.5 px-3.5 py-3.5"
          onSubmit={(e) => {
            e.preventDefault();
            if (!typed.trim()) return;
            onCode(typed.trim());
          }}
        >
          {error && (
            <p className="flex items-start gap-2 rounded-xl bg-amber-50 px-3 py-2 text-[12px] font-medium text-amber-800 ring-1 ring-amber-200">
              <CameraOff size={13} className="mt-0.5 shrink-0" /> {error}
            </p>
          )}
          <input
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoFocus
            placeholder="https://…/t/ab12CD or the number printed on it"
            className="w-full rounded-lg border border-ink-200 bg-white px-3 py-2 font-mono text-[13px] text-ink-900 placeholder:text-ink-400 focus:border-ember-400 focus:outline-none"
          />
          <button
            type="submit"
            className="h-10 w-full rounded-[10px] border border-ember-600/40 bg-ember-500 text-[14px] font-bold text-white transition-[background,transform] hover:bg-ember-600 active:scale-[0.99]"
          >
            Look it up
          </button>
        </form>
      )}
    </div>
  );
}
