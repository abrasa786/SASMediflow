"use client";

const PAL = ["#0369a1", "#b45309", "#047857", "#7c3aed", "#be123c", "#0e7490", "#4d7c0f", "#a16207"];
const fmt = (n: any, money?: boolean) => { const v = Number(n); if (!Number.isFinite(v)) return String(n ?? "–"); return (money ? "₹" : "") + v.toLocaleString("en-IN", { maximumFractionDigits: 2 }); };

export function cell(v: any, type: string) {
  if (v == null || v === "") return "–";
  if (type === "currency") return fmt(v, true);
  if (type === "boolean") return v ? "Yes" : "No";
  if (type === "date") return new Date(v + "T00:00:00Z").toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  if (type === "datetime") return new Date(v).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });
  return String(v);
}

export default function ReportView({ result, chart }: { result: any; chart: string }) {
  if (!result) return null;
  const money = /sum|avg|min|max/.test(result.aggregate ?? "") && /fee|price|total|paid|amount|subtotal|gst|cost/i.test(result.agg_label ?? "");

  if (result.kind === "number") return (
    <div className="py-4"><p className="text-4xl font-bold text-slate-900 tabular-nums">{fmt(result.value, money)}</p><p className="text-sm text-slate-500 mt-1">{result.aggregate === "count" ? `${result.label} (count)` : `${result.aggregate} of ${result.agg_label}`}</p></div>
  );

  if (result.kind === "rows") return (
    <div className="overflow-x-auto"><table className="w-full text-sm">
      <thead><tr className="text-left text-xs uppercase text-slate-500">{result.columns.map((c: any) => <th key={c.api} className="px-3 py-2 font-medium">{c.label}</th>)}</tr></thead>
      <tbody className="divide-y divide-slate-100">{result.rows.map((r: any) => <tr key={r.id}>{result.columns.map((c: any) => <td key={c.api} className="px-3 py-2 text-slate-700">{cell(r[c.api], c.type)}</td>)}</tr>)}</tbody></table>
      {result.rows.length === 0 && <p className="text-sm text-slate-400 py-4 text-center">No matching records.</p>}
      {result.total > result.rows.length && <p className="text-xs text-slate-400 mt-1">Showing {result.rows.length} of {result.total}.</p>}</div>
  );

  const rows: { key: string; value: number }[] = (result.rows ?? []).map((r: any) => ({ key: String(r.key), value: Number(r.value) || 0 }));
  if (rows.length === 0) return <p className="text-sm text-slate-400 py-4 text-center">No matching records.</p>;
  const total = rows.reduce((s, r) => s + r.value, 0);

  if (chart === "pie") {
    let a = -Math.PI / 2; const R = 70;
    const slices = rows.slice(0, 8).map((r, i) => { const frac = total ? r.value / total : 0; const a2 = a + frac * 2 * Math.PI; const big = frac > 0.5 ? 1 : 0;
      const d = frac >= 0.999 ? `M0,${-R} A${R},${R} 0 1 1 -0.01,${-R} Z` : `M0,0 L${R * Math.cos(a)},${R * Math.sin(a)} A${R},${R} 0 ${big} 1 ${R * Math.cos(a2)},${R * Math.sin(a2)} Z`; a = a2; return { d, c: PAL[i % PAL.length], r, frac }; });
    return (
      <div className="flex flex-wrap items-center gap-6">
        <svg viewBox="-80 -80 160 160" width="160" height="160" role="img" aria-label={`${result.group_label} breakdown`}>{slices.map((s, i) => <path key={i} d={s.d} fill={s.c} stroke="#fff" strokeWidth="1.5" />)}</svg>
        <ul className="text-sm space-y-1 min-w-0">{slices.map((s, i) => <li key={i} className="flex items-center gap-2"><span className="w-3 h-3 rounded-sm shrink-0" style={{ background: s.c }} /><span className="truncate">{s.r.key}</span><span className="text-slate-500 tabular-nums ml-auto pl-3">{fmt(s.r.value, money)} · {Math.round(s.frac * 100)}%</span></li>)}</ul>
      </div>);
  }

  if (chart === "bar") {
    const max = Math.max(...rows.map((r) => r.value), 1);
    return (
      <ul className="space-y-1.5" aria-label={`${result.group_label} by ${result.agg_label}`}>{rows.slice(0, 30).map((r) => (
        <li key={r.key} className="grid grid-cols-[minmax(80px,30%)_1fr_auto] items-center gap-2 text-sm"><span className="truncate text-slate-600" title={r.key}>{r.key}</span>
          <span className="h-5 rounded bg-slate-100 overflow-hidden"><span className="block h-full rounded" style={{ width: `${Math.max(2, (r.value / max) * 100)}%`, background: PAL[0] }} /></span>
          <span className="tabular-nums text-slate-800 w-20 text-right">{fmt(r.value, money)}</span></li>))}</ul>);
  }

  return (
    <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="text-left text-xs uppercase text-slate-500"><th className="px-3 py-2 font-medium">{result.group_label}</th><th className="px-3 py-2 font-medium text-right">{result.aggregate === "count" ? "Count" : `${result.aggregate} ${result.agg_label}`}</th></tr></thead>
      <tbody className="divide-y divide-slate-100">{rows.map((r) => <tr key={r.key}><td className="px-3 py-2">{r.key}</td><td className="px-3 py-2 text-right tabular-nums">{fmt(r.value, money)}</td></tr>)}</tbody></table></div>
  );
}
