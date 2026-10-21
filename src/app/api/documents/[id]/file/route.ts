import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { getStorage } from "@/lib/storage";

// Streams the original upload for the review screen's viewer.
export async function GET(_request: Request, ctx: RouteContext<"/api/documents/[id]/file">) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const { id } = await ctx.params;

  const doc = await db.document.findFirst({
    where: { id, organizationId: session.organizationId },
    select: { storageKey: true, mimeType: true, originalFilename: true },
  });
  if (!doc?.storageKey || !doc.mimeType) return NextResponse.json({ error: "No file." }, { status: 404 });

  let data: Buffer;
  try {
    data = await getStorage().get(doc.storageKey);
  } catch {
    return NextResponse.json({ error: "The stored file is missing." }, { status: 404 });
  }
  const filename = (doc.originalFilename ?? "document").replace(/["\\\r\n]/g, "_");
  return new NextResponse(new Uint8Array(data), {
    headers: {
      "Content-Type": doc.mimeType,
      "Content-Disposition": `inline; filename="${filename}"`,
      "Cache-Control": "private, max-age=3600",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
