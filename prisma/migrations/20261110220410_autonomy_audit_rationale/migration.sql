-- CreateEnum
CREATE TYPE "AutonomyLevel" AS ENUM ('review_all', 'auto_within_limit', 'auto_clean');

-- CreateEnum
CREATE TYPE "ConfirmedVia" AS ENUM ('review', 'bulk', 'autopilot', 'seed');

-- CreateEnum
CREATE TYPE "ActorType" AS ENUM ('user', 'system');

-- AlterTable
ALTER TABLE "Document" ADD COLUMN     "confirmedVia" "ConfirmedVia",
ADD COLUMN     "creditReasonBasis" TEXT,
ADD COLUMN     "linkRationale" TEXT;

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "autoConfirmCurrency" CHAR(3) NOT NULL DEFAULT 'USD',
ADD COLUMN     "autoConfirmLimitCents" INTEGER NOT NULL DEFAULT 50000,
ADD COLUMN     "autonomyLevel" "AutonomyLevel" NOT NULL DEFAULT 'review_all';

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "documentId" TEXT,
    "vendorId" TEXT,
    "actorType" "ActorType" NOT NULL,
    "actorUserId" TEXT,
    "actorName" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "detail" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AuditEvent_organizationId_createdAt_idx" ON "AuditEvent"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditEvent_documentId_createdAt_idx" ON "AuditEvent"("documentId", "createdAt");

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
