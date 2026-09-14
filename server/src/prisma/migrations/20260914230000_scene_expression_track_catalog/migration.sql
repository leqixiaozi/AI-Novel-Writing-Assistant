ALTER TABLE "SceneExpressionPoint" DROP CONSTRAINT IF EXISTS "SceneExpressionPoint_dimensionKey_check";

CREATE TABLE "SceneExpressionTrackCatalog" (
    "novelId" TEXT NOT NULL,
    "definitionsJson" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SceneExpressionTrackCatalog_pkey" PRIMARY KEY ("novelId")
);

ALTER TABLE "SceneExpressionTrackCatalog" ADD CONSTRAINT "SceneExpressionTrackCatalog_novelId_fkey" FOREIGN KEY ("novelId") REFERENCES "Novel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
