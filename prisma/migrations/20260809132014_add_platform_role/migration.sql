-- CreateEnum
CREATE TYPE "PlatformRole" AS ENUM ('USER', 'SUPPORT', 'SUPERADMIN');

-- AlterTable
ALTER TABLE "User" ADD COLUMN "platformRole" "PlatformRole" NOT NULL DEFAULT 'USER';
