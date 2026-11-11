import { useRef, useState } from 'react';
import { Camera, ImageUp, Loader2 } from 'lucide-react';
import { http, errMsg, mediaUrl } from '../lib/api';
import { Field } from './ui';
import { toast } from '../store/toasts';

/** A phone should reach for the camera; a laptop should reach for the drawer. */
const hasCamera = typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches;

const HEIC_NAME = /\.(heic|heif)$/i;

/**
 * Safari and current Chrome can open an iPhone's HEIC, Firefox and a lot of Android cannot, so a dish
 * stored in that format is a blank tile on part of the floor. Redrawing it through a canvas hands the
 * server an ordinary JPEG that every screen can show. Where the browser cannot decode the original at
 * all the file goes up untouched — the server takes it, and a photo some viewers can see still beats
 * throwing the owner's picture away.
 */
async function asJpeg(file: File): Promise<File> {
  if (!HEIC_NAME.test(file.name) && !/^image\/hei/.test(file.type)) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const longest = 1400;
    const scale = Math.min(1, longest / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('this browser has no canvas to redraw the photo');
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((done) => canvas.toBlob(done, 'image/jpeg', 0.86));
    if (!blob) throw new Error('the photo could not be redrawn');
    return new File([blob], `${file.name.replace(HEIC_NAME, '')}.jpg`, { type: 'image/jpeg' });
  } catch {
    return file;
  }
}

/**
 * One upload control for every picture in the product. The file goes straight to the
 * API and only the returned path is stored, so nobody ever pastes an image URL.
 */
export function ImagePicker({
  label,
  value,
  onChange,
  className = '',
  uploadUrl = '/uploads',
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  className?: string;
  uploadUrl?: string;
}) {
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const camRef = useRef<HTMLInputElement>(null);

  async function send(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith('image/') && !HEIC_NAME.test(file.name)) {
      toast('That is not a photo', 'error');
      return;
    }
    setUploading(true);
    try {
      const form = new FormData();
      form.append('file', await asJpeg(file));
      const { data } = await http.post<{ url: string }>(uploadUrl, form, { headers: { 'Content-Type': 'multipart/form-data' } });
      onChange(data.url);
      toast(`${label} added`, 'success');
    } catch (e) {
      toast(errMsg(e, 'Upload failed'), 'error');
    } finally {
      setUploading(false);
    }
  }

  const openInput = (ref: typeof fileRef) => ref.current?.click();

  return (
    <Field label={label} className={className}>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => openInput(hasCamera ? camRef : fileRef)}
          title={value ? 'Replace the photo' : 'Add a photo'}
          className={`relative grid h-20 w-20 shrink-0 place-items-center overflow-hidden rounded-xl ring-1 transition-colors ${
            value ? 'ring-ink-200 hover:ring-ember-400' : 'border border-dashed border-ink-300 bg-ink-50 text-ink-400 hover:border-ember-400 hover:text-ember-600'
          }`}
        >
          {uploading ? (
            <Loader2 size={19} className="animate-spin text-ember-600" />
          ) : value ? (
            <img src={mediaUrl(value)} alt="" className="h-full w-full object-cover" />
          ) : (
            <ImageUp size={19} />
          )}
        </button>

        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px] font-semibold">
            <button type="button" className="inline-flex items-center gap-1.5 text-ember-600 hover:text-ember-700" onClick={() => openInput(fileRef)}>
              <ImageUp size={13} /> Upload a photo
            </button>
            {hasCamera && (
              <button type="button" className="inline-flex items-center gap-1.5 text-ember-600 hover:text-ember-700" onClick={() => openInput(camRef)}>
                <Camera size={13} /> Take a photo
              </button>
            )}
            {value && !uploading && (
              <button type="button" className="text-ink-400 hover:text-red-700" onClick={() => onChange('')}>
                Remove
              </button>
            )}
          </div>
          <p className="text-[11.5px] leading-snug text-ink-400">
            {uploading ? 'Sending it up…' : 'JPEG, PNG, WebP or HEIC up to 5 MB. It replaces the picture on this line.'}
          </p>
        </div>
      </div>

      <input ref={fileRef} type="file" accept="image/*,.heic,.heif" className="hidden" onChange={(e) => { void send(e.target.files?.[0]); e.target.value = ''; }} />
      <input ref={camRef} type="file" accept="image/*,.heic,.heif" capture="environment" className="hidden" onChange={(e) => { void send(e.target.files?.[0]); e.target.value = ''; }} />
    </Field>
  );
}
