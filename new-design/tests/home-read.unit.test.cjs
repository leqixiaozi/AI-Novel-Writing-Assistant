const test = require('node:test');
const assert = require('node:assert/strict');
const { getHomeSnapshot, projectHomeBook, projectHomeCreation, HOME_BOOKS_QUERY, HOME_CREATION_QUERY } = require('../dist/server/database/home');
const time = '2026-09-17T08:00:00.000Z';
const book = (patch = {}) => ({ id: 'book-a', name: '守脉者', description: '', created_at: time, updated_at: time, ...patch });

function fixture({ books = [], creation = [], fail, rollbackFails = false } = {}) {
  const calls = [];
  let released = 0;
  const client = {
    async query(sql) {
      calls.push(sql);
      if (sql === 'ROLLBACK' && rollbackFails) throw new Error('rollback error');
      if (sql === fail) throw new Error('fixture read error');
      if (sql === HOME_BOOKS_QUERY) return { rows: books };
      if (sql === HOME_CREATION_QUERY) return { rows: creation };
      if (sql === 'SELECT CURRENT_TIMESTAMP read_at') return { rows: [{ read_at: time }] };
      return { rows: [] };
    },
    release() { released++; },
  };
  return { pool: { async connect() { return client; } }, calls, released: () => released };
}

test('all active books are projected in one repeatable read read-only snapshot, including more than 100', async () => {
  const source = fixture({ books: Array.from({ length: 237 }, (_, i) => book({ id: `book-${i}`, card_count: '2', running_tasks: '3' })) });
  const result = await getHomeSnapshot(source.pool);
  assert.equal(result.books.length, 237);
  assert.equal(new Set(result.books.map(item => item.id)).size, 237);
  assert.equal(result.books[236].cardCount, 2);
  assert.equal(result.books[236].runningTasks, 3);
  assert.equal(result.readAt, time);
  assert.equal(result.creationDraft, null);
  assert.deepEqual(source.calls, ['BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY', 'SELECT CURRENT_TIMESTAMP read_at', HOME_BOOKS_QUERY, HOME_CREATION_QUERY, 'COMMIT']);
  assert.equal(source.released(), 1);
  assert.doesNotMatch(HOME_BOOKS_QUERY, /\bLIMIT\b/i);
});

test('read or projection failure rolls back and releases; rollback failure preserves original error', async () => {
  for (const rollbackFails of [false, true]) {
    const source = fixture({ fail: HOME_CREATION_QUERY, rollbackFails });
    await assert.rejects(getHomeSnapshot(source.pool), /fixture read error/);
    assert.equal(source.calls.at(-1), 'ROLLBACK');
    assert.ok(!source.calls.includes('COMMIT'));
    assert.equal(source.released(), 1);
  }
  const source = fixture({ books: [book({ card_count: 'not-a-count' })] });
  await assert.rejects(getHomeSnapshot(source.pool), /未完整读取/);
  assert.equal(source.calls.at(-1), 'ROLLBACK');
  assert.equal(source.released(), 1);
});

test('commit failure also releases and cannot return an unacknowledged snapshot', async () => {
  const source = fixture({ fail: 'COMMIT' });
  await assert.rejects(getHomeSnapshot(source.pool), /fixture read error/);
  assert.equal(source.calls.at(-1), 'ROLLBACK');
  assert.equal(source.released(), 1);
});

test('projection exposes only declared home facts, preserves task counts and expired director lease', () => {
  const result = projectHomeBook(book({ card_count: '9', character_count: '3', world_count: '1', required_field_count: '0', filled_required_field_count: '0',
    running_tasks: '4', queued_tasks: '2', waiting_tasks: '1', task_id: 'task-1', task_status: 'running', task_source_route: '/new-design/books/book-a/writing', task_updated_at: time,
    director_id: 'run-1', director_status: 'running', director_lease_expired: true, director_chapter_count: '7', director_saved_candidate_count: '2',
    input_payload: { apiKey: 'never-public' }, content: 'private-body', lease_token: 'private-token' }));
  assert.equal(result.cardCount, 9);
  assert.equal(result.runningTasks, 4);
  assert.equal(result.requiredFieldCount, 0);
  assert.equal(result.filledRequiredFieldCount, 0);
  assert.equal(result.latestDirector.leaseExpired, true);
  assert.equal(result.latestDirector.savedCandidateCount, 2);
  assert.equal(result.latestTask.sourceRoute, '/new-design/books/book-a/writing');
  assert.doesNotMatch(JSON.stringify(result), /never-public|private-body|private-token|input_payload/);
});

test('creation draft uses the canonical structured state reader and exports no body, lease or prompt', () => {
  const result = projectHomeCreation({ id: 'draft-1', book_name: '新作品', status: 'failed', stage: 'world', progress: 40, selected_direction_id: 'direction-1', updated_at: time,
    director_state: { mode: 'stepwise', cursor: 2, completedStages: ['direction', 'direction', 'project', 'not-real'], leaseUntil: 'private-lease', activeBatchId: 'private-batch' },
    input_payload: { apiKey: 'private-secret' }, initial_cards: [{ manuscript: 'private-body' }] });
  assert.deepEqual(result.completedStages, ['direction', 'project']);
  assert.equal(result.mode, 'stepwise');
  assert.equal(result.selectedDirection, true);
  assert.equal(result.status, 'failed');
  assert.doesNotMatch(JSON.stringify(result), /private-/);
  assert.equal(projectHomeCreation(undefined), null);
  assert.match(HOME_CREATION_QUERY, /book_id IS NULL AND status NOT IN \('completed'\)/);
  assert.doesNotMatch(HOME_CREATION_QUERY, /SELECT \*|initial_cards|review_cards|description|source_reference/);
});

test('query counts independent grouped ledgers and current body checkpoints without history multiplication', () => {
  assert.doesNotMatch(HOME_BOOKS_QUERY + HOME_CREATION_QUERY, /\b(?:INSERT|UPDATE|DELETE|CREATE|ALTER|CALL)\b/i);
  assert.match(HOME_BOOKS_QUERY, /card_counts AS \(SELECT book_id/);
  assert.match(HOME_BOOKS_QUERY, /task_counts AS \(SELECT book_id/);
  assert.match(HOME_BOOKS_QUERY, /SELECT DISTINCT ON \(book_id\).*new_design.ai_tasks/);
  assert.match(HOME_BOOKS_QUERY, /checkpoint.body_version_id=document.adopted_version_id/);
  assert.match(HOME_BOOKS_QUERY, /checkpoint.status='stable'/);
  assert.match(HOME_BOOKS_QUERY, /chapter.based_on_parent_version_id=volume.adopted_version_id/);
  assert.match(HOME_BOOKS_QUERY, /story.parent_object_id IS NULL/);
  assert.match(HOME_BOOKS_QUERY, /COALESCE\(scenes.total,0\)<=297/);
  assert.match(HOME_BOOKS_QUERY, /body.archived_at IS NULL/);
  assert.match(HOME_BOOKS_QUERY, /card.type_status='published'/);
  assert.match(HOME_BOOKS_QUERY, /'null'::jsonb,'""'::jsonb,'\[\]'::jsonb/);
});
