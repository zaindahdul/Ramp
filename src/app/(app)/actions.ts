"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { CREDIT_STATUSES, type ConfirmInput } from "@/lib/confirm";
import { CREDIT_REASONS } from "@/lib/reasons";
import {
  confirmAllClean,
  confirmDocument,
  deleteDocument,
  retryExtraction,
  setCreditReason,
  setCreditStatus,
  type ConfirmResult,
} from "@/lib/server/documents";
import { setCreditLink } from "@/lib/server/linking";
import { mergeVendors } from "@/lib/server/vendors";

// Every action resolves the organization from the session, never from input.

export type ActionResult = { ok: true; message?: string } | { ok: false; error: string };

const Id = z.string().min(1).max(64);

function refreshAll() {
  revalidatePath("/", "layout");
}

async function run(fn: () => Promise<string | void>): Promise<ActionResult> {
  try {
    const message = await fn();
    refreshAll();
    return { ok: true, message: message ?? undefined };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Something went wrong." };
  }
}

export async function confirmDocumentAction(documentId: string, input: ConfirmInput): Promise<ConfirmResult> {
  const { organizationId } = await requireSession();
  const result = await confirmDocument(organizationId, Id.parse(documentId), input);
  if (result.ok) refreshAll();
  return result;
}

export async function confirmAllCleanAction(): Promise<ActionResult> {
  const { organizationId } = await requireSession();
  return run(async () => {
    const { confirmed, failed } = await confirmAllClean(organizationId);
    return failed > 0
      ? `Confirmed ${confirmed}. ${failed} need a closer look.`
      : `Confirmed ${confirmed} document${confirmed === 1 ? "" : "s"}.`;
  });
}

export async function setCreditStatusAction(documentId: string, status: string): Promise<ActionResult> {
  const { organizationId } = await requireSession();
  return run(() => setCreditStatus(organizationId, Id.parse(documentId), z.enum(CREDIT_STATUSES).parse(status)));
}

export async function setCreditReasonAction(documentId: string, reason: string): Promise<ActionResult> {
  const { organizationId } = await requireSession();
  return run(() => setCreditReason(organizationId, Id.parse(documentId), z.enum(CREDIT_REASONS).parse(reason)));
}

export async function setCreditLinkAction(documentId: string, choice: string): Promise<ActionResult> {
  const { organizationId } = await requireSession();
  return run(() => setCreditLink(organizationId, Id.parse(documentId), Id.parse(choice)));
}

export async function retryExtractionAction(documentId: string): Promise<ActionResult> {
  const { organizationId } = await requireSession();
  return run(() => retryExtraction(organizationId, Id.parse(documentId)));
}

export async function deleteDocumentAction(documentId: string): Promise<void> {
  const { organizationId } = await requireSession();
  await deleteDocument(organizationId, Id.parse(documentId));
  refreshAll();
  redirect("/documents");
}

export async function mergeVendorsAction(sourceId: string, targetId: string): Promise<ActionResult> {
  const { organizationId } = await requireSession();
  const result = await run(() => mergeVendors(organizationId, Id.parse(sourceId), Id.parse(targetId)));
  if (result.ok) redirect(`/vendors/${targetId}`);
  return result;
}
