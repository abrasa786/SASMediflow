"use client";

import { useRef, useState } from "react";
import { authFetch } from "@/lib/api";
import { toast } from "@/lib/toast";
import { FIELDS, MAX_IMPORT_ROWS, SAMPLE_CSV, guessMapping, parseCsv, type Mapping } from "@/lib/import/patients";

const sel = "w-full px-3 py-2.5 rounded-xl border border-slate-300 text-base sm:text-sm bg-white focus:outline-none focus:ring-2 focus:ring-sky-500";
const btn = "px-4 py-3 rounded-xl bg-sky-600 hover:bg-sky-700 disabled:opacity-60 text-white font-semibold";
const btn2 = "px-4 py-3 rounded-xl border border-slate-300 hover:bg-slate-50 font-medium text-slate-800";

/**
 * Bring patients over from Practo or any other app: choose the exported file (CSV), match the columns, check, import.
 * The whole import can be undone. Used inside Setup and on the Import data page.
 */
export default function PatientImport({ clinicId, onDone }: { clinicId: string; onDone?: () => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [map, setMap] = useState<Mapping>({});
  const [preview, setPreview] = useState<any>(null);
  const [result, setResult] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function pick(f?: File) {
    setErr(""); setPreview(null); setResult(null);
    if (!f) return;
    if (!/\.(csv|txt)$/i.test(f.name)) return setErr("Choose a CSV file. In Excel use File → Save As → CSV.");
    if (f.size > 5 * 1024 * 1024) return setErr("That file is over 5 MB. Split it and import it in parts.");
    try {
      const all = parseCsv(await f.text());
      if (all.length < 2) return setErr("The file has no patient rows. The first row must be the column names.");
      const h = all[0].map((x) => x.trim());
      const data = all.slice(1).map((r) => Object.fromEntries(h.map((k, i) => [k, (r[i] ?? "").trim()])));
      if (data.length > MAX_IMPORT_ROWS) return setErr(`This file has ${data.length} patients. Import up to ${MAX_IMPORT_ROWS} at a time by splitting it.`);
      setFileName(f.name); setHeaders(h); setRows(data); setMap(guessMapping(h));
    } catch { setErr("Could not read that file. Make sure it is a CSV."); }
  }

  async function call(action: "preview" | "commit") {
    setErr(""); setBusy(true);
    try {
      const r = await authFetch("/api/import/patients", { body: { clinicId, action, rows, mapping: map, fileName } });
      if (action === "preview") setPreview(r.preview);
      else { setResult(r); setPreview(null); toast(`${r.added} patients imported`); onDone?.(); }
    } catch (e: any) { setErr(e.message || "That did not work. Please try again."); }
    setBusy(false);
  }

  async function undo() {
    if (!result?.batchId) return;
    setBusy(true); setErr("");
    try { const r = await authFetch("/api/import/patients", { body: { clinicId, action: "undo", batchId: result.batchId } }); toast(`Import undone: ${r.removed} patients removed${r.kept ? `, ${r.kept} kept (they already have visits or bills)` : ""}`); setResult(null); setRows([]); setHeaders([]); setFileName(""); onDone?.(); }
    catch (e: any) { setErr(e.message); }
    setBusy(false);
  }

  const sample = () => { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([SAMPLE_CSV], { type: "text/csv" })); a.download = "patients-sample.csv"; a.click(); URL.revokeObjectURL(a.href); };

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600">Moving from Practo or another app? Export your patients from it as a CSV file (ask the app&apos;s support if you cannot find the option), then choose the file here. Nothing is saved until you press Import, and the whole import can be undone.</p>
      <div className="flex flex-col sm:flex-row gap-2">
        <input ref={ref} type="file" accept=".csv,.txt,text/csv" className="sr-only" aria-label="Choose patient file" onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ""; }} />
        <button type="button" onClick={() => ref.current?.click()} className={btn}>{fileName ? "Choose a different file" : "Choose patient file (CSV)"}</button>
        <button type="button" onClick={sample} className={btn2}>Download a sample file</button>
      </div>
      {fileName && !result && <p className="text-sm text-slate-700"><b>{fileName}</b> · {rows.length} patients found</p>}

      {headers.length > 0 && !result && (
        <div className="rounded-xl border border-slate-200 p-3 space-y-3">
          <p className="text-sm font-semibold text-slate-800">Match the columns</p>
          <div className="grid sm:grid-cols-2 gap-3">
            {FIELDS.map((f) => (
              <label key={f.key} className="block text-sm"><span className="font-medium text-slate-700">{f.label}{f.required ? " *" : ""}</span>
                <select className={sel + " mt-1"} value={map[f.key] ?? ""} onChange={(e) => { setPreview(null); setMap((m) => ({ ...m, [f.key]: e.target.value || undefined })); }}>
                  <option value="">{f.required ? "Choose a column" : "Do not import"}</option>
                  {headers.map((h) => <option key={h} value={h}>{h}</option>)}
                </select></label>
            ))}
          </div>
          <button type="button" disabled={busy || !map.name} onClick={() => call("preview")} className={btn}>{busy && !preview ? "Checking…" : "Check the file"}</button>
        </div>
      )}

      {preview && (
        <div className="rounded-xl border border-sky-200 bg-sky-50/60 p-3 space-y-2" role="status">
          <p className="font-semibold text-slate-900">{preview.willAdd} new patients will be added</p>
          <p className="text-sm text-slate-700">{preview.duplicates} already in your patients or repeated · {preview.invalid} cannot be imported</p>
          {preview.sample?.length > 0 && <p className="text-xs text-slate-600">For example: {preview.sample.map((p: any) => `${p.name}${p.phone ? ` (${p.phone})` : ""}`).join(", ")}</p>}
          {(preview.skipped?.length > 0 || preview.warnings?.length > 0) && (
            <details className="text-xs text-slate-700"><summary className="cursor-pointer font-medium">See the problems</summary>
              <ul className="mt-1 max-h-40 overflow-y-auto space-y-0.5">
                {preview.skipped.map((s: any, i: number) => <li key={"s" + i}>Row {s.row} {s.name ? `(${s.name})` : ""}: skipped. {s.reason}</li>)}
                {preview.warnings.map((s: any, i: number) => <li key={"w" + i}>Row {s.row} ({s.name}): {s.note}</li>)}
              </ul></details>
          )}
          <button type="button" disabled={busy || preview.willAdd === 0} onClick={() => call("commit")} className={btn}>{busy ? "Importing…" : `Import ${preview.willAdd} patients`}</button>
        </div>
      )}

      {result && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 space-y-2" role="status">
          <p className="font-semibold text-emerald-900">✓ {result.added} patients imported</p>
          <p className="text-sm text-emerald-900">{result.duplicates} skipped as duplicates · {result.invalid} had problems{result.failed ? ` · ${result.failed} could not be saved` : ""}</p>
          <button type="button" disabled={busy} onClick={undo} className={btn2}>{busy ? "Undoing…" : "Undo this import"}</button>
        </div>
      )}

      {err && <div role="alert" className="flex gap-2 rounded-xl bg-red-50 border border-red-200 text-red-800 text-sm px-3.5 py-3"><span aria-hidden>⚠️</span><span>{err}</span></div>}
    </div>
  );
}
