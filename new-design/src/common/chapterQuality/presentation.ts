const chapterTitleCollator = new Intl.Collator("zh-CN", { numeric: true });
const numberedChapter = (title: string): number | null => {
  const match = /^第\s*(\d+)\s*章/.exec(title);
  return match ? Number(match[1]) : null;
};

export function orderQualityChapterCards<T extends { id: string; title: string }>(cards: readonly T[], chapters: readonly { chapterCardId: string; logicalOrder: number }[] = []): T[] {
  const orderById = new Map(chapters.map(item => [item.chapterCardId, item.logicalOrder]));
  return [...cards].sort((left, right) => {
    const leftOrder = orderById.get(left.id) ?? numberedChapter(left.title);
    const rightOrder = orderById.get(right.id) ?? numberedChapter(right.title);
    if (leftOrder !== null && rightOrder !== null && leftOrder !== rightOrder) return leftOrder - rightOrder;
    if (leftOrder !== null && rightOrder === null) return -1;
    if (leftOrder === null && rightOrder !== null) return 1;
    return chapterTitleCollator.compare(left.title, right.title) || left.id.localeCompare(right.id);
  });
}

export function orderQualityRepairIssues<T extends { id: string }>(issues: readonly T[], targetId: string | null): T[] {
  return targetId ? [...issues].sort((left, right) => Number(right.id === targetId) - Number(left.id === targetId)) : [...issues];
}

export function qualityReportBindsChapter(report: { bodyVersions: readonly { chapterDocumentId: string }[] }, chapterDocumentId: string): boolean {
  return report.bodyVersions.some(item => item.chapterDocumentId === chapterDocumentId);
}
