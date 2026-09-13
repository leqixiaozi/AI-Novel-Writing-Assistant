const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { loadRuntimeSource } = require("./novelProduction/sourceHarness.cjs");
const root = path.resolve(__dirname, "../src");
const load = (file, imports) => loadRuntimeSource(path.join(root, file), imports);
const errors = load("middleware/errorHandler.ts", { zod: require("zod") });
const contracts = load("modules/novel/adjustments/domain/contracts.ts", { "node:crypto": require("node:crypto"), zod: require("zod"), "../../../../middleware/errorHandler": errors });
const { WritingContentService } = load("modules/novel/adjustments/application/WritingContentService.ts", {
  "node:crypto": require("node:crypto"),
  "../../../../middleware/errorHandler": errors,
  "../infrastructure/AdjustmentStore": {}, "./WritingSettingsService": {}, "../domain/contracts": contracts,
  "../../../../prompting/core/promptRunner": {},
  "../../../../prompting/prompts/novel/writingAdjustment.prompts": { writingAdjustmentGeneratePrompt: { id: "generate", version: "v1" } },
});
function fixture(quote) {
  const input = "码头场景保持原样。\n旅馆里掌柜回避问题。\n第二天远行也保持原样。";
  let modelCalls = 0, stored;
  const store = {
    db: { chapterPlanScene: { findFirst: async () => ({ id: "scene-inn", title: "旅馆对话", objective: "询问信件" }) } },
    chapter: async () => ({ id: "chapter", content: input }),
    createVersion: async value => { stored = value; return { id: "candidate", ...value }; },
  };
  const requirements = { id: "req", scope: { kind: "scene", chapterId: "chapter", sceneId: "scene-inn" }, baseRevisions: { chapter: "base" }, dependencyRevision: "dependencies" };
  const service = new WritingContentService(store, { load: async () => requirements, prompt: async () => "tension=0" }, {
    locateScene: async value => { assert.equal(value.content, input); assert.match(value.contextText, /scene-inn/); return { quote, reason: "unique matching scene" }; },
    generate: async value => { modelCalls++; assert.equal(value.content, quote); return "旅馆里，掌柜摇头，仍不回答。"; },
  });
  service.context = async () => "existing chapter context";
  return { service, input, modelCalls: () => modelCalls, stored: () => stored };
}
test("scene adjustment rewrites only the uniquely located scene and preserves both adjacent scenes", async () => {
  const f = fixture("旅馆里掌柜回避问题。");
  const versions = await f.service.generate("novel", "chapter", { requirementsId: "req", operation: "rewrite", content: f.input });
  assert.equal(versions[0].content, "码头场景保持原样。\n旅馆里，掌柜摇头，仍不回答。\n第二天远行也保持原样。");
  assert.equal(f.modelCalls(), 1);
  assert.equal(f.stored().metadata.sceneId, "scene-inn");
  assert.equal(f.stored().metadata.selection.text, "旅馆里掌柜回避问题。");
  assert.deepEqual(f.stored().operationResult(versions[0]), versions);
});
test("missing or fabricated scene boundaries do not fall back to rewriting the chapter", async () => {
  for (const quote of ["", "这段场景不在当前正文里"]) {
    const f = fixture(quote);
    await assert.rejects(f.service.generate("novel", "chapter", { requirementsId: "req", operation: "rewrite", content: f.input }), error => error.statusCode === 409);
    assert.equal(f.modelCalls(), 0);
    assert.equal(f.stored(), undefined);
  }
});
