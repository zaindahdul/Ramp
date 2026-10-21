import { FlaskConicalIcon, LogOutIcon } from "lucide-react";
import Link from "next/link";
import { logout } from "@/app/(auth)/actions";
import { AppNav } from "@/components/app-nav";
import { Button } from "@/components/ui/button";
import { requireSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { env, isMockMode } from "@/lib/env";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const session = await requireSession();
  const reviewCount = await db.document.count({
    where: { organizationId: session.organizationId, status: "needs_review" },
  });

  return (
    <div className="flex min-h-svh flex-col">
      <header className="border-b bg-background print:hidden">
        <div className="mx-auto flex h-14 w-full max-w-7xl items-center gap-4 px-4 sm:px-6">
          <Link href="/" className="shrink-0 font-semibold tracking-tight">
            Credit Recovery
          </Link>
          <AppNav reviewCount={reviewCount} />
          <div className="ml-auto flex shrink-0 items-center gap-3">
            <div className="hidden text-right text-xs leading-tight md:block">
              <div className="font-medium">{session.organizationName}</div>
              <div className="text-muted-foreground">{session.email}</div>
            </div>
            <form action={logout}>
              <Button variant="ghost" size="sm" type="submit">
                <LogOutIcon />
                Sign out
              </Button>
            </form>
          </div>
        </div>
      </header>
      {isMockMode() && (
        <div className="border-b border-amber-200 bg-amber-50 text-amber-950 print:hidden">
          <div className="mx-auto flex w-full max-w-7xl items-center gap-2 px-4 py-2 text-sm sm:px-6">
            <FlaskConicalIcon className="size-4 shrink-0" />
            <span>
              <strong className="font-medium">Mock extraction mode.</strong> ANTHROPIC_API_KEY isn&apos;t set, so
              uploads get simulated extraction data. Set it to extract with {env.ANTHROPIC_MODEL}.
            </span>
          </div>
        </div>
      )}
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-8 sm:px-6 print:max-w-none print:p-0">{children}</main>
    </div>
  );
}
