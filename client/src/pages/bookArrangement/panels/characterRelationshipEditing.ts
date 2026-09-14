import type { CharacterRelation } from "@ai-novel/shared/types/novel";

export type CharacterRelationQuickDraft = {
  surfaceRelation: string;
  hiddenTension: string;
  conflictSource: string;
  secretAsymmetry: string;
  dynamicLabel: string;
  nextTurnPoint: string;
};

export function toCharacterRelationDraft(relation: CharacterRelation): CharacterRelationQuickDraft {
  return {
    surfaceRelation: relation.surfaceRelation,
    hiddenTension: relation.hiddenTension ?? "",
    conflictSource: relation.conflictSource ?? "",
    secretAsymmetry: relation.secretAsymmetry ?? "",
    dynamicLabel: relation.dynamicLabel ?? "",
    nextTurnPoint: relation.nextTurnPoint ?? "",
  };
}

export function characterRelationDraftError(draft: CharacterRelationQuickDraft): string {
  return draft.surfaceRelation.trim() ? "" : "表层关系不能为空。";
}
