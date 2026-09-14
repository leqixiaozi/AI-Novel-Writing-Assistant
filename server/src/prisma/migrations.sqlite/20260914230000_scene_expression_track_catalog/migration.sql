PRAGMA foreign_keys=OFF;

CREATE TABLE "new_SceneExpressionPoint" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "novelId" TEXT NOT NULL,
    "sceneId" TEXT NOT NULL,
    "dimensionKey" TEXT NOT NULL,
    "level" INTEGER NOT NULL CHECK ("level" BETWEEN 1 AND 5),
    "note" TEXT,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SceneExpressionPoint_sceneId_fkey" FOREIGN KEY ("sceneId") REFERENCES "ChapterPlanScene" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

INSERT INTO "new_SceneExpressionPoint" ("createdAt", "dimensionKey", "id", "level", "note", "novelId", "revision", "sceneId", "updatedAt")
SELECT "createdAt", "dimensionKey", "id", "level", "note", "novelId", "revision", "sceneId", "updatedAt" FROM "SceneExpressionPoint";

DROP TABLE "SceneExpressionPoint";
ALTER TABLE "new_SceneExpressionPoint" RENAME TO "SceneExpressionPoint";
CREATE INDEX "SceneExpressionPoint_novelId_sceneId_idx" ON "SceneExpressionPoint"("novelId", "sceneId");
CREATE UNIQUE INDEX "SceneExpressionPoint_novelId_sceneId_dimensionKey_key" ON "SceneExpressionPoint"("novelId", "sceneId", "dimensionKey");

CREATE TABLE "SceneExpressionTrackCatalog" (
    "novelId" TEXT NOT NULL PRIMARY KEY,
    "definitionsJson" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SceneExpressionTrackCatalog_novelId_fkey" FOREIGN KEY ("novelId") REFERENCES "Novel" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

PRAGMA foreign_keys=ON;
