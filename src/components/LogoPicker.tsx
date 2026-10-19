"use client";

import { useRef, useState } from "react";

/** Resizes a chosen image to at most 512px and returns it as a data URL (PNG keeps transparency, JPEG for photos). */
async function toDataUrl(file: File): Promise<string> {
  if (!/^image\/(png|jpeg|webp)$/.test(file.type)) throw new Error("Choose a PNG, JPG or WebP image.");
  if (file.size > 8 * 1024 * 1024) throw new Error("That image is very large. Choose one under 8 MB.");
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, 512 / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(bmp.width * scale)); c.height = Math.max(1, Math.round(bmp.height * scale));
  c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
  const png = c.toDataURL("image/png");
  return png.length < 900_000 ? png : c.toDataURL("image/jpeg", 0.85);
}

export default function LogoPicker({ value, onChange, label = "Clinic logo" }: { value: string | null; onChange: (dataUrl: string | null) => void; label?: string }) {
  const ref = useRef<HTMLInputElement>(null);
  const [err, setErr] = useState("");
  return (
    <div>
      <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1">{label}</p>
      <div className="flex items-center gap-3">
        <div className="w-16 h-16 rounded-2xl border border-dashed border-gray-300 bg-gray-50 flex items-center justify-center overflow-hidden shrink-0">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {value ? <img src={value} alt="Logo preview" className="w-full h-full object-contain" /> : <span className="text-2xl text-gray-300">🏥</span>}
        </div>
        <div className="text-sm">
          <input ref={ref} type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" aria-label="Upload logo"
            onChange={async (e) => { const f = e.target.files?.[0]; e.target.value = ""; if (!f) return; setErr(""); try { onChange(await toDataUrl(f)); } catch (x: any) { setErr(x.message); } }} />
          <button type="button" onClick={() => ref.current?.click()} className="px-3 py-1.5 rounded-lg border border-gray-300 text-xs font-semibold hover:bg-gray-50">{value ? "Change" : "Upload logo"}</button>
          {value && <button type="button" onClick={() => onChange(null)} className="ml-2 text-xs text-red-600 hover:underline">Remove</button>}
          <p className="text-xs text-gray-400 mt-1">PNG, JPG or WebP. Square works best.</p>
          {err && <p className="text-xs text-red-600 mt-1" role="alert">{err}</p>}
        </div>
      </div>
    </div>
  );
}
