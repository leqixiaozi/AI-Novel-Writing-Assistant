import test from "node:test";
import assert from "node:assert/strict";
import { buildRelationshipPortLayout } from "./characterRelationshipPorts.ts";

test("同一人物的多条关系使用独立端口并按方向分布", () => {
  const nodes = [
    { id: "center", x: 400, y: 300 },
    { id: "upper", x: 400, y: 40 },
    { id: "right-1", x: 760, y: 180 },
    { id: "right-2", x: 760, y: 420 },
    { id: "lower", x: 400, y: 600 },
  ];
  const edges = nodes.slice(1).map((node, index) => ({
    id: `edge-${index + 1}`,
    source: "center",
    target: node.id,
  }));

  const layout = buildRelationshipPortLayout(nodes, edges);
  const centerPorts = layout.nodePorts.get("center") ?? [];
  assert.equal(centerPorts.length, 4);
  assert.equal(new Set(centerPorts.map((port) => port.handleId)).size, 4);
  assert.deepEqual(centerPorts.map((port) => port.side).sort(), ["bottom", "right", "right", "top"]);

  const rightPorts = centerPorts.filter((port) => port.side === "right");
  assert.equal(new Set(rightPorts.map((port) => port.offset)).size, 2);
  for (const edge of edges) {
    const assignment = layout.edgePorts.get(edge.id);
    assert.ok(assignment?.sourceHandle);
    assert.ok(assignment?.targetHandle);
    assert.notEqual(assignment?.sourceHandle, assignment?.targetHandle);
  }
});
