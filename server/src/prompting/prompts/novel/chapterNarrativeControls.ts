export interface NumericNarrativeControl {
  rawValue: number;
}

export interface SuspicionTargetControl extends NumericNarrativeControl {
  subject: string;
  object: string;
  matter: string;
}

export interface DialogueDirectnessControl extends NumericNarrativeControl {
  speaker: string;
  listener: string;
}

export interface CharacterProminenceControl extends NumericNarrativeControl {
  character: string;
}

export interface ChapterNarrativeControls {
  pace?: NumericNarrativeControl | null;
  tension?: NumericNarrativeControl | null;
  suspicionTarget?: SuspicionTargetControl | null;
  dialogueDirectness?: DialogueDirectnessControl | null;
  characterProminence?: CharacterProminenceControl | null;
}

type NarrativeControlKey =
  | "pace"
  | "tension"
  | "suspicion_target"
  | "dialogue_directness"
  | "character_prominence";

interface NarrativeControlBand {
  name: string;
  instruction: string;
}

interface NarrativeControlDefinition {
  label: string;
  evidenceFocus: string;
  antiMisread: string;
  bands: readonly NarrativeControlBand[];
}

const CONTROL_DEFINITIONS: Record<NarrativeControlKey, NarrativeControlDefinition> = {
  pace: {
    label: "叙述节奏",
    evidenceFocus: "只检查同一事件链的展开篇幅、停顿、段落衔接和行动—反应节拍；不得用事件数量变化证明节奏。",
    antiMisread: "节奏只调整既定内容的展开与压缩，不增删事件，不调换顺序，不跳过必要因果，也不靠重复文字制造舒缓感。",
    bands: [
      { name: "充分舒展", instruction: "完整保留既定事件链，并充分展开其中已经成立的观察、动作过程、人物反应和余韵。同一件事可以写得更从容，但不得新增行为、信息或结果来填充篇幅。" },
      { name: "舒展推进", instruction: "保持同一事件链，在既定行动之间多留一点观察、反应和理解空间。过程写清楚，转场不过急；不重复解释，也不延迟已经确定的决定。" },
      { name: "均衡推进", instruction: "保持同一事件链，让既定行动、反应和结果均衡交替。过程与变化都写清楚，不额外扩写，也不压缩成梗概。" },
      { name: "紧凑推进", instruction: "保持全部既定事件、顺序和结果，压缩重复说明、无作用停顿和已充分表达的犹豫，让相邻动作与反应衔接更快。" },
      { name: "高度紧凑", instruction: "保持全部既定事件、顺序、因果和必要反应，用更短的过渡、更集中的段落和更直接的衔接完成同一内容。不得删事件、跳因果或添加新变化冒充速度。" },
    ],
  },
  tension: {
    label: "紧张感表达",
    evidenceFocus: "只检查文字对既有压力、未知结果和人物感受的强调程度，不检查是否增加了危险或冲突。",
    antiMisread: "紧张感只来自已经确定的处境，不提高客观危险，不改变代价、期限和结果，不新增威胁、追逐、冲突或反转。",
    bands: [
      { name: "平稳表达", instruction: "如实写出既定处境，但使用稳定的叙述节拍和克制的感官关注，不额外放大未知或后果。已有危险仍必须保留，不能用轻松措辞抹掉。" },
      { name: "轻微不安感", instruction: "在不改变事件的前提下，通过短暂停顿、注意偏移或尚未解决的感觉，轻轻强调上下文已经存在的不确定性。" },
      { name: "明确压力感", instruction: "让读者清楚感到既有阻碍、未知结果或代价正在压住当前场面；通过句段节拍、视线和反应强调，不增加新的压力来源。" },
      { name: "强烈紧迫感", instruction: "集中书写已经存在的期限、冲突或选择压力，减少舒缓性旁逸，让相关感官和反应更靠近当前行动，但所有客观条件保持不变。" },
      { name: "临界压迫感", instruction: "用更贴近当下的感知、更短的反应间隔和更集中的段落，最大化呈现既有关键关口的压迫感。不得提高客观危险、扩大后果或创造新的危机。" },
    ],
  },
  suspicion_target: {
    label: "疑点强调度",
    evidenceFocus: "只检查既定疑点在叙述位置、停顿、反应和复现上的显眼程度，不检查人物是否采取了更多行动。",
    antiMisread: "只强调已有疑点，不改变谁怀疑谁、为何怀疑或怀疑后的行动；不得新造异常、证据、判断、验证结果或秘密真相。",
    bands: [
      { name: "轻描", instruction: "保留故事层已经确定的疑点和相关反应，但只自然带过一次，不额外特写、重复或解释其意义。" },
      { name: "略作提示", instruction: "让既定疑点获得一次短暂停留或可察觉的反应，使读者能注意到，但不改变对白、行动和判断结果。" },
      { name: "清晰强调", instruction: "通过叙述位置、停顿或既定反应清楚突出已有疑点，让读者知道它值得留意；不增加证据，不改变人物下一步。" },
      { name: "重点强调", instruction: "让已有疑点在场面中占据明显注意力，可通过段落落点和既定反应反复照亮，但每次都只能使用已经给出的信息。" },
      { name: "核心强调", instruction: "把已有疑点作为本段表达中心，通过开合位置、句段节拍和既定人物反应持续聚焦。故事层的怀疑关系、证据、行动和结论全部保持不变。" },
    ],
  },
  dialogue_directness: {
    label: "对白直白度",
    evidenceFocus: "检查同一沟通意图和信息内容是由明说、暗示、语境、动作还是停顿承担；不按对白长短或数量判断。",
    antiMisread: "只改对白措辞和潜台词显隐，保持同一沟通意图、信息内容、决定和结果；直白不等于全说，含蓄不等于新增隐瞒。",
    bands: [
      { name: "高度含蓄", instruction: "用语境、停顿、动作和言外之意表达既定沟通内容。读者仍应有足够线索理解，不能把已确定的信息删掉或改成谜语。" },
      { name: "多用暗示", instruction: "把既定沟通内容写成可理解的暗示、侧说或部分明说；人物意图和最终传达的信息保持不变。" },
      { name: "半明半暗", instruction: "让同一沟通内容一部分明确说出、一部分由语境承担。根据人物口吻自然分配，不改变信息量和对话结果。" },
      { name: "大多直说", instruction: "把既定诉求和立场大多明确说出，减少无意义绕弯。仍须保持同一知情范围、保密内容、决定和交流结果。" },
      { name: "明确直说", instruction: "用清楚直接的措辞表达既定目的、要求、决定或拒绝，不用旁白替对白解释。只能改说法，不能增加披露内容或改变结果。" },
    ],
  },
  character_prominence: {
    label: "人物聚焦度",
    evidenceFocus: "只检查镜头、感知细节、动作描写和段落落点对指定人物的关注程度，不统计其新增了多少行为。",
    antiMisread: "只调整叙事镜头，不改变行动、决定、成果或后果的归属；不得新增出场、对白、能力、关系变化或视角权限。",
    bands: [
      { name: "背景镜头", instruction: "保留指定人物已经确定的全部出场、行动和对白，但叙述只做必要交代，不增加特写，也不删除其必须完成的内容。" },
      { name: "少量聚焦", instruction: "在既定出场和行动中给指定人物少量镜头，通过一个动作、表情或段落落点体现存在，不新增行为或对白。" },
      { name: "均衡聚焦", instruction: "在既定内容中让指定人物与其他人物获得均衡的叙事关注，完整写出其已有反应和作用，不要求均分字数。" },
      { name: "重点聚焦", instruction: "优先从指定人物已经存在的动作、反应和处境中选择描写落点，让读者更关注此人；行动归属和故事结果保持不变。" },
      { name: "中心聚焦", instruction: "让叙事镜头持续围绕指定人物已有的感知、动作和反应组织同一场面，但不得把别人的决定转交给此人，也不得新增其行动、对白或成果。" },
    ],
  },
};

function requireLabel(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`narrative control ${field} is required`);
  }
  return normalized;
}

function resolveBand(rawValue: number, key: NarrativeControlKey): { level: number; band: NarrativeControlBand } {
  if (!Number.isFinite(rawValue) || rawValue < 0 || rawValue > 100) {
    throw new Error(`narrative control ${key} rawValue must be a finite number from 0 to 100`);
  }
  const level = Math.min(5, Math.floor(rawValue / 25 + 0.5) + 1);
  return { level, band: CONTROL_DEFINITIONS[key].bands[level - 1] };
}

function renderControl(
  key: NarrativeControlKey,
  control: NumericNarrativeControl,
  objectLine?: string,
): string {
  const definition = CONTROL_DEFINITIONS[key];
  const { level, band } = resolveBand(control.rawValue, key);
  return [
    `【${key}／${definition.label}】`,
    objectLine ? `对象：${objectLine}` : "",
    `原值：${control.rawValue} / 100；有效档：L${level}／${band.name}`,
    `执行：${band.instruction}`,
    `禁止误读：${definition.antiMisread}`,
    `内部检查：${definition.evidenceFocus}`,
  ].filter(Boolean).join("\n");
}

export function buildChapterNarrativeControlBlock(controls?: ChapterNarrativeControls | null): string {
  if (!controls) {
    return "";
  }

  const blocks: string[] = [];
  if (controls.pace) {
    blocks.push(renderControl("pace", controls.pace));
  }
  if (controls.tension) {
    blocks.push(renderControl("tension", controls.tension));
  }
  if (controls.suspicionTarget) {
    const subject = requireLabel(controls.suspicionTarget.subject, "suspicionTarget.subject");
    const object = requireLabel(controls.suspicionTarget.object, "suspicionTarget.object");
    const matter = requireLabel(controls.suspicionTarget.matter, "suspicionTarget.matter");
    blocks.push(renderControl(
      "suspicion_target",
      controls.suspicionTarget,
      `${subject} → ${object}；事项：${matter}`,
    ));
  }
  if (controls.dialogueDirectness) {
    const speaker = requireLabel(controls.dialogueDirectness.speaker, "dialogueDirectness.speaker");
    const listener = requireLabel(controls.dialogueDirectness.listener, "dialogueDirectness.listener");
    blocks.push(renderControl(
      "dialogue_directness",
      controls.dialogueDirectness,
      `${speaker} → ${listener}`,
    ));
  }
  if (controls.characterProminence) {
    const character = requireLabel(controls.characterProminence.character, "characterProminence.character");
    blocks.push(renderControl(
      "character_prominence",
      controls.characterProminence,
      character,
    ));
  }

  if (blocks.length === 0) {
    return "";
  }

  return [
    "【本章写法与节奏控制】",
    "以下档位是表达方式的柔性目标，不是剧情指令，也不代表文学质量高低。",
    "总原则：只改变表达，不改变故事。请把它理解为对同一份剧情采用不同讲述和剪辑方式。",
    "故事内容锁定：不得新增、删除、合并或调换事件，不得改变人物出场、行动、决定、线索内容、因果关系与场景结果。",
    "chapter mission、硬事实、知情范围、出场安排、伏笔操作和必达项优先；若控制目标与它们冲突，以硬约束为准。",
    "采用最小增补规则：不得自行补充会改变推理方向的姓名、日期、地点、身份、关系、物证内容或因果结论。",
    "上下文未提供的物件内容保持未知，或只补充不承载线索的表面细节；禁止把氛围细节写成新证据。",
    "不得补充未提供的数量、种类、可读文字、画面内容、附带物件或指向关系；这些都必须来自正式上下文。",
    "线索内容未给出时，只写角色查看、辨认、无法确认或作出待核实判断，不替作者决定线索具体长什么样、写了什么或证明什么。",
    "任务要求人物作出后续决定但没有提供因果桥时，可以写成基于现有疑问去核实，不得回填新证据来证明决定正确。",
    "无法在事实边界内达到目标档位时，保留既有事实并降低表现强度，不得用编造内容强行达档。",
    blocks.join("\n\n"),
  ].join("\n");
}
