-- Opt-in adjustment storage; legacy chapter content and decision fields are preserved.
ALTER TABLE "CreativeDecision" ADD COLUMN "adjustmentJson" TEXT;

CREATE TABLE "WritingSetting" (
  "id" TEXT NOT NULL,
  "novelId" TEXT NOT NULL,
  "scopeKey" TEXT NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "payloadJson" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WritingSetting_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WritingPreset" (
  "id" TEXT NOT NULL,
  "novelId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "payloadJson" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WritingPreset_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WritingRequirement" (
  "id" TEXT NOT NULL,
  "novelId" TEXT NOT NULL,
  "chapterId" TEXT,
  "payloadJson" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WritingRequirement_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ChapterEditVersion" (
  "id" TEXT NOT NULL,
  "novelId" TEXT NOT NULL,
  "chapterId" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "baseRevision" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "contentHash" TEXT NOT NULL,
  "requirementsId" TEXT,
  "metadataJson" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ChapterEditVersion_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ManualEditSession" (
  "id" TEXT NOT NULL,
  "novelId" TEXT NOT NULL,
  "taskId" TEXT,
  "runtimeId" TEXT,
  "scopeJson" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "payloadJson" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ManualEditSession_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ChapterAdjustmentGuard" (
  "chapterId" TEXT NOT NULL,
  "novelId" TEXT NOT NULL,
  "epoch" INTEGER NOT NULL DEFAULT 0,
  "manualSessionId" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ChapterAdjustmentGuard_pkey" PRIMARY KEY ("chapterId")
);

CREATE TABLE "WritingAcceptance" (
  "id" TEXT NOT NULL,
  "novelId" TEXT NOT NULL,
  "chapterId" TEXT NOT NULL,
  "editVersionId" TEXT NOT NULL,
  "requestKey" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "payloadJson" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WritingAcceptance_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WritingAdjustmentOperation" (
  "id" TEXT NOT NULL,
  "novelId" TEXT NOT NULL,
  "requestKey" TEXT NOT NULL,
  "requestHash" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "resultJson" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WritingAdjustmentOperation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WritingSetting_novelId_scopeKey_key" ON "WritingSetting"("novelId", "scopeKey");
CREATE INDEX "WritingPreset_novelId_updatedAt_idx" ON "WritingPreset"("novelId", "updatedAt");
CREATE INDEX "WritingRequirement_novelId_chapterId_createdAt_idx" ON "WritingRequirement"("novelId", "chapterId", "createdAt");
CREATE INDEX "WritingRequirement_expiresAt_idx" ON "WritingRequirement"("expiresAt");
CREATE INDEX "ChapterEditVersion_novelId_chapterId_createdAt_idx" ON "ChapterEditVersion"("novelId", "chapterId", "createdAt");
CREATE INDEX "ChapterEditVersion_sessionId_createdAt_idx" ON "ChapterEditVersion"("sessionId", "createdAt");
CREATE INDEX "ManualEditSession_novelId_status_updatedAt_idx" ON "ManualEditSession"("novelId", "status", "updatedAt");
CREATE INDEX "ManualEditSession_taskId_idx" ON "ManualEditSession"("taskId");
CREATE INDEX "ManualEditSession_runtimeId_idx" ON "ManualEditSession"("runtimeId");
CREATE INDEX "ChapterAdjustmentGuard_novelId_idx" ON "ChapterAdjustmentGuard"("novelId");
CREATE INDEX "ChapterAdjustmentGuard_manualSessionId_idx" ON "ChapterAdjustmentGuard"("manualSessionId");
CREATE UNIQUE INDEX "WritingAcceptance_requestKey_key" ON "WritingAcceptance"("requestKey");
CREATE INDEX "WritingAcceptance_novelId_chapterId_createdAt_idx" ON "WritingAcceptance"("novelId", "chapterId", "createdAt");
CREATE INDEX "WritingAcceptance_editVersionId_idx" ON "WritingAcceptance"("editVersionId");
CREATE INDEX "WritingAcceptance_status_updatedAt_idx" ON "WritingAcceptance"("status", "updatedAt");
CREATE UNIQUE INDEX "WritingAdjustmentOperation_requestKey_key" ON "WritingAdjustmentOperation"("requestKey");
CREATE INDEX "WritingAdjustmentOperation_novelId_createdAt_idx" ON "WritingAdjustmentOperation"("novelId", "createdAt");
CREATE INDEX "WritingAdjustmentOperation_status_updatedAt_idx" ON "WritingAdjustmentOperation"("status", "updatedAt");
