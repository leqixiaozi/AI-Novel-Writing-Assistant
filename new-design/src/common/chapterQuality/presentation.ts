const chapterTitleCollator = new Intl.Collator("zh-CN", { numeric: true });

export function orderQualityChapterCards<T extends { id: string; title: string }>(cards: readonly T[]): T[] {
  return [...cards].sort((left, right) => chapterTitleCollator.compare(left.title, right.title) || left.id.localeCompare(right.id));
}
