export type RelationshipPortSide = "top" | "right" | "bottom" | "left";

export interface RelationshipNodePort {
  handleId: string;
  type: "source" | "target";
  side: RelationshipPortSide;
  offset: number;
}

export interface RelationshipEdgePortAssignment {
  sourceHandle: string;
  targetHandle: string;
}

interface PositionedNode {
  id: string;
  x: number;
  y: number;
}

interface ConnectedEdge {
  id: string;
  source: string;
  target: string;
}

interface PendingPort {
  nodeId: string;
  edgeId: string;
  type: "source" | "target";
  side: RelationshipPortSide;
  order: number;
}

export function buildRelationshipPortLayout(nodes: PositionedNode[], edges: ConnectedEdge[]) {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const buckets = new Map<string, PendingPort[]>();
  const edgePorts = new Map<string, RelationshipEdgePortAssignment>();

  const addPort = (port: PendingPort) => {
    const key = `${port.nodeId}:${port.side}`;
    buckets.set(key, [...(buckets.get(key) ?? []), port]);
  };

  for (const edge of edges) {
    const source = nodeById.get(edge.source);
    const target = nodeById.get(edge.target);
    if (!source || !target) continue;
    const sourceSide = sideForVector(target.x - source.x, target.y - source.y);
    const targetSide = oppositeSide(sourceSide);
    const sourceHandle = `source:${edge.id}`;
    const targetHandle = `target:${edge.id}`;
    edgePorts.set(edge.id, { sourceHandle, targetHandle });
    addPort({ nodeId: source.id, edgeId: edge.id, type: "source", side: sourceSide, order: crossAxis(target, sourceSide) });
    addPort({ nodeId: target.id, edgeId: edge.id, type: "target", side: targetSide, order: crossAxis(source, targetSide) });
  }

  const nodePorts = new Map<string, RelationshipNodePort[]>();
  for (const ports of buckets.values()) {
    ports.sort((first, second) => first.order - second.order || first.edgeId.localeCompare(second.edgeId));
    ports.forEach((port, index) => {
      const assignment = edgePorts.get(port.edgeId)!;
      const handleId = port.type === "source" ? assignment.sourceHandle : assignment.targetHandle;
      const nodePort: RelationshipNodePort = {
        handleId,
        type: port.type,
        side: port.side,
        offset: (index + 1) / (ports.length + 1),
      };
      nodePorts.set(port.nodeId, [...(nodePorts.get(port.nodeId) ?? []), nodePort]);
    });
  }

  return { nodePorts, edgePorts };
}

function sideForVector(deltaX: number, deltaY: number): RelationshipPortSide {
  if (Math.abs(deltaX) >= Math.abs(deltaY)) return deltaX >= 0 ? "right" : "left";
  return deltaY >= 0 ? "bottom" : "top";
}

function oppositeSide(side: RelationshipPortSide): RelationshipPortSide {
  if (side === "top") return "bottom";
  if (side === "right") return "left";
  if (side === "bottom") return "top";
  return "right";
}

function crossAxis(node: PositionedNode, side: RelationshipPortSide): number {
  return side === "top" || side === "bottom" ? node.x : node.y;
}
