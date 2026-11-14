"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/Icon";

/**
 * Draw a signature with a finger, pen or mouse. "Use this signature" returns a transparent PNG cropped to the ink,
 * so only the strokes print on the invoice.
 */
export default function SignaturePad({ onUse }: { onUse: (dataUrl: string) => void }) {
  const cv = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [inked, setInked] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    const c = cv.current!, r = c.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = Math.round(r.width * dpr); c.height = Math.round(r.height * dpr);
    const x = c.getContext("2d")!; x.scale(dpr, dpr); x.lineWidth = 2.4; x.lineCap = "round"; x.lineJoin = "round"; x.strokeStyle = "#0f1b4d";
  }, []);

  const pt = (e: React.PointerEvent) => { const r = cv.current!.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  const down = (e: React.PointerEvent) => {
    e.preventDefault(); cv.current!.setPointerCapture(e.pointerId); drawing.current = true; setMsg("");
    const x = cv.current!.getContext("2d")!, p = pt(e); x.beginPath(); x.moveTo(p.x, p.y); x.lineTo(p.x + 0.01, p.y + 0.01); x.stroke(); setInked(true);
  };
  const move = (e: React.PointerEvent) => { if (!drawing.current) return; const x = cv.current!.getContext("2d")!, p = pt(e); x.lineTo(p.x, p.y); x.stroke(); };
  const up = () => { drawing.current = false; };
  const clear = () => { const c = cv.current!, x = c.getContext("2d")!; x.save(); x.setTransform(1, 0, 0, 1, 0, 0); x.clearRect(0, 0, c.width, c.height); x.restore(); setInked(false); setMsg(""); };

  function use() {
    const c = cv.current!, x = c.getContext("2d")!, img = x.getImageData(0, 0, c.width, c.height), d = img.data;
    let x0 = c.width, y0 = c.height, x1 = -1, y1 = -1;
    for (let y = 0; y < c.height; y++) for (let xx = 0; xx < c.width; xx++) if (d[(y * c.width + xx) * 4 + 3] > 20) { if (xx < x0) x0 = xx; if (xx > x1) x1 = xx; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    if (x1 < 0 || x1 - x0 < 12) { setMsg("Please sign inside the box first."); return; }
    const pad = 6, w = x1 - x0 + 1 + pad * 2, h = y1 - y0 + 1 + pad * 2, o = document.createElement("canvas");
    o.width = w; o.height = h; o.getContext("2d")!.putImageData(x.getImageData(Math.max(0, x0 - pad), Math.max(0, y0 - pad), w, h), 0, 0);
    const k = Math.min(1, 600 / Math.max(w, h)), s = document.createElement("canvas"); s.width = Math.max(1, Math.round(w * k)); s.height = Math.max(1, Math.round(h * k));
    s.getContext("2d")!.drawImage(o, 0, 0, s.width, s.height);
    onUse(s.toDataURL("image/png")); setMsg("");
  }

  return (
    <div>
      <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide mb-1">Draw your signature</p>
      <canvas ref={cv} role="img" aria-label="Signature box. Draw with your finger or mouse." data-testid="signature-canvas"
        onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
        className="w-full h-36 rounded-lg border border-dashed border-slate-300 bg-white" style={{ touchAction: "none", cursor: "crosshair" }} />
      <div className="flex items-center gap-2 mt-2">
        <button type="button" onClick={use} disabled={!inked} className="px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-700 disabled:opacity-50 text-white text-xs font-semibold"><Icon name="check" size={14} /> Use this signature</button>
        <button type="button" onClick={clear} disabled={!inked} className="px-3 py-1.5 rounded-lg border border-slate-300 text-xs font-semibold hover:bg-slate-50 disabled:opacity-50">Clear</button>
      </div>
      {msg && <p role="alert" className="mt-2 text-xs text-red-700">{msg}</p>}
    </div>
  );
}
