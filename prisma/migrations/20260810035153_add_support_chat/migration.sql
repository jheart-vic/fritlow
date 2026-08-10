-- CreateEnum
CREATE TYPE "SupportStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "SupportSenderType" AS ENUM ('USER', 'STAFF');

-- CreateTable
CREATE TABLE "SupportConversation" (
    "id" TEXT NOT NULL,
    "subject" TEXT,
    "status" "SupportStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userLastReadAt" TIMESTAMP(3),
    "staffLastReadAt" TIMESTAMP(3),
    "customerId" TEXT NOT NULL,
    "assignedAdminId" TEXT,

    CONSTRAINT "SupportConversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupportMessage" (
    "id" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "senderType" "SupportSenderType" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "conversationId" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,

    CONSTRAINT "SupportMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SupportConversation_customerId_idx" ON "SupportConversation"("customerId");

-- CreateIndex
CREATE INDEX "SupportConversation_status_lastMessageAt_idx" ON "SupportConversation"("status", "lastMessageAt");

-- CreateIndex
CREATE INDEX "SupportMessage_conversationId_idx" ON "SupportMessage"("conversationId");

-- AddForeignKey
ALTER TABLE "SupportConversation" ADD CONSTRAINT "SupportConversation_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportConversation" ADD CONSTRAINT "SupportConversation_assignedAdminId_fkey" FOREIGN KEY ("assignedAdminId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportMessage" ADD CONSTRAINT "SupportMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "SupportConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportMessage" ADD CONSTRAINT "SupportMessage_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
