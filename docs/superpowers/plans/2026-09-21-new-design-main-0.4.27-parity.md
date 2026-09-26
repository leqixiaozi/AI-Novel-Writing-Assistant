# New Design Main 0.4.27 Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replicate the applicable old-main 0.4.27 behavior in the independent new-design system: guarded comic visual assets and reliable DeepSeek structured output.

**Architecture:** Comic images form a new versioned aggregate rooted in existing comic Bible entities; uploads create immutable candidates and explicit adoption advances only the mutable aggregate pointer. DeepSeek compatibility stays in the new-design transport adapter and applies only to official endpoints and known thinking-toggle models.

**Tech Stack:** TypeScript, React, Express, PostgreSQL, Zod, Node test runner.

**Spec:** `new-design/docs/main-0.4.27-parity-design.md`

## Global Constraints

- Old `client/`, `server/`, Prisma migrations and runtime data remain read-only references.
- New business API stays under `/api/new-design`; no legacy state or API is reused.
- Candidate uploads never become adopted automatically, and unknown writes recover only by the original request key.
- Migration `114` remains manual and is not added to the default startup migration list.
- Real model calls are forbidden during automated verification.

---

### Task 1: DeepSeek structured-output compatibility

**Files:**
- Modify: `new-design/tests/independent-ai.unit.test.cjs`
- Modify: `new-design/src/server/ai/runtime/transport.ts`

**Interfaces:**
- Consumes: `invokeStructuredModel(config, prompt, fetcher)` through `createIndependentAiGateway`.
- Produces: an OpenAI-compatible request containing `thinking: {type: "disabled"}` only for official DeepSeek thinking-toggle models.

- [x] **Step 1: Write the failing transport test**

Add a table-driven test that invokes the real independent gateway for `deepseek-flash`, `deepseek-pro`, `deepseek-v4-flash`, `deepseek-v4-pro`, and `deepseek-reasoner`; hand-check the outgoing JSON contains the disabled thinking object and still contains the JSON-schema response format. Add a negative fixture for an unrelated OpenAI-compatible host.

- [x] **Step 2: Run the focused test and verify RED**

Run `pnpm --filter @ai-novel/new-design build:server; node --test new-design/tests/independent-ai.unit.test.cjs`. Expected failure: DeepSeek payload has no `thinking` property.

- [x] **Step 3: Implement endpoint-and-model-gated payload handling**

Add a focused predicate in `transport.ts` for the official host and exact supported model families, then spread `{thinking:{type:"disabled"}}` into the normal JSON-schema request only when the predicate is true.

- [x] **Step 4: Re-run the focused test and verify GREEN**

Run the same command. Expected result: all independent AI unit tests pass without a real network call.

### Task 2: Versioned comic visual asset data layer

**Files:**
- Create: `new-design/migrations/114_comic_visual_assets.sql`
- Create: `new-design/src/common/comicVisualAssets.ts`
- Create: `new-design/src/server/database/comicVisualAssets/index.ts`
- Create: `new-design/tests/comic-visual-assets.postgres.test.cjs`
- Modify: `new-design/src/server/runtime/manifest.ts`
- Modify: `new-design/runtime/runtime-package.spec.json`
- Modify: `new-design/tests/runtime-migration-artifacts.unit.test.cjs`

**Interfaces:**
- Produces: `getComicVisualWorkspace`, `uploadComicVisualCandidate`, `readComicVisualUploadOriginal`, `adoptComicVisualVersion`, `readComicVisualAdoptionOriginal`, and `readComicVisualContent`.
- Produces: Zod inputs and result types in `comicVisualAssets.ts` for the HTTP and client layers.

- [x] **Step 1: Write the failing PostgreSQL test**

Create a real isolated-database test applying `109`, `112`, and `114`. The test must demonstrate PNG signature validation, an immutable candidate upload bound to the adopted Bible version, same-key recovery, explicit adoption, cross-project rejection, and trigger rejection of version updates.

- [x] **Step 2: Run the focused test and verify RED**

Run `pnpm --filter @ai-novel/new-design build:server; node --test new-design/tests/comic-visual-assets.postgres.test.cjs`. Expected failure: migration/module does not exist.

- [x] **Step 3: Add the manual migration and contracts**

Create three tables: mutable `comic_visual_assets`, immutable `comic_visual_asset_versions`, and immutable `comic_visual_asset_adoptions`. Add exact project/Bible ownership constraints, adopted-version constraints, indexes, request-key uniqueness, and immutable triggers. Define upload/adoption schemas with the existing 10 MiB and MIME limits.

- [x] **Step 4: Implement transactional storage**

Decode and validate the supplied image bytes, bind the current adopted Bible version, append a candidate version, recover exact repeated requests, require revision-matched explicit adoption, and return content only through the exact project/asset/version scope.

- [x] **Step 5: Register the manual artifact and verify GREEN**

Add `114_comic_visual_assets.sql` to the runtime manual allowlists without adding it to `database/migrations.ts`. Run the focused PostgreSQL test and runtime migration artifact test; expected result is pass.

### Task 3: Comic visual asset HTTP and author UI

**Files:**
- Create: `new-design/src/server/http/comicVisualAssets/index.ts`
- Create: `new-design/src/client/comicProjects/visualAssetsApi.ts`
- Create: `new-design/src/client/comicProjects/ComicVisualAssets.tsx`
- Modify: `new-design/src/server/http/router.ts`
- Modify: `new-design/src/client/api.ts`
- Modify: `new-design/src/client/comicProjects/ComicBibleEditor.tsx`
- Modify: `new-design/src/client/comicProjects/comicProjects.css`
- Test: `new-design/tests/comic-visual-assets.postgres.test.cjs`

**Interfaces:**
- Consumes: Task 2 storage functions and types.
- Produces: list/upload/original-receipt/adopt/content routes under `/comic/projects/:projectId/visual-assets` and a selected-Bible visual asset panel.

- [x] **Step 1: Extend the failing integration test through HTTP**

Start the real Express router against the isolated pool, upload a fixture through HTTP, read the workspace without image bytes, fetch the exact image content with the expected MIME type, recover the original request, and adopt the candidate. Expected initial failure: route returns 404.

- [x] **Step 2: Implement and register the HTTP adapter**

Validate every project, entity, asset, version, and request key with Zod; return API envelopes for JSON operations and immutable cache headers plus the checksum ETag for image content.

- [x] **Step 3: Add the client API and panel**

On an existing character or scene with an adopted Bible version, show its candidate/adopted images, allow one controlled local upload, retain the original request key for read-only recovery, and require explicit adoption. Do not expose generation or export controls.

- [x] **Step 4: Compile both sides and run the integration test**

Run `pnpm --filter @ai-novel/new-design build:server`, `pnpm --filter @ai-novel/new-design typecheck:client`, and the focused comic visual test. Expected result: zero errors and all assertions pass.

### Task 4: Documentation, author database activation, and verification

**Files:**
- Modify: `new-design/docs/data-model.md`
- Modify: `new-design/docs/development-delivery.md`
- Modify: `docs/releases/release-notes.md`
- Modify: `README.md`
- Create: `new-design/database/schema/2026-09-21-new-design-schema.sql`
- Modify: `new-design/database/schema/README.md`

**Interfaces:**
- Consumes: verified migrations `108` through `114` and the existing development backup toolchain.
- Produces: a backed-up, restore-verified author database with the latest manual migrations and an updated schema-only snapshot.

- [x] **Step 1: Run focused source verification**

Run the DeepSeek unit test, comic tests for 109-114, runtime artifact test, server build, client typecheck, and standalone boundary test. Do not proceed to the author database if any result fails.

- [x] **Step 2: Quiesce writers and create a private full backup**

Stop the new-design API/background writers, create a new timestamped package under `.codex-backups`, and verify its manifest. Preserve the legacy API and legacy database.

- [x] **Step 3: Restore the backup into an independent database**

Restore the full backup into a new isolated PostgreSQL database and compare migration, book, card, and chapter-body-version counts to the source. Keep the restored database as evidence until author verification finishes.

- [x] **Step 4: Apply manual migrations 108-114 in order**

Apply each SQL file with stop-on-error and insert its exact ID into `new_design.schema_migrations` in the same transaction. Verify the expected tables, foreign keys, immutable triggers, and 111 total migration records while confirming the original book/card/body counts are unchanged.

- [x] **Step 5: Refresh the schema-only tracked snapshot**

Export schema only, restore it into a new empty verification database, and confirm it contains no author rows or credentials. Update the schema README with the new migration boundary and verification date.

- [x] **Step 6: Restart and smoke-test without model calls**

Restart the new-design API and comparison entry. Verify health, comic capability, comic project list, a visual-asset workspace read, the DeepSeek request unit fixture, and the existing routes without invoking a real model.

- [x] **Step 7: Update delivery and release documentation**

Record what is code-complete, isolated-tested, installed in the author database, and still awaiting manual page acceptance. State that resource ordinal compatibility and drama portrait fields were not duplicated because the corresponding old contracts do not exist in new-design.
