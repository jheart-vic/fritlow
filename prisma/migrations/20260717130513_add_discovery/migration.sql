-- CreateEnum
CREATE TYPE "DiscoveryStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'ABANDONED');

-- CreateTable
CREATE TABLE "DiscoverySession" (
    "id" TEXT NOT NULL,
    "status" "DiscoveryStatus" NOT NULL DEFAULT 'ACTIVE',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "projectId" TEXT NOT NULL,

    CONSTRAINT "DiscoverySession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DiscoveryAnswer" (
    "id" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "questionText" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "answer" JSONB NOT NULL,
    "answeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sessionId" TEXT NOT NULL,

    CONSTRAINT "DiscoveryAnswer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DiscoverySession_projectId_key" ON "DiscoverySession"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "DiscoveryAnswer_sessionId_questionId_key" ON "DiscoveryAnswer"("sessionId", "questionId");

-- AddForeignKey
ALTER TABLE "DiscoverySession" ADD CONSTRAINT "DiscoverySession_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscoveryAnswer" ADD CONSTRAINT "DiscoveryAnswer_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "DiscoverySession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
