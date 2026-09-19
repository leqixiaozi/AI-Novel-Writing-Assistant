const test = require('node:test');
const assert = require('node:assert/strict');

test('comparison gateway shares the legacy shell while preserving the new-design API', async () => {
  const { upstream } = await import('../scripts/comparison/routing.mjs');
  assert.equal(upstream('/new-design'), 5275);
  assert.equal(upstream('/new-design/books/123?view=shelf'), 5275);
  assert.equal(upstream('/new-design/@vite/client'), 5275);
  assert.equal(upstream('/__new_hmr'), 5274);
  assert.equal(upstream('/api/new-design/independent-health'), 5301);
  assert.equal(upstream('/novels?view=shelf'), 5275);
  assert.equal(upstream('/api/novels'), 3000);
});
