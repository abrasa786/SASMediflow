"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/builder", label: "Build with AI", admin: true },
  { href: "/builder/data", label: "Data" },
  { href: "/builder/reports", label: "Reports & dashboards" },
  { href: "/builder/access", label: "Access control", admin: true },
];

export default function BuilderTabs({ isAdmin }: { isAdmin: boolean }) {
  const path = usePathname();
  return (
    <nav className="flex gap-1 border-b border-slate-200 mb-6 overflow-x-auto" aria-label="Builder sections">
      {TABS.filter((t) => isAdmin || !t.admin).map((t) => (
        <Link key={t.href} href={t.href} aria-current={path === t.href ? "page" : undefined}
          className={`px-4 py-2.5 text-sm font-medium whitespace-nowrap -mb-px border-b-2 ${path === t.href ? "border-sky-600 text-sky-700" : "border-transparent text-slate-500 hover:text-slate-800"}`}>{t.label}</Link>
      ))}
    </nav>
  );
}
