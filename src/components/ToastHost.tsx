"use client";

import { useEffect, useState } from "react";

/** Messages such as "Appointment created successfully" appear at the top of every page for a few seconds. Mounted once in AppShell. */
export default function ToastHost() {
  const [items, setItems] = useState<{ id: number; text: string; ok: boolean }[]>([]);
  useEffect(() => {
    let n = 0;
    const on = (e: Event) => {
      const d = (e as CustomEvent).detail as { text: string; ok: boolean };
      const id = ++n;
      setItems((p) => [...p.slice(-2), { id, text: d.text, ok: d.ok }]);
      setTimeout(() => setItems((p) => p.filter((x) => x.id !== id)), d.ok ? 4000 : 7000);
    };
    window.addEventListener("mf:toast", on);
    return () => window.removeEventListener("mf:toast", on);
  }, []);
  if (!items.length) return null;
  return (
    <div className="fixed top-3 inset-x-3 z-[100] flex flex-col items-center gap-2 pointer-events-none" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} role="status" className={`pointer-events-auto max-w-md w-full sm:w-auto rounded-xl px-4 py-3 text-sm font-medium shadow-lg border ${t.ok ? "bg-emerald-600 text-white border-emerald-700" : "bg-red-600 text-white border-red-700"}`}>
          {t.ok ? "✓ " : "⚠ "}{t.text}
        </div>
      ))}
    </div>
  );
}
