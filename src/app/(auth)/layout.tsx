export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <main className="flex min-h-svh flex-col items-center justify-center bg-muted/40 px-4 py-12">
      <div className="mb-8 text-center">
        <p className="text-sm font-medium tracking-wide text-muted-foreground uppercase">AP Credit Recovery</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Find the money vendors still owe you</h1>
      </div>
      <div className="w-full max-w-sm">{children}</div>
    </main>
  );
}
