import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";

// The audit trail. Every change to a record goes through recordEvent with the
// actor that made it: a person, or a named part of the system. Events
// are append-only; nothing in the app updates or deletes them.

type Tx = Prisma.TransactionClient;

export type Actor =
  | { type: "user"; userId: string; name: string }
  | { type: "system"; name: string };

export const EXTRACTION: Actor = { type: "system", name: "Extraction" };
export const LINKER: Actor = { type: "system", name: "Linker" };
export const AUTOPILOT: Actor = { type: "system", name: "Autopilot" };

export type AuditAction =
  | "document.uploaded"
  | "document.extracted"
  | "document.extraction_failed"
  | "document.duplicate"
  | "document.held"
  | "document.confirmed"
  | "document.edited"
  | "document.reextract_requested"
  | "document.deleted"
  | "credit.linked"
  | "credit.link_ambiguous"
  | "credit.link_none"
  | "credit.unlinked"
  | "credit.status_changed"
  | "vendor.created"
  | "vendor.merged"
  | "settings.autonomy_changed";

export interface AuditInput {
  organizationId: string;
  actor: Actor;
  action: AuditAction;
  summary: string;
  documentId?: string | null;
  vendorId?: string | null;
  detail?: Prisma.InputJsonValue;
}

function toRow(input: AuditInput): Prisma.AuditEventCreateManyInput {
  return {
    organizationId: input.organizationId,
    documentId: input.documentId ?? null,
    vendorId: input.vendorId ?? null,
    actorType: input.actor.type,
    actorUserId: input.actor.type === "user" ? input.actor.userId : null,
    actorName: input.actor.name,
    action: input.action,
    summary: input.summary.slice(0, 1000),
    detail: input.detail,
  };
}

export async function recordEvent(input: AuditInput, tx: Tx = db): Promise<void> {
  await tx.auditEvent.create({ data: toRow(input) });
}

export async function recordEvents(inputs: AuditInput[], tx: Tx = db): Promise<void> {
  if (inputs.length > 0) await tx.auditEvent.createMany({ data: inputs.map(toRow) });
}

export interface ActivityRow {
  id: string;
  createdAt: Date;
  actorType: "user" | "system";
  actorName: string;
  action: string;
  summary: string;
  detail: unknown;
  document: { id: string; label: string } | null;
  vendor: { id: string; name: string } | null;
}

const activitySelect = {
  id: true,
  createdAt: true,
  actorType: true,
  actorName: true,
  action: true,
  summary: true,
  detail: true,
  document: { select: { id: true, documentNumber: true, originalFilename: true } },
  vendor: { select: { id: true, name: true } },
} as const;

type ActivityRecord = Prisma.AuditEventGetPayload<{ select: typeof activitySelect }>;

function toActivityRow(e: ActivityRecord): ActivityRow {
  return {
    id: e.id,
    createdAt: e.createdAt,
    actorType: e.actorType,
    actorName: e.actorName,
    action: e.action,
    summary: e.summary,
    detail: e.detail,
    document: e.document
      ? { id: e.document.id, label: e.document.documentNumber ?? e.document.originalFilename ?? "Document" }
      : null,
    vendor: e.vendor,
  };
}

/** Newest first. Scoped to one document when `documentId` is given. */
export async function getActivity(
  organizationId: string,
  options: { documentId?: string; actorType?: "user" | "system"; actorName?: string; take?: number; skip?: number } = {},
): Promise<ActivityRow[]> {
  const rows = await db.auditEvent.findMany({
    where: {
      organizationId,
      documentId: options.documentId,
      actorType: options.actorType,
      actorName: options.actorName,
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: options.take ?? 100,
    skip: options.skip,
    select: activitySelect,
  });
  return rows.map(toActivityRow);
}
