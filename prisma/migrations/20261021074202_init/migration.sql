-- CreateEnum
CREATE TYPE "DocumentStatus" AS ENUM ('uploaded', 'extracting', 'needs_review', 'confirmed', 'failed');

-- CreateEnum
CREATE TYPE "DocumentType" AS ENUM ('invoice', 'credit_memo', 'other');

-- CreateEnum
CREATE TYPE "DocumentSource" AS ENUM ('upload', 'seed');

-- CreateEnum
CREATE TYPE "CreditReason" AS ENUM ('pricing_error', 'quantity_error', 'damaged_or_defective', 'duplicate_billing', 'return', 'rebate_or_promo', 'service_failure', 'other');

-- CreateEnum
CREATE TYPE "ReasonSource" AS ENUM ('stated', 'inferred', 'user');

-- CreateEnum
CREATE TYPE "CreditStatus" AS ENUM ('open', 'applied', 'written_off');

-- CreateEnum
CREATE TYPE "LinkMethod" AS ENUM ('reference', 'heuristic', 'manual');

-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Vendor" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Vendor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VendorAlias" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "rawName" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VendorAlias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Document" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "source" "DocumentSource" NOT NULL DEFAULT 'upload',
    "status" "DocumentStatus" NOT NULL DEFAULT 'uploaded',
    "type" "DocumentType",
    "originalFilename" TEXT,
    "mimeType" TEXT,
    "sizeBytes" INTEGER,
    "fileSha256" TEXT,
    "storageKey" TEXT,
    "extractor" TEXT,
    "extractionAttempts" INTEGER NOT NULL DEFAULT 0,
    "extractionStartedAt" TIMESTAMPTZ(3),
    "rawExtraction" JSONB,
    "errorMessage" TEXT,
    "reviewIssues" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "duplicateOfId" TEXT,
    "vendorId" TEXT,
    "vendorNameRaw" TEXT,
    "documentNumber" TEXT,
    "documentNumberNormalized" TEXT,
    "documentDate" DATE,
    "dueDate" DATE,
    "paymentTerms" TEXT,
    "currency" CHAR(3),
    "subtotalCents" INTEGER,
    "taxCents" INTEGER,
    "totalCents" INTEGER,
    "dedupeKey" TEXT,
    "referencedInvoiceNumber" TEXT,
    "statedReason" TEXT,
    "creditReason" "CreditReason",
    "creditReasonSource" "ReasonSource",
    "creditStatus" "CreditStatus",
    "creditStatusChangedAt" TIMESTAMPTZ(3),
    "linkedInvoiceId" TEXT,
    "linkMethod" "LinkMethod",
    "linkCandidateIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "confirmedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LineItem" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION,
    "unitPriceCents" INTEGER,
    "lineTotalCents" INTEGER NOT NULL,

    CONSTRAINT "LineItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_organizationId_idx" ON "User"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "Vendor_organizationId_idx" ON "Vendor"("organizationId");

-- CreateIndex
CREATE INDEX "VendorAlias_vendorId_idx" ON "VendorAlias"("vendorId");

-- CreateIndex
CREATE UNIQUE INDEX "VendorAlias_organizationId_normalizedName_key" ON "VendorAlias"("organizationId", "normalizedName");

-- CreateIndex
CREATE INDEX "Document_organizationId_status_idx" ON "Document"("organizationId", "status");

-- CreateIndex
CREATE INDEX "Document_organizationId_type_documentDate_idx" ON "Document"("organizationId", "type", "documentDate");

-- CreateIndex
CREATE INDEX "Document_organizationId_vendorId_type_idx" ON "Document"("organizationId", "vendorId", "type");

-- CreateIndex
CREATE INDEX "Document_linkedInvoiceId_idx" ON "Document"("linkedInvoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "Document_organizationId_fileSha256_key" ON "Document"("organizationId", "fileSha256");

-- CreateIndex
CREATE UNIQUE INDEX "Document_organizationId_dedupeKey_key" ON "Document"("organizationId", "dedupeKey");

-- CreateIndex
CREATE INDEX "LineItem_documentId_idx" ON "LineItem"("documentId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vendor" ADD CONSTRAINT "Vendor_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorAlias" ADD CONSTRAINT "VendorAlias_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorAlias" ADD CONSTRAINT "VendorAlias_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_linkedInvoiceId_fkey" FOREIGN KEY ("linkedInvoiceId") REFERENCES "Document"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LineItem" ADD CONSTRAINT "LineItem_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LineItem" ADD CONSTRAINT "LineItem_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;
