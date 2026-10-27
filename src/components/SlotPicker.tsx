"use client";

import { useEffect, useState } from "react";
import { authFetch } from "@/lib/api";

/** Free-slot chips for one day, straight from the availability engine. */
export default function SlotPicker({ clinicId, date, doctorId, value, onChange, reloadKey = 0, duration }: {
  clinicId: string; date: string; doctorId?: string; value: string; onChange: (t: string) => void; reloadKey?: number; duration?: number;
}) {
  const [times, setTimes] = useState<string[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [err, setErr] = useState("");

  useEffect(() => {
    let live = true;
    if (!clinicId || !date) return;
    setState("loading");
    const qs = new URLSearchParams({ clinicId, date, ...(doctorId ? { doctorId } : {}), ...(duration ? { duration: String(duration) } : {}) });
    authFetch(`/api/appointments/slots?${qs}`)
      .then((r) => { if (!live) return; setTimes(doctorId ? (r.doctors?.[0]?.times ?? []) : (r.anyTimes ?? [])); setState("ready"); })
      .catch((e) => { if (!live) return; setErr(e.message); setState("error"); });
    return () => { live = false; };
  }, [clinicId, date, doctorId, reloadKey, duration]);

  useEffect(() => { if (value && state === "ready" && !times.includes(value)) onChange(""); }, [times, state]); // eslint-disable-line

  if (state === "loading") return <p className="text-xs text-slate-400">Checking availability…</p>;
  if (state === "error") return <p className="text-xs text-red-600">{err}</p>;
  if (!times.length) return <p className="text-xs text-amber-700 bg-amber-50 rounded-lg px-3 py-2">No free slots on this day. The doctor may be on leave, the clinic closed, or fully booked. Try another date{doctorId ? " or choose auto-assign" : ""}.</p>;
  return (
    <div className="flex flex-wrap gap-1.5 max-h-36 overflow-y-auto">
      {times.map((t) => (
        <button key={t} type="button" onClick={() => onChange(t)}
          className={`px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors ${value === t ? "bg-sky-500 border-sky-500 text-white" : "bg-white border-slate-200 text-slate-700 hover:border-sky-300"}`}>
          {t}
        </button>
      ))}
    </div>
  );
}
