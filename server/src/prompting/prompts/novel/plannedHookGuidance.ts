/** Optional context fragment for the existing registered planner and chapter writer prompts. */
export function renderPlannedHookGuidance(hooks: Array<{ id: string; title: string; description: string; setup: boolean; payoff: boolean }>): string {
  if (!hooks.length) return "";
  return [
    "本章线索铺设／预计回收目标（尚未实现）",
    "以下为作者计划，不是已经铺设、已经回收、人物知情或既定事实。铺设目标应在本章自然呈现；预计回收前须核对正文是否确已铺垫，缺少依据时保留待核对目标，不捏造历史。",
    ...hooks.map(hook => `- [${hook.id}] ${hook.setup ? "本章铺设" : ""}${hook.setup && hook.payoff ? "；" : ""}${hook.payoff ? "本章预计回收" : ""}：${hook.title}。${hook.description}`),
  ].join("\n");
}
