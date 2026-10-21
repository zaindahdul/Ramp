import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { recoverStuckDocuments } from "@/lib/server/queue";

export interface DocumentStatusDto {
  id: string;
  status: "uploaded" | "extracting" | "needs_review" | "confirmed" | "failed";
  type: "invoice" | "credit_memo" | "other" | null;
  vendorName: string | null;
  documentNumber: string | null;
  totalCents: number | null;
  currency: string | null;
  errorMessage: string | null;
  issueCount: number;
}

// GET ?ids=a,b,c -> current status of those documents (polled by the upload page).
export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const ids = (new URL(request.url).searchParams.get("ids") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 200);

  // Polling doubles as the recovery hook for jobs lost to a server restart.
  await recoverStuckDocuments(session.organizationId);

  const docs = await db.document.findMany({
    where: { organizationId: session.organizationId, id: { in: ids } },
    select: {
      id: true,
      status: true,
      type: true,
      vendorNameRaw: true,
      documentNumber: true,
      totalCents: true,
      currency: true,
      errorMessage: true,
      reviewIssues: true,
      vendor: { select: { name: true } },
    },
  });
  const body: DocumentStatusDto[] = docs.map((d) => ({
    id: d.id,
    status: d.status,
    type: d.type,
    vendorName: d.vendor?.name ?? d.vendorNameRaw,
    documentNumber: d.documentNumber,
    totalCents: d.totalCents,
    currency: d.currency,
    errorMessage: d.errorMessage,
    issueCount: d.reviewIssues.length,
  }));
  return NextResponse.json({ documents: body });
}
