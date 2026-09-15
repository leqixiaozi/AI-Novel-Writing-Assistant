const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { loadRuntimeSource } = require("./novelProduction/sourceHarness.cjs");

const modulePath = path.resolve(__dirname, "../src/prompting/prompts/novel/sceneExpressionControls.ts");
function load() {
  return loadRuntimeSource(modulePath, { "@ai-novel/shared/types/sceneExpressionTracks": require("@ai-novel/shared/types/sceneExpressionTracks") });
}

test("legacy expression labels are removed without touching a story code or count", () => {
  assert.equal(load().compileLegacySceneExpressionLabels("门牌L4，第三日，两联\n表达：场景节奏L4：压缩重复；镜头距离L2：外部观察。"), "门牌L4，第三日，两联\n表达：场景节奏：压缩重复；镜头距离：外部观察。");
});

test("scene expression renderer injects nothing when the chapter has no saved points", () => {
  assert.equal(load().renderSceneExpressionControls([{ id: "s1", sortOrder: 1, title: "进门" }], []), "");
});

test("scene expression renderer binds fixed writing instructions to stable scene titles", () => {
  const text = load().renderSceneExpressionControls(
    [{ id: "s1", sortOrder: 1, title: "进门" }, { id: "s2", sortOrder: 2, title: "摸供桌" }],
    [{ sceneId: "s2", dimensionKey: "scene_pace", level: 4, note: "动作衔接清楚" }, { sceneId: "s2", dimensionKey: "camera_distance", level: 5, note: null }],
  );
  assert.match(text, /【场景 S2：摸供桌】/);
  assert.match(text, /场景节奏：/);
  assert.match(text, /镜头距离：/);
  assert.doesNotMatch(text, /L[1-5]／|原值|有效档/);
  assert.match(text, /只改变表达，不改变故事/);
  assert.doesNotMatch(text, /plot_twist|人物聚焦度|悬疑强度/);
});

test("scene expression renderer uses the current book's custom five-level dictionary", () => {
  const definitions = [{
    key: "custom_dialogue_density", origin: "custom", label: "对话密度", description: "控制对话占比", color: "teal", enabled: true, sortOrder: 1,
    promptAssetKey: "novel.scene.expression_controls", invariants: ["不得新增对话事实"],
    bands: [1, 2, 3, 4, 5].map(level => ({ level, name: `对话 L${level}`, instruction: `使用第 ${level} 档对话密度。` })),
  }];
  const text = load().renderSceneExpressionControls(
    [{ id: "s1", sortOrder: 1, title: "进门" }],
    [{ sceneId: "s1", dimensionKey: "custom_dialogue_density", level: 4, note: null }],
    definitions,
  );
  assert.doesNotMatch(text, /对话密度：L4／/);
  assert.match(text, /使用第 4 档对话密度/);
  assert.match(text, /不得新增对话事实/);
});

test("normal chapter context assembly reads scene points and places the bounded block in the production foundation", () => {
  const source = fs.readFileSync(path.resolve(__dirname, "../src/services/novel/runtime/GenerationContextAssembler.ts"), "utf8");
  assert.match(source, /novel\.sceneExpressionTracksEnabled && ensuredPlan\?\.scenes\?\.length \? prisma\.sceneExpressionPoint\.findMany/);
  assert.match(source, /renderSceneExpressionControls\(ensuredPlan\.scenes, sceneExpressionPointInputs, sceneExpressionDefinitions\)/);
  const foundation = source.slice(source.indexOf("const productionFoundationPrompt"), source.indexOf("const mappedPlan"));
  assert.match(foundation, /novel\.sceneExpressionTracksEnabled/);
  assert.match(foundation, /renderSceneExpressionControls/);
});
