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
  { key: "professional", label: "专业创作资源", href: "/new-design/resources/professional" },
  { key: "research", label: "研究与分析", href: "/new-design/research" },
  { key: "knowledge", label: "知识与参考", href: "/new-design/knowledge" },
  { key: "records", label: "运行记录", href: "/new-design/operations/records" },
] as const;

export const NEW_DESIGN_ADVANCED_NAV = [
  { key: "content-types", label: "内容类型", href: "/new-design/structure/card-types" },
  { key: "options-relations", label: "选项与关联", href: "/new-design/structure/dictionaries-relations" },
  { key: "forms", label: "创作表单", href: "/new-design/structure/forms" },
  { key: "templates", label: "开书模板", href: "/new-design/structure/templates" },
  { key: "context", label: "上下文管理", href: "/new-design/structure/context" },
  { key: "models", label: "模型设置", href: "/new-design/structure/models" },
  { key: "maintenance", label: "运行维护", href: "/new-design/structure/maintenance" },
] as const;

export const BOOK_TASK_NAV = [
  { key: "overview", label: "创作概览", path: "overview" },
  { key: "planning", label: "故事规划", path: "planning" },
  { key: "composition", label: "全书编排", path: "composition" },
  { key: "director", label: "全书导演", path: "director" },
  { key: "world", label: "世界设定", path: "world" },
  { key: "characters", label: "人物维护", path: "characters" },
  { key: "visual-assets", label: "视觉资产", path: "visual-assets" },
  { key: "writing", label: "章节创作", path: "writing" },
  { key: "views", label: "多维视图", path: "views/chapters" },
  { key: "materials", label: "本书资料", path: "cards" },
  { key: "knowledge", label: "知识与参考", path: "knowledge" },
  { key: "settings", label: "本书设置", path: "fields" },
  { key: "completion", label: "完本与导出", path: "completion" },
] as const;

export type BookTaskNavKey = (typeof BOOK_TASK_NAV)[number]["key"];

export function isNewDesignAdvancedPath(pathname: string): boolean {
  return pathname.startsWith("/new-design/structure/");
}
