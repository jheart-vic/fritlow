-- Reshape Recommendation to match the frontend build spec.
-- The table is empty (test data cleaned), so drop + recreate rather than
-- wrestle Postgres enum-value alterations.

-- DropForeignKey / DropTable
DROP TABLE "Recommendation";

-- DropEnum (old shape)
DROP TYPE "RecommendationSeverity";
DROP TYPE "RecommendationStatus";

-- CreateEnum (new shape)
CREATE TYPE "RecommendationType" AS ENUM ('PRICING', 'SCOPE', 'AUDIENCE', 'ONBOARDING', 'GENERAL');

-- CreateEnum
CREATE TYPE "RecommendationSeverity" AS ENUM ('INFO', 'WARNING', 'CRITICAL');

-- CreateEnum
CREATE TYPE "RecommendationStatus" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'DISMISSED', 'RESOLVED');

-- CreateTable
CREATE TABLE "Recommendation" (
    "id" TEXT NOT NULL,
    "type" "RecommendationType" NOT NULL DEFAULT 'GENERAL',
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "severity" "RecommendationSeverity" NOT NULL DEFAULT 'WARNING',
    "status" "RecommendationStatus" NOT NULL DEFAULT 'OPEN',
    "sourceContext" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "projectId" TEXT NOT NULL,

    CONSTRAINT "Recommendation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Recommendation_projectId_idx" ON "Recommendation"("projectId");

-- AddForeignKey
ALTER TABLE "Recommendation" ADD CONSTRAINT "Recommendation_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
