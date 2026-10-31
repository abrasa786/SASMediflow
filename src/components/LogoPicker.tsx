"use client";

import { useRef, useState } from "react";

const OK_TYPE = /^image\/(png|jpe?g|webp|gif|bmp|heic|heif|avif)$/i;
const OK_EXT = /\.(png|jpe?g|webp|gif|bmp|heic|heif|avif)$/i;

/**
 * Resizes a chosen image to at most 512px and returns it as a data URL (PNG keeps transparency, JPEG for photos).
 * Phone photos are fine: they are shrunk here, so a big camera picture is not a problem.
 * With `transparentBg` the white paper around a stamp photo is made see-through, so only the ink prints on the invoice.
 */
async function toDataUrl(file: File, transparentBg = false): Promise<string> {
  if (!(OK_TYPE.test(file.type) || OK_EXT.test(file.name))) throw new Error("Choose a photo or image (JPG, PNG or WebP).");
  if (file.size > 30 * 1024 * 1024) throw new Error("That image is very large. Choose one under 30 MB.");
  let bmp: ImageBitmap;
  try { bmp = await createImageBitmap(file); }
  catch { throw new Error("This phone's photo format cannot be opened here. Take the photo again as JPG (in the camera settings choose 'Most compatible'), or choose a PNG or JPG."); }
  const scale = Math.min(1, 512 / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(bmp.width * scale)); c.height = Math.max(1, Math.round(bmp.height * scale));
  const ctx = c.getContext("2d")!;
  ctx.drawImage(bmp, 0, 0, c.width, c.height);
  if (transparentBg) {
    const img = ctx.getImageData(0, 0, c.width, c.height), d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const lightest = Math.min(d[i], d[i + 1], d[i + 2]);            // near white = paper
      const a = Math.max(0, Math.min(255, (245 - lightest) * 5));      // soft edge: white goes clear, ink stays
      d[i + 3] = Math.min(d[i + 3], a);
    }
    ctx.putImageData(img, 0, 0);
    return c.toDataURL("image/png");
  }
  const png = c.toDataURL("image/png");
  return png.length < 900_000 ? png : c.toDataURL("image/jpeg", 0.85);
}

export default function LogoPicker({ value, onChange, label = "Clinic logo", hint = "PNG, JPG or WebP. Square works best.", icon = "🏥", uploadText = "Upload logo", transparentBg = false }: { value: string | null; onChange: (dataUrl: string | null) => void; label?: string; hint?: string; icon?: string; uploadText?: string; transparentBg?: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  const [err, setErr] = useState("");
  const [clear, setClear] = useState(true);              // make the white around a stamp see-through
  const [last, setLast] = useState<File | null>(null);

  async function load(f: File, makeClear: boolean) {
    setErr("");
    try { onChange(await toDataUrl(f, transparentBg && makeClear)); setLast(f); } catch (x: any) { setErr(x.message); }
  }

  return (
    <div>
      <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1">{label}</p>
      <div className="flex items-center gap-3">
        <div className="w-16 h-16 rounded-2xl border border-dashed border-gray-300 bg-gray-50 flex items-center justify-center overflow-hidden shrink-0" style={transparentBg ? { backgroundImage: "repeating-conic-gradient(#e5e7eb 0% 25%, #fff 0% 50%)", backgroundSize: "12px 12px" } : undefined}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {value ? <img src={value} alt="Logo preview" className="w-full h-full object-contain" /> : <span className="text-2xl text-gray-300">{icon}</span>}
        </div>
        <div className="text-sm">
          {/* image/* shows every photo on a phone, including ones taken a moment ago with the camera */}
          <input ref={ref} type="file" accept="image/*,.heic,.heif" className="sr-only" aria-label="Upload logo"
            onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) load(f, clear); }} />
          <button type="button" onClick={() => ref.current?.click()} className="px-3 py-1.5 rounded-lg border border-gray-300 text-xs font-semibold hover:bg-gray-50">{value ? "Change" : uploadText}</button>
          {value && <button type="button" onClick={() => { onChange(null); setLast(null); }} className="ml-2 text-xs text-red-600 hover:underline">Remove</button>}
          <p className="text-xs text-gray-400 mt-1">{hint}</p>
          {transparentBg && (
            <label className="flex items-center gap-2 mt-1.5 text-xs text-gray-600">
              <input type="checkbox" checked={clear} onChange={(e) => { setClear(e.target.checked); if (last) load(last, e.target.checked); }} className="w-4 h-4" />
              Make the white paper around the stamp see-through
            </label>
          )}
          {err && <div className="mt-2 flex gap-2 rounded-lg bg-red-50 border border-red-200 text-red-800 text-xs px-3 py-2" role="alert"><span aria-hidden>⚠️</span><span>{err}</span></div>}
        </div>
      </div>
    </div>
  );
}
