const test = require('node:test');
const assert = require('node:assert/strict');
const { orderQualityChapterCards, orderQualityRepairIssues, qualityReportBindsChapter } = require('../dist/common/chapterQuality/presentation');

test('quality chapter choices follow numeric chapter titles without mutating the source order', () => {
  const cards = [
    { id: 'ten', title: '第10章：抢先修复的人' },
    { id: 'one', title: '第1章：这栋楼没有十三层' },
    { id: 'two', title: '第2章：十二分钟的另一端' },
  ];
  assert.deepEqual(orderQualityChapterCards(cards).map(card => card.id), ['one', 'two', 'ten']);
  assert.deepEqual(cards.map(card => card.id), ['ten', 'one', 'two']);
});

test('repair deep link keeps its exact issue first without changing the source list', () => {
  const issues = [{ id: 'other' }, { id: 'target' }, { id: 'later' }];
  assert.deepEqual(orderQualityRepairIssues(issues, 'target').map(issue => issue.id), ['target', 'other', 'later']);
  assert.deepEqual(issues.map(issue => issue.id), ['other', 'target', 'later']);
});

test('repair deep link only accepts a report bound to the current chapter body', () => {
  const report = { bodyVersions: [{ chapterDocumentId: 'chapter-a', bodyVersionId: 'body-a' }] };
  assert.equal(qualityReportBindsChapter(report, 'chapter-a'), true);
  assert.equal(qualityReportBindsChapter(report, 'chapter-b'), false);
});
