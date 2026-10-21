import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { createUploadedDocument, type UploadResult } from "@/lib/server/documents";
import { enqueueExtraction } from "@/lib/server/queue";

// POST multipart/form-data with one or more "file" fields. Responds right away;
// extraction runs in the background and the client polls /api/documents/status.
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Expected multipart form data." }, { status: 400 });
  }
  const files = form.getAll("file").filter((f): f is File => f instanceof File);
  if (files.length === 0) return NextResponse.json({ error: "No files in the upload." }, { status: 400 });

  const results: UploadResult[] = [];
  for (const file of files) {
    try {
      results.push(
        await createUploadedDocument(session.organizationId, {
          name: file.name,
          type: file.type,
          bytes: new Uint8Array(await file.arrayBuffer()),
        }),
      );
    } catch (error) {
      console.error("[upload] failed", file.name, error);
      results.push({ ok: false, filename: file.name, error: "Couldn't store this file." });
    }
  }

  const fresh = results.flatMap((r) => (r.ok && !r.duplicate ? [r.id] : []));
  if (fresh.length > 0) enqueueExtraction(session.organizationId, fresh);
  return NextResponse.json({ results });
}
