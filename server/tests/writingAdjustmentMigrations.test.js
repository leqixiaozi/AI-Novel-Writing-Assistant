const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Database = require("better-sqlite3");

const prismaRoot = path.join(__dirname, "..", "src", "prisma");
const migrationName = "20260913160000_optional_writing_adjustments";
const modelNames = [
  "WritingSetting", "WritingPreset", "WritingRequirement", "ChapterEditVersion",
  "ManualEditSession", "ChapterAdjustmentGuard", "WritingAcceptance", "WritingAdjustmentOperation",
];
const providers = [
  { schema: "schema.prisma", migrations: "migrations" },
  { schema: "schema.sqlite.prisma", migrations: "migrations.sqlite" },
];

function readMigration(provider) {
  return fs.readFileSync(path.join(prismaRoot, provider.migrations, migrationName, "migration.sql"), "utf8");
}

function modelBlock(provider, modelName) {
  const schema = fs.readFileSync(path.join(prismaRoot, provider.schema), "utf8");
  const match = schema.match(new RegExp(`model ${modelName} \\{([\\s\\S]*?)\\n\\}`));
  assert.ok(match, `${provider.schema} contains ${modelName}`);
  return match[1].trim().split(/\r?\n/).map((line) => line.trim().replace(/\s+/g, " ")).filter(Boolean);
}

function legacyDatabase(provider) {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE "CreativeDecision" (
      "id" TEXT PRIMARY KEY, "novelId" TEXT NOT NULL, "content" TEXT NOT NULL, "expiresAt" INTEGER
    );
    CREATE TABLE "Chapter" ("id" TEXT PRIMARY KEY, "content" TEXT NOT NULL);
    INSERT INTO "CreativeDecision" VALUES ('old-decision', 'novel-1', 'preserve this decision', 8);
    INSERT INTO "Chapter" VALUES ('chapter-1', 'published original');
  `);
  db.exec(readMigration(provider));
  return db;
}

test("optional adjustment Prisma contracts match across PostgreSQL and SQLite", () => {
  for (const modelName of modelNames) {
    assert.deepEqual(modelBlock(providers[0], modelName), modelBlock(providers[1], modelName));
  }
  for (const provider of providers) {
    assert.ok(modelBlock(provider, "CreativeDecision").includes("adjustmentJson String?"));
    assert.doesNotMatch(readMigration(provider), /\b(?:DROP|DELETE|TRUNCATE|UPDATE|RENAME)\b/i);
    assert.equal((readMigration(provider).match(/ALTER TABLE/g) || []).length, 1);
  }
});

for (const provider of providers) {
  // PostgreSQL's additive DDL is also accepted by SQLite here. This verifies the
  // storage shape and constraints, not PostgreSQL server execution semantics.
  test(`${provider.migrations}: additive migration preserves old data and old inserts`, () => {
    const db = legacyDatabase(provider);
    try {
      assert.deepEqual(db.prepare('SELECT * FROM "CreativeDecision"').get(), {
        id: "old-decision", novelId: "novel-1", content: "preserve this decision", expiresAt: 8, adjustmentJson: null,
      });
      db.prepare('INSERT INTO "CreativeDecision" ("id", "novelId", "content") VALUES (?, ?, ?)')
        .run("new-legacy-decision", "novel-1", "uses the old contract");
      assert.equal(db.prepare('SELECT "content" FROM "Chapter" WHERE "id" = ?').get("chapter-1").content, "published original");
      for (const name of modelNames) {
        assert.equal(db.prepare(`SELECT count(*) AS count FROM "${name}"`).get().count, 0);
      }
    } finally {
      db.close();
    }
  });

  test(`${provider.migrations}: every model field and index exists in migration`, () => {
    const db = legacyDatabase(provider);
    try {
      for (const modelName of modelNames) {
        const block = modelBlock(provider, modelName);
        const fields = block.map((line) => line.match(/^(\w+)\s+(String|Int|DateTime)(\?)?(.*)$/)).filter(Boolean);
        const columns = db.prepare(`PRAGMA table_info("${modelName}")`).all();
        assert.deepEqual(columns.map((column) => column.name), fields.map((field) => field[1]));
        for (const [, name, type, nullable, attributes] of fields) {
          const column = columns.find((value) => value.name === name);
          const expectedType = { String: "TEXT", Int: "INTEGER", DateTime: provider.schema === "schema.prisma" ? "TIMESTAMP(3)" : "DATETIME" }[type];
          assert.equal(column.type, expectedType, `${modelName}.${name} type`);
          assert.equal(column.notnull, nullable ? 0 : 1, `${modelName}.${name} nullability`);
          assert.equal(column.pk, attributes.includes("@id") ? 1 : 0, `${modelName}.${name} primary key`);
          if (attributes.includes("@default(now())")) assert.equal(column.dflt_value, "CURRENT_TIMESTAMP");
          const numericDefault = attributes.match(/@default\((\d+)\)/)?.[1];
          if (numericDefault) assert.equal(column.dflt_value, numericDefault);
        }
        const indexes = db.prepare(`PRAGMA index_list("${modelName}")`).all().map((index) => ({
          unique: Boolean(index.unique),
          fields: db.prepare(`PRAGMA index_info("${index.name}")`).all().map((field) => field.name),
        }));
        for (const line of block) {
          const compound = line.match(/^@@(index|unique)\(\[([^\]]+)\]\)/);
          const uniqueField = line.match(/^(\w+)\s+.*@unique/);
          if (!compound && !uniqueField) continue;
          const expected = compound
            ? { unique: compound[1] === "unique", fields: compound[2].split(",").map((field) => field.trim()) }
            : { unique: true, fields: [uniqueField[1]] };
          assert.ok(indexes.some((index) => JSON.stringify(index) === JSON.stringify(expected)), `${modelName}: ${line}`);
        }
      }
    } finally {
      db.close();
    }
  });
}

test("settings and request receipts enforce scope and idempotency uniqueness", () => {
  const db = legacyDatabase(providers[1]);
  try {
    const setting = db.prepare('INSERT INTO "WritingSetting" ("id", "novelId", "scopeKey", "payloadJson", "updatedAt") VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)');
    setting.run("setting-1", "novel-1", "book", "{}");
    assert.throws(() => setting.run("setting-2", "novel-1", "book", "{}"), /UNIQUE constraint/);
    setting.run("setting-3", "novel-2", "book", "{}");
    assert.equal(db.prepare('SELECT "revision" FROM "WritingSetting" WHERE "id" = ?').get("setting-1").revision, 1);
    const operation = db.prepare('INSERT INTO "WritingAdjustmentOperation" ("id", "novelId", "requestKey", "requestHash", "status", "updatedAt") VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)');
    operation.run("op-1", "novel-1", "request-1", "hash", "running");
    assert.throws(() => operation.run("op-2", "novel-1", "request-1", "different", "running"), /UNIQUE constraint/);
    const accept = db.prepare('INSERT INTO "WritingAcceptance" ("id", "novelId", "chapterId", "editVersionId", "requestKey", "status", "payloadJson", "updatedAt") VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)');
    accept.run("accept-1", "novel-1", "chapter-1", "candidate-1", "accept-request", "pending", "{}");
    assert.throws(() => accept.run("accept-2", "novel-1", "chapter-1", "candidate-1", "accept-request", "pending", "{}"), /UNIQUE constraint/);
  } finally {
    db.close();
  }
});

test("candidate persistence leaves chapter content unchanged and guard epochs reject stale updates", () => {
  const db = legacyDatabase(providers[1]);
  try {
    db.prepare('INSERT INTO "ChapterEditVersion" ("id", "novelId", "chapterId", "sessionId", "kind", "baseRevision", "content", "contentHash", "metadataJson") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run("candidate-1", "novel-1", "chapter-1", "session-1", "candidate", "base-hash", "candidate prose", "candidate-hash", "{}");
    assert.equal(db.prepare('SELECT "content" FROM "Chapter" WHERE "id" = ?').get("chapter-1").content, "published original");
    db.prepare('INSERT INTO "ChapterAdjustmentGuard" ("chapterId", "novelId", "updatedAt") VALUES (?, ?, CURRENT_TIMESTAMP)')
      .run("chapter-1", "novel-1");
    const advance = db.prepare('UPDATE "ChapterAdjustmentGuard" SET "epoch" = "epoch" + 1, "manualSessionId" = ? WHERE "chapterId" = ? AND "epoch" = ?');
    assert.equal(advance.run("session-1", "chapter-1", 0).changes, 1);
    assert.equal(advance.run(null, "chapter-1", 0).changes, 0);
    assert.equal(advance.run(null, "chapter-1", 1).changes, 1);
    assert.equal(advance.run(null, "chapter-1", 0).changes, 0);
    assert.equal(db.prepare('SELECT "epoch" FROM "ChapterAdjustmentGuard" WHERE "chapterId" = ?').get("chapter-1").epoch, 2);
  } finally {
    db.close();
  }
});
