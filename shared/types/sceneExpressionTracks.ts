export const SCENE_EXPRESSION_DIMENSION_KEYS = [
  "scene_pace",
  "sentence_cadence",
  "detail_expansion",
  "camera_distance",
  "language_ornament",
] as const;

export type SceneExpressionDimensionKey = typeof SCENE_EXPRESSION_DIMENSION_KEYS[number];
export type SceneExpressionLevel = 1 | 2 | 3 | 4 | 5;

export interface SceneExpressionBandDefinition {
  level: SceneExpressionLevel;
  name: string;
  instruction: string;
}

export interface SceneExpressionDimensionDefinition {
  key: SceneExpressionDimensionKey;
  label: string;
  description: string;
  color: "blue" | "orange" | "violet" | "teal" | "rose";
  bands: readonly SceneExpressionBandDefinition[];
  invariants: readonly string[];
  promptAssetKey: "novel.scene.expression_controls";
}

const dimension = (
  value: Omit<SceneExpressionDimensionDefinition, "promptAssetKey">,
): SceneExpressionDimensionDefinition => ({ ...value, promptAssetKey: "novel.scene.expression_controls" });

export const SCENE_EXPRESSION_DIMENSIONS: readonly SceneExpressionDimensionDefinition[] = [
  dimension({ key: "scene_pace", label: "场景节奏", description: "控制已有内容的展开、停顿、转场和行动—反应衔接速度。", color: "blue", bands: [
    { level: 1, name: "充分舒展", instruction: "完整展开已有观察、动作过程、人物反应和余韵，不新增事件填充篇幅。" },
    { level: 2, name: "舒展推进", instruction: "保留较充分的过程和反应空间，转场不过急，不重复解释。" },
    { level: 3, name: "均衡推进", instruction: "让已有行动、反应和结果均衡交替，不扩成散文，也不压成梗概。" },
    { level: 4, name: "紧凑推进", instruction: "压缩重复说明、无作用停顿和冗余过渡，让相邻动作衔接更快。" },
    { level: 5, name: "高度紧凑", instruction: "使用集中段落和直接衔接完成同一事件链，仍保留必要因果与反应。" },
  ], invariants: ["不得增删或调换事件", "不得跳过必要因果", "不得用新冲突制造快节奏"] }),
  dimension({ key: "sentence_cadence", label: "句段节拍", description: "控制句子长短、段落切换和语流的连续或短促程度。", color: "orange", bands: [
    { level: 1, name: "连绵舒缓", instruction: "以完整连贯的句群组织已有内容，段落停留更稳定。" },
    { level: 2, name: "偏长平稳", instruction: "长句和完整段落稍多，保留自然变化，避免拖沓。" },
    { level: 3, name: "长短均衡", instruction: "长短句和段落切换按语义自然分配。" },
    { level: 4, name: "短句明快", instruction: "提高短句和短段比例，让动作与判断落点更清楚。" },
    { level: 5, name: "短促跳切", instruction: "使用短促句段和快速落点形成强节拍，但不得碎裂到难以理解。" },
  ], invariants: ["不得删减必要信息", "不得制造无意义断句", "不得改变事件推进来代替语言节拍"] }),
  dimension({ key: "detail_expansion", label: "细节展开", description: "控制已有动作、环境、物件和感官依据的展开程度。", color: "violet", bands: [
    { level: 1, name: "必要交代", instruction: "只写理解动作、环境和结果所必需的已有细节。" },
    { level: 2, name: "轻量点染", instruction: "在必要交代之外选择少量有依据的动作或环境细节。" },
    { level: 3, name: "均衡描写", instruction: "在推进和细节之间保持均衡，完整呈现关键过程。" },
    { level: 4, name: "充分展开", instruction: "充分展开已有动作过程、环境反馈和感官依据，不改变事实。" },
    { level: 5, name: "重点特写", instruction: "对场景任务已经确认的重要过程或物件作集中描写。" },
  ], invariants: ["不得新增物件、证据或环境规则", "不得新增人物能力", "不得加入影响推理方向的信息"] }),
  dimension({ key: "camera_distance", label: "镜头距离", description: "控制叙述对当前视角人物已有感知的贴近程度。", color: "teal", bands: [
    { level: 1, name: "客观远景", instruction: "以整体动作和可见结果为主，减少贴身感知停留。" },
    { level: 2, name: "外部观察", instruction: "以人物外部表现为主，少量承接当前视角允许的感知。" },
    { level: 3, name: "中距跟随", instruction: "外部行动与当前视角人物已有感知保持均衡。" },
    { level: 4, name: "贴近感知", instruction: "更多通过当前视角人物的即时注意、身体感受和判断呈现场景。" },
    { level: 5, name: "沉浸贴身", instruction: "持续贴近当前视角人物已有感知组织场景，但不扩张知情权限。" },
  ], invariants: ["不得切换人称或视角人物", "不得进入无权知道的内心", "不得把推测写成事实"] }),
  dimension({ key: "language_ornament", label: "语言修饰度", description: "控制本书基础文风内直述、修饰和意象的程度。", color: "rose", bands: [
    { level: 1, name: "朴素直述", instruction: "使用清楚直接的词句表达已有内容，减少装饰性修辞。" },
    { level: 2, name: "少量修饰", instruction: "在关键位置加入少量自然修饰，整体保持克制。" },
    { level: 3, name: "自然均衡", instruction: "直述和修饰按场景需要自然分配，服从本书基础文风。" },
    { level: 4, name: "鲜明生动", instruction: "使用较鲜明的措辞、节奏和意象强化已有感受。" },
    { level: 5, name: "浓郁意象", instruction: "在不影响理解和事实的前提下提高意象与修辞浓度。" },
  ], invariants: ["不得模仿具体作者", "不得用比喻确认新事实", "不得覆盖本书文风或人物口吻"] }),
] as const;

export function sceneExpressionDefinition(key: SceneExpressionDimensionKey) {
  return SCENE_EXPRESSION_DIMENSIONS.find(item => item.key === key);
}

export function sceneExpressionBand(key: SceneExpressionDimensionKey, level?: SceneExpressionLevel) {
  return level === undefined ? undefined : sceneExpressionDefinition(key)?.bands.find(item => item.level === level);
}

export interface SceneExpressionPoint {
  id: string;
  novelId: string;
  sceneId: string;
  dimensionKey: SceneExpressionDimensionKey;
  level: SceneExpressionLevel;
  note: string | null;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface SceneExpressionPointInput {
  sceneId: string;
  dimensionKey: SceneExpressionDimensionKey;
  level: SceneExpressionLevel;
  note?: string | null;
}

export interface SceneExpressionPointSaveRequest {
  expectedRevision: string;
  enabled: boolean;
  points: SceneExpressionPointInput[];
}

export interface SceneExpressionPointSaveReceipt {
  revision: string;
  enabled: boolean;
  points: SceneExpressionPoint[];
}
