-- CreateEnum
CREATE TYPE "AiCallStatus" AS ENUM ('SUCCESS', 'ERROR');

-- CreateTable
CREATE TABLE "AiInteraction" (
    "id" TEXT NOT NULL,
    "feature" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "systemPrompt" TEXT,
    "userPrompt" TEXT NOT NULL,
    "response" TEXT,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "latencyMs" INTEGER NOT NULL,
    "status" "AiCallStatus" NOT NULL,
    "error" TEXT,
    "userId" TEXT,
    "projectId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiInteraction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AiInteraction_feature_createdAt_idx" ON "AiInteraction"("feature", "createdAt");
