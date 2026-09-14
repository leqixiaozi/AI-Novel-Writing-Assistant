ALTER TABLE "Novel" ADD COLUMN "sceneExpressionTracksEnabled" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "SceneExpressionPoint" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "novelId" TEXT NOT NULL,
    "sceneId" TEXT NOT NULL,
    "dimensionKey" TEXT NOT NULL CHECK ("dimensionKey" IN ('scene_pace', 'sentence_cadence', 'detail_expansion', 'camera_distance', 'language_ornament')),
    "level" INTEGER NOT NULL CHECK ("level" BETWEEN 1 AND 5),
    "note" TEXT,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SceneExpressionPoint_sceneId_fkey" FOREIGN KEY ("sceneId") REFERENCES "ChapterPlanScene" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "SceneExpressionPoint_novelId_sceneId_idx" ON "SceneExpressionPoint"("novelId", "sceneId");
CREATE UNIQUE INDEX "SceneExpressionPoint_novelId_sceneId_dimensionKey_key" ON "SceneExpressionPoint"("novelId", "sceneId", "dimensionKey");
