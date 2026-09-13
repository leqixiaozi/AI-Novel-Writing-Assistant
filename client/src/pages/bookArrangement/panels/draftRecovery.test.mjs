import test from "node:test";
import assert from "node:assert/strict";
import { refreshArrangementDraft } from "./draftRecovery.ts";
const payload = { baseRevision: "r1", chapterEdits: [], characterSpans: [], pinnedTracks: [] };
const saved = { revision: 3, payload, updatedAt: null };
test("source refresh keeps unsaved edits and old CAS when another window saved a different draft", () => {
 const local = { ...payload, pinnedTracks: ["pace"] };
 const newer = { ...saved, revision: 4, payload: { ...payload, pinnedTracks: ["tension"] } };
 const result = refreshArrangementDraft({ draft: local, saved }, { draft: newer, baseRevision: "r2" });
 assert.equal(result.conflict, true); assert.equal(result.saved.revision, 3);
 assert.deepEqual(result.draft.pinnedTracks, ["pace"]); assert.equal(result.draft.baseRevision, "r2");
});
test("explicit discard loads the latest server draft; clean refresh can advance the saved revision", () => {
 const next = { draft: { ...saved, revision: 4 }, baseRevision: "r2" };
 assert.equal(refreshArrangementDraft({ draft: payload, saved }, next).saved.revision, 4);
 const discarded = refreshArrangementDraft({ draft: { ...payload, pinnedTracks: ["pace"] }, saved }, next, true);
 assert.deepEqual(discarded.draft.pinnedTracks, []); assert.equal(discarded.conflict, false);
});
