"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import AppShell from "@/components/layout/AppShell";
import { getActiveClinicId } from "@/lib/auth";
import { authFetch } from "@/lib/api";
import { getInvoices } from "@/lib/clinic";
import type { Invoice } from "@/types";

const METHOD: Record<string, string> = { physical: "Physical", cash: "Cash", qr: "QR", upi: "UPI", online: "Online link", card: "Card", insurance: "Insurance", other: "Other" };

/** Every bill and whether its payment is done. Marking a payment done also closes the appointment. */
export default function PaymentsPage() {
  const router = useRouter();
  const [clinicId, setClinicId] = useState("");
  const [rows, setRows] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [tab, setTab] = useState<"pending" | "done" | "all">("pending");
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");

  async function load(id: string) { setLoading(true); setRows(await getInvoices(id, 300)); setLoading(false); }
  useEffect(() => {
    const id = getActiveClinicId();
    if (!id) { router.push("/login"); return; }
    setClinicId(id); load(id);
  }, [router]);

  const isDone = (i: Invoice) => i.status === "paid";
  const list = useMemo(() => {
    const t = q.trim().toLowerCase();
    return rows.filter((i) => i.status !== "cancelled" && (tab === "all" || (tab === "done") === isDone(i)))
      .filter((i) => !t || (i.invoice_number ?? "").toLowerCase().includes(t) || (i.patient?.name ?? "").toLowerCase().includes(t) || (i.patient?.phone ?? "").includes(t));
  }, [rows, q, tab]);
  const pendingTotal = rows.filter((i) => i.status !== "cancelled" && !isDone(i)).reduce((n, i) => n + Math.max(0, Number(i.total || 0) - Number(i.paid_amount || 0)), 0);

  async function markDone(i: Invoice) {
    setBusy(i.id); setErr("");
    try {
      const r = await authFetch<{ appointmentId: string | null; appointmentDate: string | null }>("/api/payments/complete", { body: { clinicId, invoiceId: i.id, method: "physical" } });
      if (r.appointmentId) { router.push(`/appointments?date=${r.appointmentDate ?? ""}`); return; }
      await load(clinicId);
    } catch (e: any) { setErr(e.message); } finally { setBusy(""); }
  }

  return (
    <AppShell>
      <div className="p-4 sm:p-6 max-w-5xl mx-auto">
        <h1 className="text-2xl font-bold text-slate-900">Payments</h1>
        <p className="text-slate-500 text-sm mt-1">To collect: <strong className="text-amber-600">₹{pendingTotal.toLocaleString("en-IN")}</strong></p>
        <div className="flex flex-col sm:flex-row gap-3 mt-4 mb-4">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search patient, phone or invoice number" className="flex-1 px-3 py-2.5 rounded-xl border border-slate-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-sky-500" />
          <div className="flex gap-1.5">
            {([["pending", "Not done"], ["done", "Done"], ["all", "All"]] as const).map(([k, l]) => (
              <button key={k} onClick={() => setTab(k)} className={`px-3 py-2 rounded-lg text-xs font-semibold ${tab === k ? "bg-slate-900 text-white" : "bg-white border border-slate-200 text-slate-600"}`}>{l}</button>
            ))}
          </div>
        </div>
        {err && <p className="text-sm text-red-700 bg-red-50 rounded-lg px-3 py-2 mb-3" role="alert">{err}</p>}
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
          {loading ? <div className="py-16 text-center text-slate-400 text-sm">Loading…</div> : list.length === 0 ? (
            <div className="py-16 text-center text-slate-400 text-sm"><div className="text-4xl mb-3">💳</div>{tab === "pending" ? "No payments waiting" : "Nothing here"}</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-slate-500 text-xs uppercase"><tr>
                  <th className="px-4 py-3 text-left font-medium">Patient</th><th className="px-4 py-3 text-left font-medium">Invoice</th>
                  <th className="px-4 py-3 text-right font-medium">Amount</th><th className="px-4 py-3 text-left font-medium hidden sm:table-cell">Method</th>
                  <th className="px-4 py-3 text-left font-medium">Status</th><th className="px-4 py-3" />
                </tr></thead>
                <tbody className="divide-y divide-slate-50">
                  {list.map((i) => (
                    <tr key={i.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3"><p className="font-medium text-slate-900">{i.patient?.name ?? "—"}</p><p className="text-xs text-slate-400">{i.patient?.phone ?? ""}</p></td>
                      <td className="px-4 py-3 font-mono text-xs text-slate-600">{i.invoice_number ?? "—"}</td>
                      <td className="px-4 py-3 text-right font-semibold">₹{Number(i.total || 0).toLocaleString("en-IN")}</td>
                      <td className="px-4 py-3 text-slate-500 text-xs hidden sm:table-cell">{METHOD[i.payment_method ?? "physical"] ?? i.payment_method}</td>
                      <td className="px-4 py-3"><span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${isDone(i) ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>{isDone(i) ? "Done" : "Not done"}</span></td>
                      <td className="px-4 py-3 text-right">{!isDone(i) && <button disabled={busy === i.id} onClick={() => markDone(i)} className="text-xs px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-700 text-white font-medium disabled:opacity-60">{busy === i.id ? "Saving…" : "Payment received"}</button>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
