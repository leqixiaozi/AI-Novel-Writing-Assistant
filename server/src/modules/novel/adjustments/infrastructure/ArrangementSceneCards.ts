import { parseChapterScenePlan, serializeChapterScenePlan } from "@ai-novel/shared/types/chapterLengthControl";

type Scene = { id: string; title: string; objective: string | null; conflict: string | null; reveal: string | null; emotionBeat: string | null };
type Snapshot = { chapterId: string; sceneCards: string | null; scenes: Scene[] };

export function hasCanonicalArrangementSceneCards(raw: string | null): boolean { return Boolean(parseChapterScenePlan(raw)); }
export function hasUnmappedArrangementSceneCards(raw: string | null, scenes: Scene[]): boolean {
  const canonical = parseChapterScenePlan(raw);
  return Boolean(canonical && (canonical.scenes.length !== scenes.length || scenes.some((scene, index) => !canonical.scenes.some(card => card.key === scene.id) && canonical.scenes[index]?.title !== scene.title)));
}

export function synchronizeArrangementSceneCards(chapterId: string, scenes: Scene[], snapshots: Snapshot[]): string {
  const previous = snapshots.find(snapshot => snapshot.chapterId === chapterId);
  const canonical = parseChapterScenePlan(previous?.sceneCards);
  const known = new Map<string, Record<string, any>>();
  for (const snapshot of snapshots) {
    let raw: any;
    try { raw = JSON.parse(snapshot.sceneCards ?? "null"); } catch { continue; }
    const cards = Array.isArray(raw) ? raw : raw?.scenes;
    if (!Array.isArray(cards)) continue;
    for (const [index, old] of snapshot.scenes.entries()) {
      const card = cards.find((card: any) => card.key === old.id) ?? (cards[index]?.title === old.title ? cards[index] : null);
      if (card) known.set(old.id, card);
    }
  }
  const cards: Array<Record<string, any>> = scenes.map(scene => {
    const old = snapshots.flatMap(snapshot => snapshot.scenes).find(old => old.id === scene.id);
    const preserved = known.get(scene.id) ?? (canonical ? {
      mustAdvance: [], mustPreserve: [], entryState: scene.objective || scene.title,
      exitState: scene.reveal || scene.emotionBeat || scene.objective || scene.title,
      forbiddenExpansion: [], targetWordCount: Math.max(1, Math.round(canonical.targetWordCount / scenes.length)),
      readerValue: "",
    } : undefined);
    const oldAdvances = new Set([old?.objective, old?.conflict, old?.reveal].filter(Boolean));
    const changed = !old || ["objective", "conflict", "reveal"].some(key => old[key as keyof Scene] !== scene[key as keyof Scene]);
    return {
      ...preserved, key: scene.id, title: scene.title,
      purpose: !preserved || !old || old.objective !== scene.objective ? scene.objective || scene.reveal || scene.title : preserved.purpose ?? scene.objective ?? scene.title,
      ...(preserved ? {
        exitState: (changed || old?.emotionBeat !== scene.emotionBeat) && [old?.reveal, old?.emotionBeat, old?.objective].filter(Boolean).includes(preserved.exitState) ? scene.reveal || scene.emotionBeat || scene.objective || scene.title : preserved.exitState,
        entryState: old?.objective && old.objective !== scene.objective && preserved.entryState === old.objective ? scene.objective || scene.title : preserved.entryState,
        mustAdvance: changed ? [...new Set([...(preserved.mustAdvance ?? []).filter((item: string) => !oldAdvances.has(item)), ...[scene.objective, scene.conflict, scene.reveal].filter(Boolean)])] : preserved.mustAdvance,
        resistance: !old || old.conflict !== scene.conflict ? scene.conflict ?? "" : preserved.resistance ?? "",
        turn: !old || old.reveal !== scene.reveal ? scene.reveal ?? "" : preserved.turn ?? "",
        emotionalShift: !old || old.emotionBeat !== scene.emotionBeat ? scene.emotionBeat ?? "" : preserved.emotionalShift ?? "",
      } : { objective: scene.objective, conflict: scene.conflict, reveal: scene.reveal, emotionBeat: scene.emotionBeat }),
    };
  });
  if (canonical && cards.every(card => typeof card.targetWordCount === "number")) {
    return serializeChapterScenePlan({ ...canonical, scenes: cards as typeof canonical.scenes });
  }
  // Legacy plans without a complete length contract remain explicit scene data, not invented budgets.
  return JSON.stringify({ scenes: cards });
}
