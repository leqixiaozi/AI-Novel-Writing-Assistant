const test = require('node:test');
const assert = require('node:assert/strict');
const { orderQualityChapterCards } = require('../dist/common/chapterQuality/presentation');

test('quality chapter choices follow numeric chapter titles without mutating the source order', () => {
  const cards = [
    { id: 'ten', title: '第10章：抢先修复的人' },
    { id: 'one', title: '第1章：这栋楼没有十三层' },
    { id: 'two', title: '第2章：十二分钟的另一端' },
  ];
  assert.deepEqual(orderQualityChapterCards(cards).map(card => card.id), ['one', 'two', 'ten']);
  assert.deepEqual(cards.map(card => card.id), ['ten', 'one', 'two']);
});
