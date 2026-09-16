import type { TreeSelectionRule } from "./contracts";

export interface TreePolicyNode {
  id: string;
  parentId: string | null;
  status?: "active" | "archived";
}

export interface TreePolicyResult {
  valid: boolean;
  message: string | null;
}

export function treeDescendantIds(nodes: TreePolicyNode[], nodeId: string): Set<string> {
  const children = new Map<string, string[]>();
  for (const node of nodes) {
    if (!node.parentId) continue;
    children.set(node.parentId, [...(children.get(node.parentId) ?? []), node.id]);
  }
  const descendants = new Set<string>();
  const queue = [...(children.get(nodeId) ?? [])];
  while (queue.length) {
    const current = queue.shift()!;
    if (descendants.has(current)) continue;
    descendants.add(current);
    queue.push(...(children.get(current) ?? []));
  }
  return descendants;
}

export function wouldCreateTreeCycle(nodes: TreePolicyNode[], nodeId: string, parentId: string | null): boolean {
  if (!parentId) return false;
  if (nodeId === parentId) return true;
  return treeDescendantIds(nodes, nodeId).has(parentId);
}

export function treePathIds(nodes: TreePolicyNode[], nodeId: string): string[] {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const path: string[] = [];
  const visited = new Set<string>();
  let current: string | null = nodeId;
  while (current) {
    if (visited.has(current)) throw new Error("树结构存在循环。");
    visited.add(current);
    path.unshift(current);
    current = byId.get(current)?.parentId ?? null;
  }
  return path;
}

export function selectableTreeNodeIds(nodes: TreePolicyNode[], rule: TreeSelectionRule): Set<string> {
  const active = nodes.filter((node) => node.status !== "archived");
  const byId = new Map(active.map((node) => [node.id, node]));
  const children = new Map<string, string[]>();
  for (const node of active) {
    if (!node.parentId) continue;
    children.set(node.parentId, [...(children.get(node.parentId) ?? []), node.id]);
  }
  const roots = rule.rootNodeId ? [rule.rootNodeId] : active.filter((node) => !node.parentId).map((node) => node.id);
  const depthFromRoot = new Map<string, number>();
  const queue = roots.map((id) => ({ id, depth: 0 }));
  while (queue.length) {
    const { id, depth } = queue.shift()!;
    if (!byId.has(id) || depthFromRoot.has(id)) continue;
    depthFromRoot.set(id, depth);
    for (const childId of children.get(id) ?? []) queue.push({ id: childId, depth: depth + 1 });
  }
  const result = new Set<string>();
  for (const [id, depth] of depthFromRoot) {
    const isRoot = roots.includes(id);
    const isLeaf = !(children.get(id)?.length);
    const withinDepth = rule.depthMode === "whole_tree"
      || rule.depthMode === "branch"
      || rule.depthMode === "descendants" && !isRoot
      || rule.depthMode === "direct_children" && depth === 1
      || rule.depthMode === "relative_depth" && depth <= (rule.relativeDepth ?? 0);
    if (withinDepth && (!rule.leafOnly || isLeaf) && (rule.allowParentSelection || isLeaf)) result.add(id);
  }
  return result;
}

export function validateTreeSelection(nodes: TreePolicyNode[], rule: TreeSelectionRule, selectedIds: string[]): TreePolicyResult {
  const unique = [...new Set(selectedIds)];
  if (unique.length < rule.minSelections) return { valid: false, message: `至少选择 ${rule.minSelections} 项。` };
  if (rule.maxSelections !== null && unique.length > rule.maxSelections) return { valid: false, message: `最多选择 ${rule.maxSelections} 项。` };
  if ((rule.mode === "single" || rule.mode === "cascade_single") && unique.length > 1) return { valid: false, message: "这项内容只能选择一项。" };
  const selectable = selectableTreeNodeIds(nodes, rule);
  if (unique.some((id) => !selectable.has(id))) return { valid: false, message: "选择中包含不在允许分支或层级内的项目。" };
  return { valid: true, message: null };
}
