ALTER TABLE "Novel" ADD COLUMN "sceneExpressionTracksEnabled" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "SceneExpressionPoint" (
    "id" TEXT NOT NULL,
    "novelId" TEXT NOT NULL,
    "sceneId" TEXT NOT NULL,
    "dimensionKey" TEXT NOT NULL,
    "level" INTEGER NOT NULL,
    "note" TEXT,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SceneExpressionPoint_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "SceneExpressionPoint_dimensionKey_check" CHECK ("dimensionKey" IN ('scene_pace', 'sentence_cadence', 'detail_expansion', 'camera_distance', 'language_ornament')),
    CONSTRAINT "SceneExpressionPoint_level_check" CHECK ("level" BETWEEN 1 AND 5)
);

CREATE INDEX "SceneExpressionPoint_novelId_sceneId_idx" ON "SceneExpressionPoint"("novelId", "sceneId");
CREATE UNIQUE INDEX "SceneExpressionPoint_novelId_sceneId_dimensionKey_key" ON "SceneExpressionPoint"("novelId", "sceneId", "dimensionKey");
ALTER TABLE "SceneExpressionPoint" ADD CONSTRAINT "SceneExpressionPoint_sceneId_fkey" FOREIGN KEY ("sceneId") REFERENCES "ChapterPlanScene"("id") ON DELETE CASCADE ON UPDATE CASCADE;
