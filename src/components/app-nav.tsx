"use client";

import { ActivityIcon, FileTextIcon, LayoutGridIcon, SlidersHorizontalIcon, StoreIcon, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

interface NavLink {
  href: string;
  label: string;
  Icon: LucideIcon;
  match: (path: string) => boolean;
}

const WORK: NavLink[] = [
  { href: "/", label: "Overview", Icon: LayoutGridIcon, match: (p) => p === "/" },
  { href: "/documents", label: "Documents", Icon: FileTextIcon, match: (p) => p.startsWith("/documents") || p.startsWith("/upload") },
  { href: "/vendors", label: "Vendors", Icon: StoreIcon, match: (p) => p.startsWith("/vendors") },
];

const CONTROL: NavLink[] = [
  { href: "/activity", label: "Activity", Icon: ActivityIcon, match: (p) => p.startsWith("/activity") },
  { href: "/settings", label: "Autonomy", Icon: SlidersHorizontalIcon, match: (p) => p.startsWith("/settings") },
];

function Item({ link, active, badge }: { link: NavLink; active: boolean; badge?: number }) {
  return (
    <Link
      href={link.href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex h-8 shrink-0 items-center gap-2.5 rounded-lg px-2.5 text-sm whitespace-nowrap text-ink/70 transition-colors hover:bg-sidebar-accent hover:text-ink",
        active && "bg-sidebar-accent text-ink",
      )}
    >
      <link.Icon className="size-4 shrink-0" strokeWidth={1.75} />
      {link.label}
      {badge !== undefined && badge > 0 && (
        <span
          className="ml-auto rounded-full bg-solar px-1.5 text-[11px] leading-[18px] font-medium text-ink tabular-nums"
          aria-label={`${badge} waiting for review`}
        >
          {badge}
        </span>
      )}
    </Link>
  );
}

export function AppNav({ reviewCount }: { reviewCount: number }) {
  const pathname = usePathname();
  return (
    <nav className="flex gap-1 overflow-x-auto lg:flex-col lg:overflow-visible" aria-label="Main">
      {WORK.map((link) => (
        <Item key={link.href} link={link} active={link.match(pathname)} badge={link.href === "/documents" ? reviewCount : undefined} />
      ))}
      <p className="eyebrow mt-6 mb-1 hidden px-2.5 lg:block">Controls</p>
      {CONTROL.map((link) => (
        <Item key={link.href} link={link} active={link.match(pathname)} />
      ))}
    </nav>
  );
}
