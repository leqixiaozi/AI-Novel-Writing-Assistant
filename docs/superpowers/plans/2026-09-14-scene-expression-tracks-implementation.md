# Scene Expression Tracks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task by task.

**Goal:** Replace the full-book arrangement screen's legacy chapter-level expression curves with five fixed, scene-level writing-expression tracks that save independently and affect later scene prose generation without changing story facts or scene plans.

**Architecture:** Add a separate scene-expression contract and persistence table keyed by `(novelId, sceneId, dimensionKey)`, plus a book-level runtime switch that defaults off. The arrangement workspace reads saved points, the UI edits an in-memory point draft with five-level snapping, and an explicit save endpoint persists the switch and valid points for scenes owned by the novel in one serializable transaction. Runtime context assembly queries and converts saved points only when the switch is enabled; disabled and unset states inject nothing, preserving the existing generation path.

**Tech Stack:** React 19, TypeScript, Express, Zod, Prisma 7, PostgreSQL/SQLite, Node test runner.

**Spec:** `docs/superpowers/specs/2026-09-14-dynamic-creative-tracks-design.md`

## Global Constraints

- Keep legacy chapter writing controls, URLs, request payloads, model call count, and save behavior compatible.
- The new five dimensions are fixed system dictionaries: `scene_pace`, `sentence_cadence`, `detail_expansion`, `camera_distance`, `language_ornament`.
- A point may reference only an existing `ChapterPlanScene` belonging to the selected novel.
- Levels are discrete `1..5`; missing and explicit level 3 are different states.
- Saving track points never changes `ChapterPlanScene`, `Chapter.sceneCards`, chapter content, events, relations, hooks, facts, or character knowledge.
- Left pointer drag adjusts only the level. Right click or keyboard menu opens details. Horizontal movement never changes the scene binding.
- Runtime prompt text constrains writing method only and explicitly freezes story content.

---

### Task 1: Define the shared scene-expression contract

**Files:**
- Modify: `shared/types/bookArrangement.ts`
- Create: `shared/types/sceneExpressionTracks.ts`
- Test: `client/src/pages/bookArrangement/controls/sceneExpressionTracks.test.mjs`

1. Write a failing contract test for five keys, five levels, labels, and prompt phrases.
2. Add the shared dimension/level/point/dictionary types and constants.
3. Extend `BookArrangementWorkspace` with `sceneExpressionPoints` and add the save request/response types.
4. Run the focused contract test and shared build.

### Task 2: Persist points with strict scene ownership validation

**Files:**
- Modify: `server/src/prisma/schema.prisma`
- Modify: `server/src/prisma/schema.sqlite.prisma`
- Create: `server/src/prisma/migrations/20260914190000_scene_expression_points/migration.sql`
- Create: `server/src/prisma/migrations.sqlite/20260914190000_scene_expression_points/migration.sql`
- Create: `server/src/modules/novel/adjustments/application/SceneExpressionTrackService.ts`
- Modify: `server/src/modules/novel/adjustments/application/BookArrangementService.ts`
- Modify: `server/src/modules/novel/adjustments/http/bookArrangementRoutes.ts`
- Modify: `server/src/modules/novel/adjustments/index.ts`
- Test: `server/tests/bookArrangement.test.js`

1. Write failing API/service tests proving valid upsert/delete, invalid level rejection, foreign-scene rejection, idempotency, and no scene-plan mutation.
2. Add `SceneExpressionPoint` with a unique scene/dimension binding and cascade cleanup.
3. Implement `save(novelId, expectedRevision, enabled, points)` as one serializable transaction with ownership and optimistic revision checking.
4. Return saved points and revision in the workspace; mount `PUT /:id/book-arrangement/scene-expression-points`.
5. Generate Prisma clients and run the focused server test.

### Task 3: Build scene-level curve projection and direct manipulation

**Files:**
- Create: `client/src/pages/bookArrangement/controls/sceneExpressionState.ts`
- Replace: `client/src/pages/bookArrangement/controls/ArrangementCurveCell.tsx`
- Modify: `client/src/pages/bookArrangement/controls/controlDrag.ts`
- Modify: `client/src/pages/bookArrangement/controls/controlDrag.test.mjs`
- Modify: `client/src/pages/bookArrangement/ArrangementMatrix.tsx`
- Modify: `client/src/pages/bookArrangement/arrangementState.ts`
- Modify: `client/src/pages/bookArrangement/bookArrangement.css`

1. Write failing tests for scene ordering, missing-point gaps, L1-L5 vertical snapping, explicit L3, and immutable scene binding.
2. Project visible scenes in chapter/sort order and render five curves with one point per scene.
3. Show the scene title on hover/focus. A click selects the point without opening a panel; vertical drag snaps to L1-L5.
4. Add arrow-key adjustment and context-menu/Shift+F10 detail opening.
5. Keep colors aligned with the existing arrangement theme and support horizontal overflow for dense scene sequences.

### Task 4: Add the large right-side detail editor and save flow

**Files:**
- Create: `client/src/pages/bookArrangement/panels/SceneExpressionPointPanel.tsx`
- Modify: `client/src/pages/bookArrangement/BookArrangementPage.tsx`
- Modify: `client/src/api/bookArrangement.ts`
- Modify: `client/src/pages/bookArrangement/panels/arrangement.css`
- Test: `client/src/pages/bookArrangement/panels/sceneExpressionPointPanel.test.mjs`

1. Write failing state tests for update, unset, note validation, and preserving the parent arrangement layer.
2. Open details only from right click/keyboard menu and show scene, dimension, five level descriptions, optional note, and reset-to-unset.
3. Track expression dirtiness separately from the legacy arrangement draft; wire the existing Save Draft action to persist both contracts without changing existing draft payloads.
4. Keep the panel as a wide overlay layer; closing it returns to the same scroll position and underlying arrangement state.
5. Run all book-arrangement client tests and typecheck.

### Task 5: Bind saved points into the normal scene-writing prompt

**Files:**
- Create: `server/src/prompting/prompts/novel/sceneExpressionControls.ts`
- Modify: `server/src/services/novel/runtime/GenerationContextAssembler.ts`
- Modify: `shared/types/chapterRuntime/qualitySchemas.ts` or the owned runtime context type that carries the block
- Test: `server/tests/prompting.test.js`
- Test: `server/tests/runtime.test.js`

1. Write failing tests proving unset chapters inject nothing, saved scenes render only the five writing dimensions, and output contains the story-freeze boundary.
2. Load expression points for the chapter's stable scene IDs during context assembly.
3. Render each scene block with title, level label, bounded instruction, and optional note. Do not serialize numeric implementation metadata into prose instructions.
4. Add the block to the existing chapter write context only when at least one saved point exists; do not add a model call.
5. Run focused prompt/runtime tests and server typecheck.

### Task 6: Demo data, documentation, and verification

**Files:**
- Modify: `docs/wiki/prompts/scene-expression-track-contract.md`
- Modify: release notes / README locations required by repository policy
- Data: current development database, novel `cmtvm8yxq005578y2lcp4fhs6`

1. Add representative points across existing demo scenes without deleting or resetting data.
2. Document the durable boundary: scene expression is optional writing metadata, scene IDs are immutable bindings, and runtime prompts cannot change story content.
3. Add the user-visible release note and latest README entry.
4. Run Prisma validation/generation, shared build, targeted server tests, all book-arrangement client tests, and client/server typechecks.
5. Inspect `git diff`, ensure unrelated existing modifications remain untouched, then commit and push the completed feature when requested.
