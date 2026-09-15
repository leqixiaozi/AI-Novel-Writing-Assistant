import type { BookViewKey, CardGroupFormSummary, CardGroupFormVersion, CardSummary, CardTypeSummary, FieldDefinition } from "../../common/contracts";

export type BusinessFormScope = "overview" | "all" | BookViewKey;

const SCOPE_TYPE_KEYS: Record<BusinessFormScope, string[]> = {
  overview: ["project_rule", "story_idea", "theme", "genre_strategy", "progression_mode", "writing_config", "quality_rule"],
  characters: ["character"],
  world: ["world_setting", "world_rule", "time_rule", "location", "faction", "organization", "prop", "power_system", "race", "culture", "religion"],
  events: ["event", "goal_task", "conflict", "plotline", "plot_beat", "arc", "secret_truth"],
  chapters: ["volume_plan", "chapter_plan", "scene_plan", "volume", "chapter", "scene"],
  clues: ["foreshadow_clue", "clue_evidence", "foreshadow", "suspense_question", "secret_truth"],
  resources: ["research_note", "reference_pack", "market_signal", "book_analysis"],
  all: [],
};

export const SCOPE_COPY: Record<BusinessFormScope, { eyebrow: string; title: string; description: string }> = {
  overview: { eyebrow: "创作概览", title: "开书规划", description: "按创作顺序填写作品约定、故事构思和主题方向。" },
  characters: { eyebrow: "人物", title: "人物档案", description: "集中维护人物身份、外在表现、内核与当前状态。" },
  world: { eyebrow: "世界设定", title: "世界资料", description: "维护世界观、地点、势力、道具与不可违背的规则。" },
  events: { eyebrow: "剧情与事件", title: "事件规划", description: "从事件事实、冲突和剧情线组织故事推进。" },
  chapters: { eyebrow: "章节", title: "章节规划", description: "按卷、章、场景逐层维护可写作的章节资料。" },
  clues: { eyebrow: "线索与伏笔", title: "线索规划", description: "维护线索内容、信息差、埋设与回收状态。" },
  resources: { eyebrow: "创作资源", title: "本书参考资料", description: "查看已经进入本书并可继续修改的正式资料。" },
  all: { eyebrow: "本书资料", title: "全部创作资料", description: "按内容类型查找、填写和维护本书的正式资料。" },
};

const BUSINESS_TITLES: Record<string, string> = {
  character: "人物档案",
  event: "事件规划",
  world_setting: "世界设定",
  world_rule: "世界规则",
  location: "地点档案",
  faction: "组织与势力",
  organization: "组织与势力",
  prop: "道具档案",
  chapter: "章节资料",
  chapter_plan: "章节规划",
  clue_evidence: "线索档案",
  foreshadow: "伏笔档案",
  foreshadow_clue: "线索与伏笔",
};

const GROUP_ALIASES: Record<string, Record<string, string>> = {
  character: {
    "基本信息": "基本信息", "外在表现": "外在表现", "内在驱动力": "人物内核", "人物内核": "人物内核",
    "状态": "当前状态", "当前状态": "当前状态", "关联": "关联资料", "关联资料": "关联资料",
  },
  event: {
    "基本信息": "基本信息", "时间位置": "故事时间", "故事时间": "故事时间", "参与者": "参与人物",
    "地点": "发生地点", "道具": "涉及道具", "事件过程": "前因后果", "结果": "前因后果", "状态": "局部目标",
  },
};

const GROUP_ORDER: Record<string, string[]> = {
  character: ["基本信息", "外在表现", "人物内核", "当前状态", "关联资料", "补充信息"],
  event: ["基本信息", "故事时间", "参与人物", "发生地点", "涉及道具", "前因后果", "局部目标", "补充信息"],
  world_setting: ["世界基础", "空间与社会", "文化与规则", "关联资料", "补充信息"],
  location: ["基本信息", "空间体验", "剧情作用", "关联资料", "补充信息"],
  faction: ["基本信息", "目标与资源", "冲突", "关联资料", "补充信息"],
  organization: ["基本信息", "目标与资源", "冲突", "关联资料", "补充信息"],
  prop: ["基本信息", "表现", "背景", "能力规则", "状态", "关联资料", "补充信息"],
  chapter: ["基本信息", "章节目标", "内容规划", "状态", "关联资料", "补充信息"],
  chapter_plan: ["基本信息", "章节目标", "内容规划", "状态", "关联资料", "补充信息"],
  clue_evidence: ["基本信息", "内容", "信息流转", "生命周期", "关联资料", "补充信息"],
  foreshadow: ["基本信息", "内容", "推进计划", "生命周期", "关联资料", "补充信息"],
  foreshadow_clue: ["基本信息", "内容", "推进计划", "状态", "关联资料", "补充信息"],
};

export interface FormResolution {
  title: string;
  source: "installed_form" | "type_schema" | "system_default" | "generic";
  sourceLabel: string;
  formId: string | null;
  formVersion: number | null;
  typeVersion: number;
  fields: FieldDefinition[];
}

export function typesForScope(types: CardTypeSummary[], scope: BusinessFormScope): CardTypeSummary[] {
  const published = types.filter((type) => type.status === "published" && type.currentVersionId);
  if (scope === "all") return published;
  const rank = new Map(SCOPE_TYPE_KEYS[scope].map((key, index) => [key, index]));
  return published.filter((type) => rank.has(type.key)).sort((a, b) => (rank.get(a.key) ?? 999) - (rank.get(b.key) ?? 999));
}

function presentFields(type: CardTypeSummary, fields: FieldDefinition[]): FieldDefinition[] {
  const aliases = GROUP_ALIASES[type.key] ?? {};
  const order = GROUP_ORDER[type.key] ?? [];
  return fields.map((field) => {
    const group = aliases[field.group] ?? (field.group.trim() || "补充信息");
    const groupIndex = order.indexOf(group);
    return { ...field, group, order: (groupIndex < 0 ? order.length : groupIndex) * 1000 + field.order };
  });
}

export function resolveBusinessForm(type: CardTypeSummary, fields: FieldDefinition[], forms: CardGroupFormSummary[], versionsByForm: Map<string, CardGroupFormVersion[]>): FormResolution {
  const installed = forms.find((form) => {
    const published = versionsByForm.get(form.id)?.find((version) => version.id === form.currentVersionId);
    return form.status === "published" && published?.definition.primaryTypeKey === type.key;
  });
  const hasSchemaLayout = fields.some((field) => field.group.trim());
  const hasMatureDefault = Boolean(GROUP_ORDER[type.key]);
  const source: FormResolution["source"] = installed ? "installed_form" : hasSchemaLayout ? "type_schema" : hasMatureDefault ? "system_default" : "generic";
  const sourceLabel = installed
    ? `${installed.name} v${installed.currentVersion}`
    : source === "type_schema" ? `内容规格 v${type.currentVersion}`
      : source === "system_default" ? "系统默认布局" : "通用安全布局";
  return {
    title: installed?.name ?? BUSINESS_TITLES[type.key] ?? type.name,
    source,
    sourceLabel,
    formId: installed?.id ?? null,
    formVersion: installed?.currentVersion ?? null,
    typeVersion: type.currentVersion ?? 0,
    fields: presentFields(type, fields),
  };
}

export function defaultValues(fields: FieldDefinition[]): Record<string, unknown> {
  return Object.fromEntries(fields.filter((field) => field.defaultValue !== undefined).map((field) => [field.key, field.defaultValue]));
}

export function cardsForType(cards: CardSummary[], type: CardTypeSummary): CardSummary[] {
  return cards.filter((card) => card.cardTypeId === type.id && card.status === "active");
}
