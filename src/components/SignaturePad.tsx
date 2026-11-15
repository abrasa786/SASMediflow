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
  const strokes = useRef<{ x: number; y: number }[][]>([]);   // the signature as points, so it can be redrawn large and sharp
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
    const x = cv.current!.getContext("2d")!, p = pt(e); x.beginPath(); x.moveTo(p.x, p.y); x.lineTo(p.x + 0.01, p.y + 0.01); x.stroke(); strokes.current.push([p]); setInked(true);
  };
  const move = (e: React.PointerEvent) => { if (!drawing.current) return; const x = cv.current!.getContext("2d")!, p = pt(e); x.lineTo(p.x, p.y); x.stroke(); strokes.current[strokes.current.length - 1]?.push(p); };
  const up = () => { drawing.current = false; };
  const clear = () => { const c = cv.current!, x = c.getContext("2d")!; x.save(); x.setTransform(1, 0, 0, 1, 0, 0); x.clearRect(0, 0, c.width, c.height); x.restore(); strokes.current = []; setInked(false); setMsg(""); };

  function use() {
    const pts = strokes.current.flat();
    if (!pts.length) { setMsg("Please sign inside the box first."); return; }
    const x0 = Math.min(...pts.map((p) => p.x)), x1 = Math.max(...pts.map((p) => p.x)), y0 = Math.min(...pts.map((p) => p.y)), y1 = Math.max(...pts.map((p) => p.y));
    if (x1 - x0 < 6) { setMsg("Please sign inside the box first."); return; }
    // redraw the strokes large (600px on the longest side) with a pen thick enough to show on a printed PDF
    const LW = 6, pad = LW + 4, k = Math.min(12, 600 / Math.max(x1 - x0, y1 - y0, 1));
    const w = Math.max(1, Math.round((x1 - x0) * k + pad * 2)), h = Math.max(1, Math.round((y1 - y0) * k + pad * 2));
    const o = document.createElement("canvas"); o.width = w; o.height = h;
    const g = o.getContext("2d")!; g.lineWidth = LW; g.lineCap = "round"; g.lineJoin = "round"; g.strokeStyle = "#0f1b4d";
    for (const st of strokes.current) {
      g.beginPath();
      st.forEach((p, i) => { const px = (p.x - x0) * k + pad, py = (p.y - y0) * k + pad; if (i === 0) { g.moveTo(px, py); g.lineTo(px + 0.01, py); } else g.lineTo(px, py); });
      g.stroke();
    }
    onUse(o.toDataURL("image/png")); setMsg("");
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
