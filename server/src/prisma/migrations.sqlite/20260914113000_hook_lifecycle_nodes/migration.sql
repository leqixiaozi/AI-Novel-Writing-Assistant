CREATE TABLE "TimelineHookLifecycleNode" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "novelId" TEXT NOT NULL,
    "hookId" TEXT NOT NULL,
    "chapterId" TEXT NOT NULL,
    "chapterIndex" INTEGER NOT NULL,
    "stage" TEXT NOT NULL,
    "basis" TEXT NOT NULL DEFAULT 'plan',
    "note" TEXT NOT NULL DEFAULT '',
    "evidence" TEXT,
    "relatedEventId" TEXT,
    "relatedSceneId" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

CREATE INDEX "TimelineHookLifecycleNode_novelId_hookId_idx" ON "TimelineHookLifecycleNode"("novelId", "hookId");
CREATE INDEX "TimelineHookLifecycleNode_novelId_chapterIndex_idx" ON "TimelineHookLifecycleNode"("novelId", "chapterIndex");
