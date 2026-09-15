export const CUSTOMER_TERMS = Object.freeze({
  card: "资料",
  cardType: "内容类型",
  form: "创作表单",
  template: "开书模板",
  publicResources: "创作资源",
  bookResources: "本书资料",
  relation: "资料关联",
  history: "修改记录",
} as const);

export const NEW_DESIGN_PRIMARY_NAV = [
  { key: "home", label: "创作首页", href: "/new-design", end: true },
  { key: "books", label: "我的书籍", href: "/new-design/books" },
  { key: "resources", label: "创作资源", href: "/new-design/resources" },
  { key: "research", label: "研究与分析", href: "/new-design/research" },
] as const;

export const NEW_DESIGN_ADVANCED_NAV = [
  { key: "content-types", label: "内容类型", href: "/new-design/structure/card-types" },
  { key: "options-relations", label: "选项与关联", href: "/new-design/structure/dictionaries-relations" },
  { key: "forms", label: "创作表单", href: "/new-design/structure/forms" },
  { key: "templates", label: "开书模板", href: "/new-design/structure/templates" },
  { key: "context", label: "上下文管理", href: "/new-design/structure/context" },
] as const;

export const BOOK_TASK_NAV = [
  { key: "overview", label: "创作概览", path: "overview" },
  { key: "planning", label: "故事规划", path: "planning" },
  { key: "characters", label: "人物", path: "views/characters" },
  { key: "world", label: "世界设定", path: "views/world" },
  { key: "events", label: "剧情与事件", path: "views/events" },
  { key: "chapters", label: "章节", path: "views/chapters" },
  { key: "clues", label: "线索与伏笔", path: "views/clues" },
  { key: "materials", label: "本书资料", path: "cards" },
  { key: "settings", label: "本书设置", path: "fields" },
] as const;

export type BookTaskNavKey = (typeof BOOK_TASK_NAV)[number]["key"];

export function isNewDesignAdvancedPath(pathname: string): boolean {
  return pathname.startsWith("/new-design/structure/");
}
