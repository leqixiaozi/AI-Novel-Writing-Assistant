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
  { key: "titles", label: "开书前标题", href: "/new-design/resources/titles" },
  { key: "professional", label: "资源工作台", href: "/new-design/resources/professional" },
  { key: "research", label: "研究与分析", href: "/new-design/research" },
  { key: "knowledge", label: "知识与参考", href: "/new-design/knowledge" },
  { key: "records", label: "运行记录", href: "/new-design/operations/records" },
  { key: "director-control", label: "导演总控台", href: "/new-design/operations/director" },
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

export function newDesignCurrentMenuHref(pathname:string):string|undefined {
  return [...NEW_DESIGN_PRIMARY_NAV,...NEW_DESIGN_ADVANCED_NAV]
    .filter(item=>pathname===item.href||(!('end' in item&&item.end)&&pathname.startsWith(`${item.href}/`)))
    .sort((left,right)=>right.href.length-left.href.length)[0]?.href;
}

export const BOOK_TASK_NAV = [
  { key: "overview", label: "创作概览", path: "overview" },
  { key: "direction", label: "创作方向", path: "setting" },
  { key: "story-setting", label: "故事设定", path: "story-setting" },
  { key: "planning", label: "故事规划", path: "planning" },
  { key: "composition", label: "全书编排", path: "composition" },
  { key: "director", label: "全书导演", path: "director" },
  { key: "world", label: "世界设定", path: "world" },
  { key: "characters", label: "人物维护", path: "characters" },
  { key: "character-dialogue", label: "人物对话模拟", path: "character-dialogue" },
  { key: "visual-assets", label: "视觉资产", path: "visual-assets" },
  { key: "writing", label: "章节创作", path: "writing" },
  { key: "views", label: "多维视图", path: "views/chapters" },
  { key: "professional-views", label: "专业图形", path: "professional-views" },
  { key: "materials", label: "本书资料", path: "cards" },
  { key: "knowledge", label: "知识与参考", path: "knowledge" },
  { key: "settings", label: "本书设置", path: "fields" },
  { key: "history", label: "整书历史", path: "history" },
  { key: "completion", label: "完本与导出", path: "completion" },
] as const;

export type BookTaskNavKey = (typeof BOOK_TASK_NAV)[number]["key"];

export interface BookNavigationGroup {
  key: string;
  label: string;
  defaultPath: string;
  sections: readonly { key: string; label: string; items: readonly BookTaskNavKey[] }[];
}

// Group existing source pages without introducing a second set of business routes.
export const BOOK_NAV_GROUPS: readonly BookNavigationGroup[] = [
  { key: "overview", label: "创作概览", defaultPath: "overview", sections: [
    { key: "progress", label: "进度与下一步", items: ["overview"] },
  ] },
  { key: "direction", label: "创作方向", defaultPath: "setting", sections: [
    { key: "direction", label: "本书创作方向", items: ["direction"] },
  ] },
  { key: "setting", label: "② 故事设定", defaultPath: "story-setting", sections: [
    { key: "setting", label: "设定档案", items: ["story-setting"] },
  ] },
  { key: "production", label: "③ 故事规划", defaultPath: "planning", sections: [
    { key: "content", label: "规划与正文", items: ["planning", "composition", "writing"] },
  ] },
  { key: "analysis", label: "查看与分析", defaultPath: "views/chapters", sections: [
    { key: "analysis", label: "查看与分析", items: ["views"] },
  ] },
  { key: "director", label: "全书导演", defaultPath: "director", sections: [
    { key: "director", label: "全书导演", items: ["director"] },
  ] },
  { key: "completion", label: "完本与导出", defaultPath: "completion", sections: [
    { key: "delivery", label: "作品交付", items: ["history", "completion"] },
  ] },
];

// Auxiliary pages belong to a creative step even when they are not directory entries.
export function bookNavigationPage(active:BookTaskNavKey):BookTaskNavKey {
  if (["world","characters","materials","knowledge","character-dialogue","visual-assets"].includes(active)) return "story-setting";
  if (active === "professional-views") return "views";
  return active;
}

export function bookNavigationGroup(active: BookTaskNavKey): BookNavigationGroup | undefined {
  return BOOK_NAV_GROUPS.find(group => group.sections.some(section => section.items.includes(bookNavigationPage(active))));
}

export function isNewDesignAdvancedPath(pathname: string): boolean {
  return pathname.startsWith("/new-design/structure/");
}
