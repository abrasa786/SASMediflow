"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { getActiveClinicId } from "@/lib/auth";
import { PIN_TARGETS, type PinTarget } from "@/lib/builder/pins";

interface Tab extends PinTarget { key: string }
/** The five main tabs. Each has its own "New" button and a List view. */
const MAIN: Tab[] = [
  { key: "home", label: "Home", href: "/dashboard", newHref: "/appointments?new=1" },
  { key: "patients", label: "Patients", href: "/patients", newHref: "/patients?new=1", listHref: "/lists/patients" },
  { key: "appointments", label: "Appointments", href: "/appointments", newHref: "/appointments?new=1", listHref: "/lists/appointments" },
  { key: "treatments", label: "Treatments", href: "/treatments", newHref: "/treatments?new=1", listHref: "/lists/treatments" },
  { key: "sittings", label: "Sittings", href: "/sittings", newHref: "/sittings?new=1", listHref: "/lists/sittings" },
  { key: "billing", label: "Billing", href: "/billing", newHref: "/billing?new=1", listHref: "/lists/invoices" },
];

/** Horizontal main tabs (like a Salesforce app's tab bar). Tabs the admin pinned with the Builder are added after the five. */
export default function TopTabs() {
  const pathname = usePathname();
  const [pins, setPins] = useState<Tab[]>([]);
  const [apps, setApps] = useState<{ api_name: string; label: string }[]>([]);

  useEffect(() => {
    const id = getActiveClinicId(); if (!id) return;
    const read = () => {
      (supabase as any).from("clinics").select("settings").eq("id", id).maybeSingle().then((r: any) => {
        const keys: string[] = Array.isArray(r.data?.settings?.main_tabs) ? r.data.settings.main_tabs : [];
        let appList = apps;
        try { const c = JSON.parse(sessionStorage.getItem("mf_apps_" + id) ?? "null"); if (c?.apps) { appList = c.apps; setApps(c.apps); } } catch { /* optional */ }
        setPins(keys.map((k): Tab | null => {
          if (PIN_TARGETS[k]) return { key: k, ...PIN_TARGETS[k] };
          if (k.startsWith("app:")) { const a = appList.find((x) => x.api_name === k.slice(4)); return a ? { key: k, label: a.label, href: `/apps/${a.api_name}` } : null; }
          return null;
        }).filter(Boolean) as Tab[]);
      });
    };
    read();
    window.addEventListener("mf:apps-changed", read);
    return () => window.removeEventListener("mf:apps-changed", read);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const tabs = [...MAIN, ...pins];
  const active = [...tabs].sort((a, b) => b.href.length - a.href.length).find((t) => (t.href === "/dashboard" ? pathname === "/dashboard" : pathname === t.href || pathname.startsWith(t.href + "/")));
  const cur = active ?? null;
  const newHref = cur?.newHref;
  const newLabel = cur?.key === "home" ? "New booking" : "New";

  return (
    <div className="flex items-center gap-2 min-w-0 flex-1">
      <nav aria-label="Main tabs" className="flex-1 min-w-0 overflow-x-auto overscroll-x-contain [scrollbar-width:thin]">
        <ul className="flex items-stretch gap-1 w-max">
          {tabs.map((t) => (
            <li key={t.key}>
              <Link href={t.href} aria-current={cur?.key === t.key ? "page" : undefined}
                className={`block px-3.5 py-2 rounded-lg text-sm font-medium whitespace-nowrap ${cur?.key === t.key ? "bg-white/15 text-white" : "text-slate-300 hover:bg-white/10 hover:text-white"}`}>{t.label}</Link>
            </li>
          ))}
        </ul>
      </nav>
      <div className="flex items-center gap-1.5 shrink-0">
        {cur?.listHref && <Link href={cur.listHref} aria-label="List view" title="List view" className="px-2.5 sm:px-3 py-1.5 rounded-lg text-sm font-medium text-slate-200 border border-white/20 hover:bg-white/10 whitespace-nowrap"><span aria-hidden className="sm:hidden">≣</span><span className="hidden sm:inline">List view</span></Link>}
        {newHref && <Link href={newHref} className="px-3 py-1.5 rounded-lg text-sm font-semibold bg-sky-500 hover:bg-sky-400 text-white whitespace-nowrap"><span aria-hidden>+ </span>{newLabel}</Link>}
      </div>
    </div>
  );
}
