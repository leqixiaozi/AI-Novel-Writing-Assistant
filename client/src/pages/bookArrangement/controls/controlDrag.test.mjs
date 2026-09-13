import test from "node:test";
import assert from "node:assert/strict";
import { controlBandAtY } from "./controlDrag.ts";
test("curve drag snaps to five valid bands and retains explicit zero at lower boundary", () => {
 assert.deepEqual([0, 25, 50, 75, 100].map(y => controlBandAtY(y, 0, 100)), [100, 75, 50, 25, 0]);
 assert.equal(controlBandAtY(1000, 0, 100), 0); assert.equal(controlBandAtY(-10, 0, 100), 100);
 assert.equal(controlBandAtY(10, 0, 0), 50);
});
