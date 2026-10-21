import type { Prisma } from "@/generated/prisma/client";
import { db, isUniqueViolation } from "@/lib/db";
import { dedupeKey, vendorKeyFor } from "@/lib/dedupe";
import { displayVendorName, normalizeVendorName } from "@/lib/vendors/normalize";

type Tx = Prisma.TransactionClient;

export async function findVendorByName(
  organizationId: string,
  rawName: string,
  tx: Tx = db,
): Promise<{ id: string; name: string } | null> {
  const normalizedName = normalizeVendorName(rawName);
  if (!normalizedName) return null;
  const alias = await tx.vendorAlias.findUnique({
    where: { organizationId_normalizedName: { organizationId, normalizedName } },
    include: { vendor: { select: { id: true, name: true } } },
  });
  return alias?.vendor ?? null;
}

/** Matches loosely on name; creates the vendor (and its alias) when new. */
export async function findOrCreateVendor(organizationId: string, rawName: string, tx: Tx = db): Promise<string> {
  const existing = await findVendorByName(organizationId, rawName, tx);
  if (existing) return existing.id;
  const normalizedName = normalizeVendorName(rawName);
  if (!normalizedName) throw new Error("Vendor name is empty after normalization");
  try {
    const vendor = await tx.vendor.create({
      data: {
        organizationId,
        name: displayVendorName(rawName),
        aliases: { create: { organizationId, normalizedName, rawName } },
      },
    });
    return vendor.id;
  } catch (error) {
    // Another request created it first.
    if (isUniqueViolation(error)) {
      const raced = await findVendorByName(organizationId, rawName, tx);
      if (raced) return raced.id;
    }
    throw error;
  }
}

/**
 * Folds `sourceId` into `targetId`: documents and name aliases move over and the
 * source vendor is deleted. Records that become duplicates of each other keep
 * existing, but only the first keeps the duplicate key, and the second is flagged.
 */
export async function mergeVendors(organizationId: string, sourceId: string, targetId: string): Promise<void> {
  if (sourceId === targetId) throw new Error("Pick a different vendor to merge into.");
  await db.$transaction(async (tx) => {
    const vendors = await tx.vendor.findMany({
      where: { organizationId, id: { in: [sourceId, targetId] } },
      select: { id: true },
    });
    if (vendors.length !== 2) throw new Error("Vendor not found.");

    const moved = await tx.document.findMany({
      where: { organizationId, vendorId: sourceId },
      select: { id: true, documentNumber: true, currency: true, totalCents: true, dedupeKey: true },
    });
    await tx.document.updateMany({
      where: { organizationId, vendorId: sourceId },
      data: { vendorId: targetId, dedupeKey: null },
    });
    for (const doc of moved) {
      if (!doc.dedupeKey) continue;
      const key = dedupeKey({
        vendorKey: vendorKeyFor(targetId, null),
        documentNumber: doc.documentNumber,
        currency: doc.currency,
        totalCents: doc.totalCents,
      });
      const clash = key
        ? await tx.document.findFirst({ where: { organizationId, dedupeKey: key }, select: { id: true } })
        : null;
      if (clash) {
        await tx.document.update({
          where: { id: doc.id },
          data: {
            duplicateOfId: clash.id,
            reviewIssues: { push: "Possible duplicate of another document after a vendor merge." },
          },
        });
      } else if (key) {
        await tx.document.update({ where: { id: doc.id }, data: { dedupeKey: key } });
      }
    }
    await tx.vendorAlias.updateMany({ where: { organizationId, vendorId: sourceId }, data: { vendorId: targetId } });
    await tx.vendor.delete({ where: { id: sourceId } });
  });
}
