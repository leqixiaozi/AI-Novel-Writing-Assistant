import type { CardTypeCategory, CardTypeSummary } from "./contracts";

export interface CardTypeTreeNode {
  category: CardTypeCategory;
  cardTypes: CardTypeSummary[];
  children: CardTypeTreeNode[];
  typeCount: number;
}

export function buildCardTypeTree(categories: CardTypeCategory[], cardTypes: CardTypeSummary[], query = ""): CardTypeTreeNode[] {
  const normalized = query.trim().toLocaleLowerCase("zh-CN");
  const categoryById = new Map(categories.map((category) => [category.id, category]));
  const categoryMatches = new Set(categories.filter((category) => normalized && `${category.name} ${category.key}`.toLocaleLowerCase("zh-CN").includes(normalized)).map((category) => category.id));
  const matchedTypes = normalized
    ? cardTypes.filter((type) => categoryMatches.has(type.categoryId ?? "") || `${type.name} ${type.key} ${type.description}`.toLocaleLowerCase("zh-CN").includes(normalized))
    : cardTypes;
  const visibleCategoryIds = new Set<string>();
  for (const type of matchedTypes) {
    let categoryId = type.categoryId;
    while (categoryId) {
      visibleCategoryIds.add(categoryId);
      categoryId = categoryById.get(categoryId)?.parentId ?? null;
    }
  }
  const makeNode = (category: CardTypeCategory): CardTypeTreeNode => {
    const ownTypes = matchedTypes.filter((type) => type.categoryId === category.id).sort((a, b) => a.sortOrder - b.sortOrder);
    const children = categories.filter((item) => item.parentId === category.id && (!normalized || visibleCategoryIds.has(item.id))).sort((a, b) => a.sortOrder - b.sortOrder).map(makeNode);
    return { category, cardTypes: ownTypes, children, typeCount: ownTypes.length + children.reduce((sum, child) => sum + child.typeCount, 0) };
  };
  return categories.filter((category) => !category.parentId && (!normalized || visibleCategoryIds.has(category.id))).sort((a, b) => a.sortOrder - b.sortOrder).map(makeNode);
}
