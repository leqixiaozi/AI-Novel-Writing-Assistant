const chapterTitleCollator = new Intl.Collator("zh-CN", { numeric: true });

export function orderQualityChapterCards<T extends { id: string; title: string }>(cards: readonly T[]): T[] {
  return [...cards].sort((left, right) => chapterTitleCollator.compare(left.title, right.title) || left.id.localeCompare(right.id));
}

export function orderQualityRepairIssues<T extends { id: string }>(issues: readonly T[], targetId: string | null): T[] {
  return targetId ? [...issues].sort((left, right) => Number(right.id === targetId) - Number(left.id === targetId)) : [...issues];
}

export function qualityReportBindsChapter(report: { bodyVersions: readonly { chapterDocumentId: string }[] }, chapterDocumentId: string): boolean {
  return report.bodyVersions.some(item => item.chapterDocumentId === chapterDocumentId);
}
