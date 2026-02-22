-- CreateEnum
CREATE TYPE "MessageRole" AS ENUM ('SYSTEM', 'USER', 'ASSISTANT', 'TOOL');

-- CreateEnum
CREATE TYPE "Verbosity" AS ENUM ('CONCISE', 'NORMAL', 'DETAILED');

-- CreateTable
CREATE TABLE "Chat" (
  "id" SERIAL NOT NULL,
  "telegramChatId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "currentModel" TEXT NOT NULL DEFAULT 'auto',
  "temperature" DOUBLE PRECISION NOT NULL DEFAULT 0.4,
  "verbosity" "Verbosity" NOT NULL DEFAULT 'NORMAL',
  "stylePrompt" TEXT,
  "summaryText" TEXT,
  "summaryMessageCount" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "Chat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Message" (
  "id" SERIAL NOT NULL,
  "chatId" INTEGER NOT NULL,
  "role" "MessageRole" NOT NULL,
  "content" TEXT NOT NULL,
  "name" TEXT,
  "toolCallId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Memory" (
  "id" SERIAL NOT NULL,
  "chatId" INTEGER NOT NULL,
  "key" TEXT NOT NULL,
  "value" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Memory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatLock" (
  "chatId" INTEGER NOT NULL,
  "owner" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ChatLock_pkey" PRIMARY KEY ("chatId")
);

-- CreateTable
CREATE TABLE "RateLimitEvent" (
  "id" SERIAL NOT NULL,
  "bucketKey" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RateLimitEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Chat_telegramChatId_key" ON "Chat"("telegramChatId");

-- CreateIndex
CREATE INDEX "Message_chatId_createdAt_idx" ON "Message"("chatId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Memory_chatId_key_key" ON "Memory"("chatId", "key");

-- CreateIndex
CREATE INDEX "Memory_chatId_idx" ON "Memory"("chatId");

-- CreateIndex
CREATE INDEX "ChatLock_expiresAt_idx" ON "ChatLock"("expiresAt");

-- CreateIndex
CREATE INDEX "RateLimitEvent_bucketKey_createdAt_idx" ON "RateLimitEvent"("bucketKey", "createdAt");

-- AddForeignKey
ALTER TABLE "Message"
ADD CONSTRAINT "Message_chatId_fkey"
FOREIGN KEY ("chatId")
REFERENCES "Chat"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Memory"
ADD CONSTRAINT "Memory_chatId_fkey"
FOREIGN KEY ("chatId")
REFERENCES "Chat"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatLock"
ADD CONSTRAINT "ChatLock_chatId_fkey"
FOREIGN KEY ("chatId")
REFERENCES "Chat"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;
