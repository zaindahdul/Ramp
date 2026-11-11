import type { Metadata } from "next";
import Link from "next/link";
import { Uploader } from "@/app/(app)/upload/uploader";
import { PageHeader } from "@/components/page-header";
import { currentUser } from "@/lib/workspace";
import { AUTONOMY_LABELS } from "@/lib/autonomy";
import { isMockMode } from "@/lib/env";
import { formatCents } from "@/lib/money";
import { getAutonomy } from "@/lib/server/settings";

export const metadata: Metadata = { title: "Upload" };

const STEPS = [
  ["Read", "Each file is read once: type, vendor, amounts, line items, and the text each value came from."],
  ["Check", "Plain code checks the reading: required fields, arithmetic, quoted sources, duplicates."],
  ["Decide", "Clean documents within your autonomy setting confirm themselves. The rest wait for you."],
] as const;

export default async function UploadPage() {
  const { organizationId } = await currentUser();
  const autonomy = await getAutonomy(organizationId);
  const setting =
    autonomy.level === "auto_within_limit"
      ? `${AUTONOMY_LABELS[autonomy.level].name}, up to ${formatCents(autonomy.limitCents, autonomy.currency)}`
      : AUTONOMY_LABELS[autonomy.level].name;

  return (
    <div className="space-y-8">
      <PageHeader
        title="Upload documents"
        description={
          <>
            Drop invoices and credit memos. The same file twice, or a second copy of a document already on file, never
            creates a duplicate.
            {isMockMode() && " In mock mode the PDFs in /samples are read exactly; other files get made-up data."}
          </>
        }
      />
      <Uploader />
      <ol className="grid gap-x-8 gap-y-4 border-t pt-6 sm:grid-cols-3">
        {STEPS.map(([title, text], i) => (
          <li key={title}>
            <p className="eyebrow">
              {String(i + 1).padStart(2, "0")} · {title}
            </p>
            <p className="mt-1.5 text-sm leading-5 text-muted-foreground">{text}</p>
          </li>
        ))}
      </ol>
      <p className="text-sm text-muted-foreground">
        Autonomy is set to <span className="text-foreground">{setting}</span>.{" "}
        <Link href="/settings" className="underline underline-offset-4 hover:text-foreground">
          Change
        </Link>
      </p>
    </div>
  );
}
