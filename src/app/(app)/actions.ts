"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { currentUser, type CurrentUser } from "@/lib/workspace";
import { AUTONOMY_LEVELS } from "@/lib/autonomy";
import { CREDIT_STATUSES, type ConfirmInput } from "@/lib/confirm";
import {
  confirmAllClean,
  confirmDocument,
  deleteDocument,
  retryExtraction,
  setCreditStatus,
  type ConfirmResult,
} from "@/lib/server/documents";
import type { Actor } from "@/lib/server/audit";
import { setCreditLink } from "@/lib/server/linking";
import { updateAutonomy } from "@/lib/server/settings";
import { mergeVendors } from "@/lib/server/vendors";

// Every action resolves the organization from the current user, never from input.

export type ActionResult = { ok: true; message?: string } | { ok: false; error: string };

const Id = z.string().min(1).max(64);

/** The person using the app, as the actor recorded on every change they make. */
function actorOf(session: CurrentUser): Actor {
  return { type: "user", userId: session.userId, name: session.name };
}

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
  const session = await currentUser();
  const result = await confirmDocument(session.organizationId, Id.parse(documentId), input, {
    actor: actorOf(session),
    via: "review",
  });
  if (result.ok) refreshAll();
  return result;
}

export async function confirmAllCleanAction(): Promise<ActionResult> {
  const session = await currentUser();
  return run(async () => {
    const { confirmed, failed } = await confirmAllClean(session.organizationId, actorOf(session));
    return failed > 0
      ? `Confirmed ${confirmed}. ${failed} need a closer look.`
      : `Confirmed ${confirmed} document${confirmed === 1 ? "" : "s"}.`;
  });
}

export async function setCreditStatusAction(documentId: string, status: string): Promise<ActionResult> {
  const session = await currentUser();
  return run(() =>
    setCreditStatus(session.organizationId, Id.parse(documentId), z.enum(CREDIT_STATUSES).parse(status), actorOf(session)),
  );
}

export async function setCreditLinkAction(documentId: string, choice: string): Promise<ActionResult> {
  const session = await currentUser();
  return run(() => setCreditLink(session.organizationId, Id.parse(documentId), Id.parse(choice), actorOf(session)));
}

export async function retryExtractionAction(documentId: string): Promise<ActionResult> {
  const session = await currentUser();
  return run(() => retryExtraction(session.organizationId, Id.parse(documentId), actorOf(session)));
}

export async function deleteDocumentAction(documentId: string): Promise<void> {
  const session = await currentUser();
  await deleteDocument(session.organizationId, Id.parse(documentId), actorOf(session));
  refreshAll();
  redirect("/documents");
}

export async function mergeVendorsAction(sourceId: string, targetId: string): Promise<ActionResult> {
  const session = await currentUser();
  const result = await run(() =>
    mergeVendors(session.organizationId, Id.parse(sourceId), Id.parse(targetId), actorOf(session)),
  );
  if (result.ok) redirect(`/vendors/${targetId}`);
  return result;
}

const AutonomyInput = z.object({
  level: z.enum(AUTONOMY_LEVELS),
  /** The limit as typed, in major units of the limit currency. */
  limit: z.string().max(20),
});

export async function updateAutonomyAction(input: { level: string; limit: string }): Promise<ActionResult> {
  const session = await currentUser();
  const parsed = AutonomyInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Pick one of the autonomy levels." };
  return run(() => updateAutonomy(session.organizationId, parsed.data, actorOf(session)));
}
