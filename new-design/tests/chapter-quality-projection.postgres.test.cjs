const { test } = require('node:test');
const assert = require('node:assert/strict');
const { isolatedDatabase, compiled } = require('./support/isolatedDatabase.cjs');

test('quality projection exposes the adopted body ID for a real chapter', async t => {
  const { pool } = await isolatedDatabase(t);
  const row = (await pool.query(`
    SELECT book.id AS book_id, card.id AS card_id, card.title
    FROM new_design.books book
    JOIN new_design.cards card ON card.space_id=book.space_id AND card.status='active'
    JOIN new_design.card_types type ON type.id=card.card_type_id AND type.type_key='chapter'
    LEFT JOIN new_design.chapter_documents document ON document.chapter_card_id=card.id AND document.status='active'
    WHERE document.id IS NULL
    ORDER BY book.id,card.id LIMIT 1
  `)).rows[0];
  assert.ok(row, 'seeded book has an unused chapter card');
  const bodies = compiled('server/database/chapterBodyStore');
  const document = await bodies.createChapterDocument({ bookId: row.book_id, chapterCardId: row.card_id, logicalOrder: 1, title: row.title });
  const candidate = await bodies.addChapterBodyVersion(document.id, { content: '隔离测试章节正文。', source: 'manual', createdByKind: 'user', createdBy: 'isolated-test' });
  await bodies.adoptChapterBodyVersion(document.id, { versionId: candidate.id, expectedRevision: document.revision, idempotencyKey: 'quality-projection-test', actor: 'isolated-test' });
  const chapters = (await compiled('server/database/multiview').getBookMultiviewWorkspace(row.book_id)).chapters;
  assert.equal(chapters.find(item => item.chapterDocumentId === document.id)?.adoptedBodyVersionId, candidate.id);
});
