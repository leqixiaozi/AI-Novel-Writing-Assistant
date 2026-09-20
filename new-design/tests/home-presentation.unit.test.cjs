const test = require('node:test');
const assert = require('node:assert/strict');
const { homeTotals, selectHomeBook, homePrimaryCover, homeBookAction, homeDraftAction, homeStages } = require('../dist/common/home/presentation');
const { projectHomeBook } = require('../dist/server/database/home');
const book = (patch = {}) => ({ ...projectHomeBook({ id: 'book-a', name: '守脉者', created_at: '2026-09-01', updated_at: '2026-09-17' }), ...patch });
const run = (patch = {}) => ({ id: 'run-a', status: 'completed', leaseExpired: false, chapterCount: 6, savedCandidateCount: 6, ...patch });

test('home counts all books once per category, never uses task counts as book counts', () => {
  const books = Array.from({ length: 237 }, (_, i) => book({ id: `book-${i}`, runningTasks: 4, queuedTasks: 2, waitingTasks: 3, writtenChapterCount: 2, requiredFieldCount: 0 }));
  const result = homeTotals({ books, creationDraft: null });
  assert.equal(result.books, 237);
  assert.equal(result.running, 237);
  assert.equal(result.attention, 237);
  assert.equal(result.chapters, 474);
  assert.equal(result.ready, 0);
  assert.equal(result.required, 0);
});
test('recoverable director takes priority over newer work and navigates to the exact original run without executing', () => {
  const recover = book({ id: 'recover', updatedAt: '2026-09-01', latestDirector: run({ status: 'waiting_recovery' }) });
  const active = book({ id: 'active', runningTasks: 2 });
  const input = [active, recover];
  assert.equal(selectHomeBook(input).id, 'recover');
  assert.equal(input[0].id, 'active');
  assert.equal(homeBookAction(recover).href, '/new-design/books/recover/director?run=run-a');
  assert.equal(homeBookAction(recover).tone, 'attention');
});
test('expired lease is attention, not active work; saved candidates do not become adopted chapters or full-book progress', () => {
  const item = book({ latestDirector: run({ status: 'running', leaseExpired: true }) });
  const result = homeTotals({ books: [item] });
  assert.equal(result.running, 0);
  assert.equal(result.attention, 1);
  assert.equal(result.chapters, 0);
  assert.equal(homeBookAction(item).tone, 'attention');
  const stages = homeStages(book({ latestDirector: run() }));
  assert.equal(stages.find(stage => stage.label === '正文创作').evidenced, false);
  assert.equal(stages.find(stage => stage.label === '质量完善').evidenced, false);
  assert.doesNotMatch(JSON.stringify(stages), /100%|progressPercent/);
});
test('adopted content and stable content are independent evidence', () => {
  const stages = homeStages(book({ writtenChapterCount: 2, stableChapterCount: 0, openQualityIssues: 3 }));
  assert.equal(stages[4].evidenced, true);
  assert.equal(stages[5].evidenced, false);
  assert.match(stages[5].detail, /0 章已稳定.*3 项待处理/);
});
test('draft recovery retains session and selection tie breaks deterministically', () => {
  assert.equal(homeDraftAction({ id: 'draft-a', status: 'waiting_direction' }).href, '/new-design/books/new?session=draft-a');
  assert.equal(homeDraftAction({ id: 'draft-a', status: 'failed' }).tone, 'attention');
  assert.equal(selectHomeBook([]), null);
  assert.equal(selectHomeBook([book({ id: 'z' }), book({ id: 'a' })]).id, 'a');
});
test('home cover uses the exact active readable book mount', () => {
  const version = (id, readable) => ({ id, readable });
  const asset = (id, kind, status, versions) => ({ id, kind, status, versions });
  const mount = (assetId, versionId, status = 'active', ownerKind = 'book') => ({ assetId, versionId, status, ownerKind, ownerStableId: 'book-a' });
  const workspace = { bookId: 'book-a', assets: [asset('old', 'cover', 'archived', [version('old-v', true)]), asset('illustration', 'illustration', 'active', [version('i-v', true)]), asset('current', 'cover', 'active', [version('bad', false), version('good', true)])], mounts: [mount('old', 'old-v'), mount('illustration', 'i-v'), mount('current', 'bad'), mount('current', 'good')] };
  assert.deepEqual(homePrimaryCover(workspace), { assetId: 'current', versionId: 'good' });
  workspace.mounts = [mount('current', 'good', 'ended')];
  assert.equal(homePrimaryCover(workspace), null);
});
