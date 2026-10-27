/** Screens that can be pinned to the main tab bar at the top of the app, and where their "New" and "List view" buttons go. */
export interface PinTarget { label: string; href: string; newHref?: string; listHref?: string }

export const PIN_TARGETS: Record<string, PinTarget> = {
  stock: { label: "Stock", href: "/stock", newHref: "/stock?new=1", listHref: "/lists/stock" },
  tasks: { label: "Tasks", href: "/tasks", listHref: "/lists/tasks" },
  calendar: { label: "Calendar", href: "/calendar" },
  payments: { label: "Payments", href: "/payments" },
  purchasing: { label: "Purchasing", href: "/purchasing" },
  recall: { label: "Recall", href: "/recall" },
  offers: { label: "Offers", href: "/offers" },
  analytics: { label: "Analytics", href: "/analytics" },
  attendance: { label: "Attendance", href: "/attendance" },
  leave: { label: "Leave", href: "/leave" },
  staff: { label: "Staff", href: "/staff" },
  availability: { label: "Availability", href: "/availability" },
  reports: { label: "Reports", href: "/builder/reports" },
  assistant: { label: "AI Assistant", href: "/chatbot" },
};
const ALIASES: Record<string, string> = { inventory: "stock", medicines: "stock", medicine: "stock", pharmacy: "stock", task: "tasks", report: "reports", payment: "payments", orders: "purchasing", purchase: "purchasing", purchases: "purchasing", offer: "offers", doctors: "staff", team: "staff", schedule: "availability", hours: "availability", leaves: "leave" };
export const MAX_PINS = 8;

/** Turn the words an admin used ("stocks", "the calendar", an app name) into something that can be pinned. */
export function resolvePin(text: string, apps: { api_name: string; label: string }[] = []): (PinTarget & { key: string }) | null {
  const t = text.toLowerCase().replace(/\b(the|my|our|a|an|tab|screen|page|section|module|app)\b/g, " ").replace(/[^a-z0-9 ]/g, " ").trim().replace(/\s+/g, " ");
  if (!t) return null;
  const singular = t.endsWith("s") ? t.slice(0, -1) : t;
  const key = PIN_TARGETS[t] ? t : PIN_TARGETS[t + "s"] ? t + "s" : ALIASES[t] ?? ALIASES[singular] ?? (PIN_TARGETS[singular] ? singular : "");
  if (key && PIN_TARGETS[key]) return { key, ...PIN_TARGETS[key] };
  const app = apps.find((a) => a.api_name === t.replace(/ /g, "_") || a.label.toLowerCase() === t || a.label.toLowerCase().replace(/s$/, "") === singular);
  return app ? { key: "app:" + app.api_name, label: app.label, href: `/apps/${app.api_name}` } : null;
}
