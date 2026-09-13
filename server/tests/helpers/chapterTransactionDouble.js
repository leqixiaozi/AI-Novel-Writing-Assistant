const assert = require("node:assert/strict");

/** Keep unit-test transactions entirely in memory while exercising the real write guard. */
function installChapterTransactionDouble(t, prisma, models) {
  const guard = { findUnique: async () => null };
  // Prisma delegate methods are proxy properties, so MockTracker.method cannot
  // inspect their descriptors. Restore assignments through the test cleanup hook.
  const originalFindFirst = prisma.chapterAdjustmentGuard.findFirst;
  const originalFindUnique = prisma.chapterAdjustmentGuard.findUnique;
  const originalTransaction = prisma.$transaction;
  t.after(() => {
    prisma.chapterAdjustmentGuard.findFirst = originalFindFirst;
    prisma.chapterAdjustmentGuard.findUnique = originalFindUnique;
    prisma.$transaction = originalTransaction;
  });
  prisma.chapterAdjustmentGuard.findFirst = async () => null;
  prisma.chapterAdjustmentGuard.findUnique = guard.findUnique;
  prisma.$transaction = async (callback) => {
    assert.equal(typeof callback, "function", "expected an interactive chapter transaction");
    return callback({ ...models, chapterAdjustmentGuard: guard, $executeRaw: async (sql, chapterId, novelId) => {
      assert.match(sql.join("?"), /UPDATE "Chapter" SET "id" = "id" WHERE "id" = \? AND "novelId" = \?/);
      assert.equal(typeof chapterId, "string");
      assert.equal(typeof novelId, "string");
      return 1;
    } });
  };
}

module.exports = { installChapterTransactionDouble };
