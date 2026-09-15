const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { loadRuntimeSource } = require("./novelProduction/sourceHarness.cjs");
const root = path.resolve(__dirname, "../src");
const load = (file, imports) => loadRuntimeSource(path.join(root, file), imports);
const errors = load("middleware/errorHandler.ts", { zod: require("zod") });
const contracts = load("modules/novel/adjustments/domain/contracts.ts", { "node:crypto": require("node:crypto"), zod: require("zod"), "../../../../middleware/errorHandler": errors });
const { WritingContentService: RawWritingContentService } = load("modules/novel/adjustments/application/WritingContentService.ts", {
  "node:crypto": require("node:crypto"),
  "../../../../prompting/prompts/novel/sceneExpressionControls": { renderSceneExpressionControls: () => "", compileLegacySceneExpressionLabels: value => value },
  "@ai-novel/shared/types/sceneExpressionTracks": require("@ai-novel/shared/types/sceneExpressionTracks"),
  "../../../../middleware/errorHandler": errors,
  "../infrastructure/AdjustmentStore": {}, "./WritingSettingsService": {}, "../domain/contracts": contracts,
  "../../../../prompting/core/promptRunner": {},
  "../../../../prompting/prompts/novel/writingAdjustment.prompts": { writingAdjustmentGeneratePrompt: { id: "generate", version: "v1" } },
});
class WritingContentService extends RawWritingContentService {
  constructor(store, settings, ai) { super(store, settings, ai ? { prepare: async () => ({ items: [] }), ...ai } : ai); }
}
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

test("adjustment context uses current planning and explicit chapter budget rather than stale plan history", async () => {
  let planQuery;
  const store = {
    chapter: async () => ({ id: "c", order: 1, targetWordCount: 2400, sceneCards: '{"scenes":[]}' }),
    novel: async () => ({ title: "Independent sample" }),
    writingBackground: async () => ({
      authorBackground: {},
      world: {},
      authorRelationBackground: [],
      chapterTasks: [],
      chapterRelationStages: [],
      usageBoundary: "test boundary",
    }),
    db: {
      chapter: { findMany: async () => [] }, character: { findMany: async () => [] },
      storyPlan: { findMany: async query => { planQuery = query; return []; } },
      creativeDecision: { findMany: async () => [] },
    },
  };
  const service = new WritingContentService(store, {});
  const context = JSON.parse(await service.context("n", "c"));
  assert.equal(planQuery.where.status.not, "stale");
  assert.equal(planQuery.where.level, "chapter");
  assert.deepEqual(planQuery.orderBy, [{ updatedAt: "desc" }, { id: "asc" }]);
  assert.equal(context.currentPlan.targetWordCount, 2400);
  assert.deepEqual(context.currentPlan.sceneCards, { scenes: [] });
});
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

test("fresh chapter writing omits old prose while rewrite keeps its source", async () => {
  for (const operation of ["write", "rewrite"]) {
    let captured;
    const service = new WritingContentService({
      chapter: async () => ({ content: "old draft with conflicting facts" }),
      createVersion: async value => value,
    }, {
      load: async () => ({ id: "r", scope: { kind: "chapter" }, baseRevisions: { c: "base" } }),
      prompt: async () => "current configuration",
    }, { generate: async input => { captured = input; return "new candidate"; }, review: async () => ({ summary: "checked", issues: [], checkedEvidenceIds: [], missingEvidence: [] }) });
    service.context = async () => "current plan";
    await service.generate("n", "c", { requirementsId: "r", operation });
    assert.equal(captured.content, operation === "write" ? undefined : "old draft with conflicting facts");
    assert.equal(captured.scope, "chapter");
  }
});

test("fresh writing extracts checks from numbered planning sources and reviews against compact requirements", async () => {
  let spine;
  const context = JSON.stringify({
    title: "book",
    authorBackground: { description: "unrelated global pitch" },
    world: { summary: "unrelated world encyclopedia" },
    currentPlan: {
      taskSheet: "完成当前章结果",
      mustAvoid: "only configured participants",
      sceneCards: { scenes: [{
        resistance: "遇到阻力",
        mustAdvance: ["完成当前章结果"],
        exitState: "场景结果落地",
        mustPreserve: ["保留故事事实", "【场景差异化·快速交锋】旧的写法要求"],
      }] },
      sceneExpressionInstructions: "以表达轨道为唯一写法来源",
    },
    chapterTasks: [{ id: "task-1", objective: "完成当前章结果" }],
    chapterRelationStages: [],
    characters: [{ id: "actor-1", name: "甲", background: "long biography" }],
    acceptedHistory: [{ order: 1, content: "unrelated old prose" }],
    adjustments: [],
    usageBoundary: "only configured participants",
  });
  let prepared = false, reviewed = false;
  const service = new WritingContentService({ chapter: async () => ({ content: "old" }), createVersion: async v => v }, {
    load: async () => ({ id: "r", scope: { kind: "chapter" }, baseRevisions: { c: "b" } }), prompt: async () => "完成当前章结果",
  }, {
    prepare: async input => {
      prepared = true;
      assert.equal(input.contextText, "");
      assert.equal(input.requirementsText, "");
      const source = input.requirementSources.find(item => item.text === "完成当前章结果");
      assert.ok(source);
      assert.ok(input.requirementSources.some(item => item.text === "only configured participants"));
      assert.ok(input.requirementSources.some(item => item.group === "scene_1" && item.role === "resistance" && item.text === "遇到阻力"));
      assert.ok(input.requirementSources.every(item => !/unrelated global pitch|unrelated world encyclopedia|unrelated old prose|long biography/.test(item.text)));
      spine = [{ id: "s1", expectation: "required", requirement: "完成当前章结果", sourceId: source.id }];
      return { items: spine };
    },
    generate: async input => {
      assert.doesNotMatch(input.contextText, /unrelated global pitch|unrelated world encyclopedia|旧的写法要求/);
      assert.match(input.contextText, /unrelated old prose/);
      assert.match(input.contextText, /保留故事事实/);
      assert.match(input.contextText, /以表达轨道为唯一写法来源/);
      return "完成当前章结果。";
    },
    review: async input => {
      reviewed = true;
      assert.equal(input.requirementsText, "完成当前章结果");
      assert.equal(input.contextText, "");
      return { summary: "checked", issues: [], checks: [{ id: "s1", status: "met", quote: "完成当前章结果", reason: "direct evidence" }], missingEvidence: [], checkedEvidenceIds: [] };
    },
  });
  service.context = async () => context;

  const [version] = await service.generate("n", "c", { requirementsId: "r", operation: "write" });

  assert.equal(prepared, true);
  assert.equal(reviewed, true);
  assert.equal(version.metadata.configurationValidation.status, "passed");
});

test("fresh writing regenerates from configuration after an AI error without feeding rejected prose back", async () => {
  const inputs = []; let reviews = 0;
  const service = new WritingContentService({ chapter: async () => ({ content: "old" }), createVersion: async v => v }, {
    load: async () => ({ id: "r", scope: { kind: "chapter" }, baseRevisions: { c: "b" } }), prompt: async () => "plan",
  }, {
    generate: async input => { inputs.push(input); return inputs.length === 1 ? "wrong draft" : "complete draft"; },
    review: async input => { assert.equal(input.evidence.length, 0); return { summary: "review", issues: reviews++ === 0 ? [{ kind: "fact", severity: "error", message: "payment direction reversed", suggestion: "payer pays recipient", quote: "wrong", evidenceIds: [] }] : [], missingEvidence: [], checkedEvidenceIds: [] }; },
  });
  service.context = async () => "only current plan";
  const [version] = await service.generate("n", "c", { requirementsId: "r", operation: "write" });
  assert.equal(inputs.length, 2);
  assert.ok(inputs.every(x => x.content === undefined));
  assert.match(inputs[1].instruction, /payment direction reversed/);
  assert.equal(version.content, "complete draft");
  assert.equal(version.metadata.configurationValidation.status, "passed");
});

test("fresh writing stops after three reviewed drafts and retains explicit unresolved status", async () => {
  let calls = 0;
  const service = new WritingContentService({ chapter: async () => ({ content: "old" }), createVersion: async v => v }, {
    load: async () => ({ id: "r", scope: { kind: "chapter" }, baseRevisions: { c: "b" } }), prompt: async () => "plan",
  }, { generate: async () => { calls++; return "candidate"; }, review: async () => ({ summary: "missing scene", issues: [{ kind: "plan", severity: "error", message: "scene missing", suggestion: "complete all scenes", quote: "", evidenceIds: [] }] }) });
  service.context = async () => "plan";
  const [v] = await service.generate("n", "c", { requirementsId: "r", operation: "write" });
  assert.equal(calls, 3);
  assert.equal(v.metadata.configurationValidation.status, "needs_attention");
  assert.equal(v.metadata.configurationValidation.attempts.length, 3);
});

test("an unavailable configuration review retains the candidate without claiming it passed", async () => {
  const service = new WritingContentService({ chapter: async () => ({ content: "old" }), createVersion: async v => v }, {
    load: async () => ({ id: "r", scope: { kind: "chapter" }, baseRevisions: { c: "b" } }), prompt: async () => "plan",
  }, { generate: async () => "usable draft", review: async () => { throw Error("review unavailable"); } });
  service.context = async () => "plan";
  const [v] = await service.generate("n", "c", { requirementsId: "r", operation: "write" });
  assert.equal(v.content, "usable draft");
  assert.equal(v.metadata.configurationValidation.status, "review_failed");
  assert.match(v.metadata.configurationValidation.attempts[0].error, /unavailable/);
});

test("a failed review still retries when deterministic length validation already rejects the draft", async () => {
  let rounds = 0;
  const service = new WritingContentService({ chapter: async () => ({ content: "old" }), createVersion: async v => v }, {
    load: async () => ({ id: "r", scope: { kind: "chapter" }, baseRevisions: { c: "b" } }), prompt: async () => "plan",
  }, { generate: async () => { rounds++; return "太短"; }, review: async () => { throw Error("review unavailable"); } });
  service.context = async () => JSON.stringify({ currentPlan: { sceneCards: { lengthBudget: { softMinWordCount: 25, hardMaxWordCount: 40 } } } });

  const [version] = await service.generate("n", "c", { requirementsId: "r", operation: "write" });

  assert.equal(rounds, 3);
  assert.equal(version.metadata.configurationValidation.status, "review_failed");
  assert.ok(version.metadata.configurationValidation.attempts.every(attempt => attempt.lengthIssue && attempt.error));
});

test("missing spine checks trigger fresh regeneration even when issue list is empty", async () => {
  let rounds = 0;
  let spine;
  const service = new WritingContentService({ chapter: async () => ({ content: "old" }), createVersion: async v => v }, {
    load: async () => ({ id: "r", scope: { kind: "chapter" }, baseRevisions: { c: "b" } }), prompt: async () => "交接",
  }, {
    prepare: async input => { assert.equal(input.content, undefined); const source = input.requirementSources.find(item => item.text === "交接"); spine = [{ id: "s1", expectation: "required", requirement: "交接收据", sourceId: source.id, sourceQuote: source.text }]; return { items: spine.map(({ sourceQuote, ...item }) => item) }; },
    generate: async input => { assert.deepEqual(input.spine, spine); rounds++; return "交接收据完成"; },
    review: async input => { assert.deepEqual(input.spine, spine); return { issues: [], checks: [{ id: "s1", status: rounds === 1 ? "missing" : "met", quote: "交接", reason: "检查收据" }] }; },
  });
  service.context = async () => "plan";
  const [v] = await service.generate("n", "c", { requirementsId: "r", operation: "write" });
  assert.equal(rounds, 2);
  assert.deepEqual(v.metadata.configurationValidation.spine, spine);
  assert.equal(v.metadata.configurationValidation.status, "passed");
});

test("uncertain hard checks trigger regeneration instead of being treated as an acceptable review", async () => {
  let rounds = 0;
  const service = new WritingContentService({ chapter: async () => ({ content: "old" }), createVersion: async v => v }, {
    load: async () => ({ id: "r", scope: { kind: "chapter" }, baseRevisions: { c: "b" } }), prompt: async () => "完成指定动作",
  }, {
    prepare: async input => {
      const source = input.requirementSources.find(item => item.text === "完成指定动作");
      return { items: [{ id: "s1", expectation: "required", requirement: "完成指定动作", sourceId: source.id }] };
    },
    generate: async () => { rounds++; return "完成指定动作。"; },
    review: async () => ({ issues: [], checks: [{ id: "s1", status: rounds === 1 ? "uncertain" : "met", quote: rounds === 1 ? "" : "完成指定动作", reason: "核对动作" }] }),
  });
  service.context = async () => JSON.stringify({ currentPlan: {} });

  const [version] = await service.generate("n", "c", { requirementsId: "r", operation: "write" });

  assert.equal(rounds, 2);
  assert.equal(version.metadata.configurationValidation.status, "passed");
});

test("fresh writing retries when the candidate is below the configured chapter soft minimum", async () => {
  let rounds = 0;
  const longEnough = "字".repeat(26);
  const service = new WritingContentService({ chapter: async () => ({ content: "old" }), createVersion: async v => v }, {
    load: async () => ({ id: "r", scope: { kind: "chapter" }, baseRevisions: { c: "b" } }), prompt: async () => "plan",
  }, {
    generate: async input => { rounds++; return rounds === 1 ? "太短" : longEnough; },
    review: async () => ({ summary: "checked", issues: [], checks: [], missingEvidence: [], checkedEvidenceIds: [] }),
  });
  service.context = async () => JSON.stringify({ currentPlan: { targetWordCount: 30, sceneCards: { lengthBudget: { softMinWordCount: 25, hardMaxWordCount: 40 } } } });

  const [version] = await service.generate("n", "c", { requirementsId: "r", operation: "write" });

  assert.equal(rounds, 2);
  assert.equal(version.content, longEnough);
  assert.equal(version.metadata.configurationValidation.status, "passed");
  assert.equal(version.metadata.configurationValidation.attempts[0].wordCount, 2);
  assert.match(version.metadata.configurationValidation.attempts[0].lengthIssue, /少于.*25/);
});

test("fresh writing enforces the soft maximum and keeps the best reviewed attempt instead of the last regression", async () => {
  let rounds = 0;
  const drafts = ["字".repeat(28), "字".repeat(34), "字".repeat(36)];
  const service = new WritingContentService({ chapter: async () => ({ content: "old" }), createVersion: async v => v }, {
    load: async () => ({ id: "r", scope: { kind: "chapter" }, baseRevisions: { c: "b" } }), prompt: async () => "plan",
  }, {
    generate: async () => drafts[rounds++],
    review: async () => ({ summary: "checked", issues: [], checks: rounds === 1
      ? [{ id: "s1", status: "uncertain", quote: "", reason: "check" }, { id: "s2", status: "uncertain", quote: "", reason: "check" }]
      : rounds === 2
        ? [{ id: "s1", status: "uncertain", quote: "", reason: "check" }]
        : [{ id: "s1", status: "missing", quote: "", reason: "check" }], missingEvidence: [], checkedEvidenceIds: [] }),
  });
  service.context = async () => JSON.stringify({ currentPlan: { sceneCards: { lengthBudget: { targetWordCount: 30, softMinWordCount: 25, softMaxWordCount: 35, hardMaxWordCount: 40 } } } });

  const [version] = await service.generate("n", "c", { requirementsId: "r", operation: "write" });

  assert.equal(rounds, 3);
  assert.equal(version.content, drafts[1]);
  assert.equal(version.metadata.configurationValidation.selectedAttemptIndex, 1);
  assert.equal(version.metadata.configurationValidation.status, "needs_attention");
  assert.match(version.metadata.configurationValidation.attempts[2].lengthIssue, /软上限35/);
});

test("fresh writing retains needs-attention after three candidates remain outside the length budget", async () => {
  let rounds = 0;
  const service = new WritingContentService({ chapter: async () => ({ content: "old" }), createVersion: async v => v }, {
    load: async () => ({ id: "r", scope: { kind: "chapter" }, baseRevisions: { c: "b" } }), prompt: async () => "plan",
  }, {
    generate: async () => { rounds++; return "太短"; },
    review: async () => ({ summary: "checked", issues: [], checks: [], missingEvidence: [], checkedEvidenceIds: [] }),
  });
  service.context = async () => JSON.stringify({ currentPlan: { sceneCards: { lengthBudget: { softMinWordCount: 25, hardMaxWordCount: 40 } } } });

  const [version] = await service.generate("n", "c", { requirementsId: "r", operation: "write" });

  assert.equal(rounds, 3);
  assert.equal(version.metadata.configurationValidation.status, "needs_attention");
  assert.ok(version.metadata.configurationValidation.attempts.every(attempt => attempt.lengthIssue));
});
