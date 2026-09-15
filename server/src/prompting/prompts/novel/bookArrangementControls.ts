import type { BookArrangementCharacterSpan } from "@ai-novel/shared/types/bookArrangement";

/** Governed deterministic fragment for explicitly structured author configuration. */
export const BOOK_ARRANGEMENT_CONTROL_VERSION = "v1";
const PARTICIPATION_RULES = {
  must: "必须参与本章；若与已确认事实或保留剧情冲突，先指出冲突，不补造历史。",
  suggested: "建议参与，服从本章已有剧情安排。",
  indirect: "仅以提及、回忆或线索等方式间接出现，不安排本人直接出场。",
  forbidden: "本章不得安排该人物直接出场；保留已确认的历史事实。",
} as const;

/** No intent classification or model call: renders validated enum/ID selections. */
export function renderBookArrangementPreserve(note: string, spans: Array<BookArrangementCharacterSpan & { characterName: string }>): string[] {
  const preserve = note.trim() ? [`本章编排要求：${note.trim()}`] : [];
  for (const span of spans) {
    const focus = span.weight === null ? "" : ["只做必要交代，保留其已有行动。", "给少量动作或反应描写。", "均衡呈现其已有行动与反应。", "优先描写其已有动作、反应和处境。", "持续围绕其感知与行动组织镜头，不改变他人的行动归属。"][Math.min(4, Math.floor(span.weight / 25 + .5))];
    preserve.push(`人物编排：${span.characterName}（人物 ID：${span.characterId}）。${PARTICIPATION_RULES[span.mode]}${focus}${span.note.trim() ? `作者备注：${span.note.trim()}` : ""}`);
  }
  return preserve;
}
