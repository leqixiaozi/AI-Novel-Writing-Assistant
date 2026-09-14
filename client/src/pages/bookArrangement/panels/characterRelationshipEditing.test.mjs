import test from "node:test";
import assert from "node:assert/strict";
import {
  characterRelationDraftError,
  toCharacterRelationDraft,
} from "./characterRelationshipEditing.ts";

const relation = {
  id: "relation-1",
  novelId: "novel-1",
  sourceCharacterId: "character-1",
  targetCharacterId: "character-2",
  surfaceRelation: "临时搭档",
  hiddenTension: "互相试探",
  conflictSource: null,
  secretAsymmetry: "一方知道旧案",
  dynamicLabel: "合作中",
  nextTurnPoint: null,
  createdAt: "2026-09-14T00:00:00.000Z",
  updatedAt: "2026-09-14T00:00:00.000Z",
};

test("关系快速编辑只提取可安全修改的关系字段", () => {
  assert.deepEqual(toCharacterRelationDraft(relation), {
    surfaceRelation: "临时搭档",
    hiddenTension: "互相试探",
    conflictSource: "",
    secretAsymmetry: "一方知道旧案",
    dynamicLabel: "合作中",
    nextTurnPoint: "",
  });
});

test("表层关系不能为空，其余字段允许留空", () => {
  const draft = toCharacterRelationDraft(relation);
  assert.equal(characterRelationDraftError(draft), "");
  assert.equal(characterRelationDraftError({ ...draft, surfaceRelation: "  " }), "表层关系不能为空。");
});
