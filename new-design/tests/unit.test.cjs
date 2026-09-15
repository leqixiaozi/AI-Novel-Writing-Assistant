const test = require("node:test");
const assert = require("node:assert/strict");
const { validateCardValues, validatePublishedEvolution } = require("../dist/server/domain/validation.js");

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
