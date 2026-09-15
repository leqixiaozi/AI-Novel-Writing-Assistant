const test = require("node:test");
const assert = require("node:assert/strict");
const { bookChangePreviewSchema, bookCreationSessionInputSchema, bookViewConfigSchema, validateCardValues, validatePublishedEvolution } = require("../dist/server/domain/validation.js");
const { buildCardTypeTree } = require("../dist/common/cardTypeTree.js");

const fields = [
  { key: "name", name: "姓名", description: "", type: "short_text", required: true, defaultValue: null, options: [], group: "基本信息", order: 0 },
  { key: "age", name: "年龄", description: "", type: "number", required: false, defaultValue: null, options: [], group: "基本信息", order: 1 },
];

test("card validation rejects missing, invalid and unknown values", () => {
  const result = validateCardValues(fields, { age: "十八", surprise: true });
  assert.equal(result.issues.name, "姓名为必填项。");
  assert.equal(result.issues.age, "年龄需要填写有效数字。");
  assert.match(result.issues.surprise, /不在当前元卡片定义中/);
});

test("published schema only accepts new optional fields", () => {
  const optional = { key: "secret", name: "秘密", description: "", type: "long_text", required: false, defaultValue: null, options: [], group: "人物内核", order: 2 };
  assert.deepEqual(validatePublishedEvolution(fields, [...fields, optional]), {});
  assert.ok(validatePublishedEvolution(fields, fields.slice(0, 1)).fields);
  assert.ok(validatePublishedEvolution(fields, [...fields, { ...optional, required: true }]).secret);
});

test("book creation inputs keep entry method separate from template structure", () => {
  const common = { templateVersionId: "40000000-0000-4000-8000-000000000002", description: "", sourceReference: "", inputPayload: {} };
  assert.equal(bookCreationSessionInputSchema.safeParse({ ...common, method: "blank", bookName: "" }).success, false);
  assert.equal(bookCreationSessionInputSchema.safeParse({ ...common, method: "blank", bookName: "新书" }).success, true);
  assert.equal(bookCreationSessionInputSchema.safeParse({ ...common, method: "idea", bookName: "", inputPayload: { idea: "一条真实灵感" } }).success, true);
  assert.equal(bookCreationSessionInputSchema.safeParse({ ...common, method: "market", bookName: "" }).success, false);
});

test("card type tree keeps matching leaves with their ancestor path", () => {
  const category = { id: "cat-world", key: "world", name: "世界设定", parentId: null, sortOrder: 10, status: "active", isSystem: true, revision: 1, createdAt: "", updatedAt: "" };
  const type = { id: "type-power", categoryId: category.id, key: "power_system", name: "能力体系", description: "修炼与科技", sortOrder: 10 };
  assert.equal(buildCardTypeTree([category], [type]).at(0).typeCount, 1);
  const searched = buildCardTypeTree([category], [type], "修炼");
  assert.equal(searched.length, 1);
  assert.equal(searched[0].cardTypes[0].id, type.id);
  assert.equal(buildCardTypeTree([category], [type], "人物").length, 0);
});

test("book view config accepts presentation state but rejects fact copies", () => {
  assert.equal(bookViewConfigSchema.safeParse({ config:{ groupBy:"story_time",sort:"start_order",expanded:[] },revision:1 }).success,true);
  assert.equal(bookViewConfigSchema.safeParse({ config:{ copiedEvent:{ title:"不应进入视图配置" } },revision:1 }).success,false);
});

test("high-impact book changes require a typed preview payload", () => {
  const cardId = "10000000-0000-4000-8000-000000000001";
  assert.equal(bookChangePreviewSchema.safeParse({
    operationKey:"story_time",
    input:{ cardId,startOrder:8,endOrder:10,startLabel:"初八",endLabel:"初十",uncertainty:"" },
  }).success,true);
  assert.equal(bookChangePreviewSchema.safeParse({
    operationKey:"story_time",
    input:{ cardId,startOrder:10,endOrder:8,startLabel:"初十",endLabel:"初八",uncertainty:"" },
  }).success,false);
  assert.equal(bookChangePreviewSchema.safeParse({
    operationKey:"character_relation",
    input:{ cardId,startOrder:8,endOrder:10 },
  }).success,false);
});
