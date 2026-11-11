-- The app no longer has sign-in: sessions and password hashes go away.

-- DropForeignKey
ALTER TABLE "Session" DROP CONSTRAINT "Session_organizationId_fkey";

-- DropForeignKey
ALTER TABLE "Session" DROP CONSTRAINT "Session_userId_fkey";

-- AlterTable
ALTER TABLE "User" DROP COLUMN "passwordHash";

-- DropTable
DROP TABLE "Session";
