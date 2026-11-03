"use client";

import type { ComponentType, SVGProps } from "react";
import {
  ArrowRight, ArrowUp, BadgeCheck, Bot, CalendarCheck, CalendarDays, ChartColumn, Check, ChevronDown, ChevronUp, CircleCheck, CircleX, Clock, ClipboardCheck, ClipboardList, Compass, CreditCard,
  ExternalLink, FileText, FolderTree, Globe, Hammer, Hand, Heart, Hospital, House, Inbox, Link as LinkIcon, Lock, Mail, MapPin, Megaphone, Menu, MessageCircle,
  Package, PartyPopper, Pencil, Phone, Pill, Play, Puzzle, Receipt, Repeat, Rocket, Search, Send, Settings, SquarePen, Stamp, Stethoscope, Tag, Trash, TreePalm,
  TriangleAlert, Truck, UserRound, Users, Video, Wallet, Wrench, X, Zap,
} from "lucide-react";

/** A simple tooth, drawn like the other line icons (the icon set has none). */
function Tooth(p: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="M7.5 3C5 3 3.5 4.9 3.5 7.4c0 2 .8 3.3 1.3 5 .5 1.9.6 4.2 1.2 6.1.4 1.2 1.1 1.9 1.8 1.9 1.4 0 1.4-2.4 1.9-4.2.3-1.1.8-1.8 1.8-1.8s1.5.7 1.8 1.8c.5 1.8.5 4.2 1.9 4.2.7 0 1.4-.7 1.8-1.9.6-1.9.7-4.2 1.2-6.1.5-1.7 1.3-3 1.3-5C20.5 4.9 19 3 16.5 3c-1.6 0-2.7.8-4.5.8S9.1 3 7.5 3Z" />
    </svg>
  );
}

type Cmp = ComponentType<SVGProps<SVGSVGElement> & { size?: number | string; strokeWidth?: number | string }>;

/** Every icon the app uses, by name. One weight and one style everywhere. */
export const ICONS: Record<string, Cmp> = {
  check: Check, "check-circle": CircleCheck, "x-circle": CircleX, x: X, alert: TriangleAlert, calendar: CalendarDays, "calendar-check": CalendarCheck, list: ClipboardList,
  "list-check": ClipboardCheck, hospital: Hospital, receipt: Receipt, bot: Bot, tooth: Tooth as Cmp, puzzle: Puzzle, users: Users, user: UserRound, doctor: Stethoscope,
  file: FileText, pin: MapPin, package: Package, pill: Pill, search: Search, trash: Trash, clock: Clock, chart: ChartColumn, phone: Phone, repeat: Repeat, video: Video,
  stamp: Stamp, rocket: Rocket, card: CreditCard, leave: TreePalm, message: MessageCircle, party: PartyPopper, edit: SquarePen, pencil: Pencil, wallet: Wallet, tools: Wrench,
  glove: Hand, external: ExternalLink, up: ArrowUp, mail: Mail, globe: Globe, link: LinkIcon, compass: Compass, lock: Lock, home: House, settings: Settings,
  megaphone: Megaphone, inbox: Inbox, send: Send, truck: Truck, build: Hammer, tag: Tag, folder: FolderTree, zap: Zap, heart: Heart, menu: Menu, verified: BadgeCheck, play: Play, "arrow-right": ArrowRight, "chevron-down": ChevronDown, "chevron-up": ChevronUp,
};

/** The emoji the app used before, mapped to the icon that replaces it. */
const FROM_EMOJI: Record<string, string> = {
  "✓": "check", "✔": "check", "✅": "check-circle", "❌": "x-circle", "✕": "x", "✖": "x", "⚠": "alert", "📅": "calendar", "🗓": "calendar", "📋": "list", "📃": "list",
  "🏥": "hospital", "🧾": "receipt", "🤖": "bot", "🦷": "tooth", "🧩": "puzzle", "👥": "users", "👤": "user", "🙍": "user", "👨": "doctor", "⚕": "doctor", "🩺": "doctor",
  "📄": "file", "📍": "pin", "📦": "package", "💊": "pill", "🔍": "search", "🔎": "search", "🗑": "trash", "⏰": "clock", "🕘": "clock", "📊": "chart", "📈": "chart",
  "📲": "phone", "📞": "phone", "🔁": "repeat", "📹": "video", "🔏": "stamp", "🚀": "rocket", "💳": "card", "🏖": "leave", "💬": "message", "🎉": "party", "📝": "edit",
  "💰": "wallet", "🧰": "tools", "🧤": "glove", "↗": "external", "↑": "up", "✉": "mail", "📧": "mail", "🌐": "globe", "🔗": "link", "🧭": "compass", "🔒": "lock", "🔐": "lock",
  "🏠": "home", "⚙": "settings", "📣": "megaphone", "📥": "inbox", "📨": "send", "🚚": "truck", "🛠": "build", "🏷": "tag", "🗂": "folder", "⚡": "zap", "✏": "pencil",
  "❤": "heart", "☰": "menu", "🪥": "list-check",
};
const DOT: Record<string, string> = { "🔴": "text-red-500", "🟡": "text-amber-500", "🟢": "text-emerald-500" };

const strip = (s: string) => s.replace(/️/g, "").trim();

/** A line icon by name. Sized with the text around it unless a size is given. Hidden from screen readers (put the meaning in text or aria-label). */
export function Icon({ name, size = "1.15em", className = "", strokeWidth = 1.75 }: { name: string; size?: number | string; className?: string; strokeWidth?: number }) {
  const C = ICONS[name]; if (!C) return null;
  return <C width={size} height={size} strokeWidth={strokeWidth} aria-hidden="true" focusable="false" className={`inline-block shrink-0 align-[-0.2em] ${className}`} />;
}

/** The icon that replaces an emoji. Anything not mapped shows the fallback icon (or nothing), so a stray emoji can never reach the screen. */
export function Ico({ e, size, className = "", fallback }: { e: string; size?: number | string; className?: string; fallback?: string }) {
  const k = strip(e);
  if (DOT[k]) return <span aria-hidden="true" className={`inline-block w-2.5 h-2.5 rounded-full bg-current align-middle ${DOT[k]} ${className}`} />;
  const n = FROM_EMOJI[k] ?? fallback; return n ? <Icon name={n} size={size} className={className} /> : null;
}
