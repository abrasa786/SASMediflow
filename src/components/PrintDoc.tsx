"use client";

export const inr = (n: number) => "₹" + (Math.round((Number(n) || 0) * 100) / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function PrintDoc({ clinic, title, number, meta, children, showStamp = false }: { clinic: any; title: string; number: string; meta: [string, string][]; children: React.ReactNode; showStamp?: boolean }) {
  return (
    <div className="min-h-screen bg-slate-100 print:bg-white py-6 print:py-0">
      <style>{`@media print { .no-print { display: none !important } @page { margin: 14mm } }`}</style>
      <div className="no-print max-w-3xl mx-auto mb-3 flex justify-between px-4">
        <button onClick={() => window.close()} className="text-sm text-slate-600 hover:underline">Close</button>
        <button onClick={() => window.print()} className="px-4 py-2 rounded-xl bg-sky-600 text-white text-sm font-semibold">Print / Save as PDF</button>
      </div>
      <div className="max-w-3xl mx-auto bg-white shadow print:shadow-none p-8 text-sm text-slate-800">
        <div className="flex justify-between gap-6 border-b border-slate-200 pb-4">
          <div>
            <p className="text-xl font-bold text-slate-900">{clinic?.brand_name || clinic?.name}</p>
            {clinic?.address && <p className="text-slate-500 max-w-xs">{clinic.address}</p>}
            <p className="text-slate-500">{[clinic?.phone, clinic?.email].filter(Boolean).join(" · ")}</p>
            {clinic?.settings?.gstin && <p className="text-slate-500">GSTIN {clinic.settings.gstin}</p>}
          </div>
          <div className="text-right">
            <p className="text-lg font-bold tracking-wide uppercase text-slate-900">{title}</p>
            <p className="font-mono">{number}</p>
            {meta.map(([k, v]) => <p key={k} className="text-slate-500">{k}: <span className="text-slate-800">{v}</span></p>)}
          </div>
        </div>
        {children}
        {showStamp && clinic?.stamp_url && (
          <div className="mt-6 flex justify-end">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={clinic.stamp_url} alt="Clinic stamp" className="max-h-32 max-w-[10rem] object-contain" />
          </div>
        )}
      </div>
    </div>
  );
}
