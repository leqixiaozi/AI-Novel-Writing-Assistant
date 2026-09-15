const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

process.env.NEW_DESIGN_DATA_DIR = path.resolve(
  __dirname,
  `../.data/integration-postgres/run-${Date.now()}-${process.pid}`,
);
delete process.env.NEW_DESIGN_DATABASE_URL;

const runtime = require("../dist/server/database/runtime.js");
const store = require("../dist/server/database/store.js");
const { validateCardValues } = require("../dist/server/domain/validation.js");

function personFields() {
  return [
    { key: "name", name: "姓名", description: "人物姓名", type: "short_text", required: true, defaultValue: null, options: [], group: "基本信息", order: 0 },
    { key: "story_role", name: "人物定位", description: "故事职责", type: "short_text", required: true, defaultValue: null, options: [], group: "故事职责", order: 1 },
    { key: "personality", name: "性格", description: "性格特点", type: "long_text", required: false, defaultValue: null, options: [], group: "人物内核", order: 2 },
    { key: "age", name: "年龄", description: "当前年龄", type: "number", required: false, defaultValue: null, options: [], group: "基本信息", order: 3 },
  ];
}

test("portable PostgreSQL persists the complete card slice across restart", async (t) => {
  t.after(async () => { await runtime.stopNewDesignDatabase(); });

  const status = await runtime.getDatabaseRuntimeStatus();
  assert.equal(status.mode, "bundled");
  assert.match(status.postgresVersion, /^17\./);
  assert.notEqual(status.port, 5432);

  const builtInTypes = await store.listCardTypes();
  const systemTypes = builtInTypes.filter((cardType) => cardType.isSystem);
  assert.equal(systemTypes.length, 19);
  assert.deepEqual(
    systemTypes.slice(0, 5).map((cardType) => cardType.name),
    ["人物", "组织／势力", "地点", "道具", "世界规则"],
  );
  assert.deepEqual(
    systemTypes.map((cardType) => cardType.key),
    ["character", "organization", "location", "prop", "world_rule", "event", "goal_task", "conflict", "secret_truth", "clue_evidence", "foreshadow", "suspense_question", "plotline", "plot_beat", "arc", "theme", "volume", "chapter", "scene"],
  );
  assert.deepEqual(
    systemTypes.find((cardType) => cardType.key === "event").semanticCapabilities,
    ["timeline", "state_change", "canonical_fact"],
  );
  assert.deepEqual(
    systemTypes.find((cardType) => cardType.key === "scene").semanticCapabilities,
    ["body_text", "timeline", "state_change", "creative_goal"],
  );

  const starterCards = await store.listCards({});
  for (const title of ["主世界观", "主线时间规则", "新书创作约定", "核心故事构思"]) {
    assert.ok(starterCards.some((card) => card.title === title));
  }

  const demoCards = starterCards.filter((card) => card.title.startsWith("《照骨山河》"));
  assert.equal(demoCards.length, 55);
  assert.deepEqual(
    [...new Set(demoCards.map((card) => systemTypes.find((type) => type.id === card.cardTypeId)?.key))].sort(),
    systemTypes.map((cardType) => cardType.key).sort(),
  );
  for (const cardType of systemTypes) {
    const currentVersion = (await store.listCardTypeVersions(cardType.id)).find((version) => version.id === cardType.currentVersionId);
    assert.ok(currentVersion, `missing current version for ${cardType.key}`);
    for (const card of demoCards.filter((candidate) => candidate.cardTypeId === cardType.id)) {
      assert.deepEqual(validateCardValues(currentVersion.fields, card.values).issues, {}, `${card.title} should match ${cardType.key}`);
    }
  }

  const suffix = Date.now().toString(36);
  let cardType = await store.createCardType({
    key: `character_${suffix}`,
    name: "人物",
    description: "人物卡片集成验证",
    semanticCapabilities: ["relation_subject", "state_change"],
    fields: personFields(),
  });
  cardType = await store.publishCardType(cardType.id, cardType.revision);
  assert.equal(cardType.currentVersion, 1);

  await assert.rejects(
    () => store.createCard({ cardTypeId: cardType.id, title: "错误人物", values: { age: "十八", unknown: true } }),
    (error) => Boolean(error.status === 422 && error.issues.age && error.issues.name && error.issues.unknown),
  );

  let card = await store.createCard({
    cardTypeId: cardType.id,
    title: "林雾",
    values: { name: "林雾", story_role: "主角", personality: "谨慎但执着", age: 18 },
  });
  card = await store.updateCard(card.id, { ...card, title: "林雾（成年）", values: { ...card.values, age: 19 } });

  cardType = await store.updateCardType(cardType.id, {
    name: cardType.name,
    description: cardType.description,
    semanticCapabilities: cardType.semanticCapabilities,
    fields: [...cardType.draftFields, { key: "secret", name: "秘密", description: "尚未公开的信息", type: "long_text", required: false, defaultValue: null, options: [], group: "人物内核", order: 4 }],
    revision: cardType.revision,
  });
  cardType = await store.publishCardType(cardType.id, cardType.revision);
  assert.equal(cardType.currentVersion, 2);

  card = await store.updateCard(card.id, { ...card, values: { ...card.values, secret: "来自旧城" } });
  assert.equal(card.typeVersion, 2);
  card = await store.archiveCard(card.id, card.revision);
  assert.equal(card.status, "archived");
  card = await store.restoreCard(card.id, card.revision);
  assert.equal(card.status, "active");
  assert.equal((await store.listCardVersions(card.id)).length, 5);

  const persistedId = card.id;
  await runtime.stopNewDesignDatabase();
  const restarted = await store.getCard(persistedId);
  assert.equal(restarted.title, "林雾（成年）");
  assert.equal(restarted.values.secret, "来自旧城");
  assert.equal(restarted.status, "active");
});
