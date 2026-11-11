import { NextResponse } from "next/server";
import { currentUser } from "@/lib/workspace";
import { createUploadedDocument, type UploadResult } from "@/lib/server/documents";
import { kickExtraction } from "@/lib/server/queue";

// POST multipart/form-data with one or more "file" fields. Responds right away;
// extraction runs in the background and the client polls /api/documents/status.
export async function POST(request: Request) {
  const session = await currentUser();

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
        await createUploadedDocument(
          session.organizationId,
          { name: file.name, type: file.type, bytes: new Uint8Array(await file.arrayBuffer()) },
          { type: "user", userId: session.userId, name: session.name },
        ),
      );
    } catch (error) {
      console.error("[upload] failed", file.name, error);
      results.push({ ok: false, filename: file.name, error: "Couldn't store this file." });
    }
  }

  // New rows are the queue: wake the workers and return.
  if (results.some((r) => r.ok && !r.duplicate)) kickExtraction();
  return NextResponse.json({ results });
}
