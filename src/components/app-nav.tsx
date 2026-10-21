"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const LINKS = [
  { href: "/", label: "Open credits", match: (p: string) => p === "/" },
  { href: "/upload", label: "Upload", match: (p: string) => p.startsWith("/upload") },
  { href: "/documents", label: "Documents", match: (p: string) => p.startsWith("/documents") },
  { href: "/vendors", label: "Vendor scorecard", match: (p: string) => p.startsWith("/vendors") },
] as const;

export function AppNav({ reviewCount }: { reviewCount: number }) {
  const pathname = usePathname();
  return (
    <nav className="flex items-center gap-1 overflow-x-auto text-sm">
      {LINKS.map((link) => (
        <Link
          key={link.href}
          href={link.href}
          className={cn(
            "rounded-md px-3 py-1.5 whitespace-nowrap text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
            link.match(pathname) && "bg-muted font-medium text-foreground",
          )}
        >
          {link.label}
          {link.href === "/documents" && reviewCount > 0 && (
            <span className="ml-1.5 rounded-full bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-900 tabular-nums">
              {reviewCount}
            </span>
          )}
        </Link>
      ))}
    </nav>
  );
}
