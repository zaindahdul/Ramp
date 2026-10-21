import type { Metadata } from "next";
import { Uploader } from "@/app/(app)/upload/uploader";
import { isMockMode } from "@/lib/env";

export const metadata: Metadata = { title: "Upload" };

export default function UploadPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Upload documents</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Each file is read in the background: we classify it as an invoice or credit memo, pull out the vendor, amounts
          and line items, then send it to review. Uploading the same file twice, or a second copy of a document already
          on file, won&apos;t create a duplicate record.
          {isMockMode() && " The PDFs in /samples extract exactly in mock mode; other files get made-up data."}
        </p>
      </div>
      <Uploader />
    </div>
  );
}
