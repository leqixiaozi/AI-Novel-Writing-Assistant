const test = require('node:test');
const assert = require('node:assert/strict');
const {creationCatalog} = require('../dist/server/database/bookCreationProduction');
const {preparePrompt} = require('../dist/server/ai/prompts');
const uuid = n => `40000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function fixture(parent) {
  return {cardTypes: [], dictionaries: [{sourceId: uuid(1), name: '题材', items: [
    {sourceId: uuid(2), label: '悬疑', ...parent},
    {sourceId: uuid(3), parentSourceId: uuid(2), label: '都市悬疑'},
  ]}], relationTypes: [], forms: [], seedCards: [], menu: {defaultPage: 'overview', pages: []}};
}

for (const parent of [{}, {parentSourceId: null}]) {
  test(`creation prompt accepts ${Object.hasOwn(parent, 'parentSourceId') ? 'explicit' : 'historical omitted'} root parent without changing template`, () => {
    const payload = fixture(parent), before = structuredClone(payload);
    const catalog = creationCatalog(uuid(4), payload, []);
    assert.deepEqual(catalog.dictionaries[0].nodes, [
      {id: uuid(2), parentId: null, label: '悬疑', path: ['悬疑']},
      {id: uuid(3), parentId: uuid(2), label: '都市悬疑', path: ['悬疑', '都市悬疑']},
    ]);
    assert.doesNotThrow(() => preparePrompt('directions', {
      contract: 'creation_preparation_v1', sessionId: uuid(5), sessionRevision: 2,
      specificationHash: 'a'.repeat(64), stage: 'direction', mode: 'all', method: 'idea',
      bookName: '失物招领处不收活人', sourceReference: '', sourceText: '夜间失物招领处',
      direction: null, schemaTypes: [], targets: [], contextCards: [], catalog,
    }));
    assert.deepEqual(payload, before);
  });
}

test('invalid non-null parent identifiers are not silently converted to roots', () => {
  const catalog = creationCatalog(uuid(4), fixture({parentSourceId: 'invalid-parent'}), []);
  assert.equal(catalog.dictionaries[0].nodes[0].parentId, 'invalid-parent');
  assert.throws(() => preparePrompt('directions', {
    contract: 'creation_preparation_v1', sessionId: uuid(5), sessionRevision: 2,
    specificationHash: 'a'.repeat(64), stage: 'direction', mode: 'all', method: 'idea',
    bookName: '失物招领处不收活人', sourceReference: '', sourceText: '夜间失物招领处',
    direction: null, schemaTypes: [], targets: [], contextCards: [], catalog,
  }));
});
