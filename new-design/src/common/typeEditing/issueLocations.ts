import type { FieldDefinition } from "../contracts";

export interface TypeIssueLocation {
  path: string;
  label: string;
  message: string;
  target: "name" | "description" | "categoryId" | "fields" | "field" | null;
  fieldKey?: string;
}

export function typeFieldIssuePaths(issues: Record<string,string>): Record<string,string> {
  return Object.fromEntries(Object.entries(issues).map(([key,message])=>[`fieldKey.${key}`,message]));
}

// Deterministic presentation of server validation paths, not interpretation of AI intent.
export function locateTypeIssues(issues: Record<string, string>, fields: FieldDefinition[]): TypeIssueLocation[] {
  const labels: Record<string, string> = { name: "类型名称", description: "用途说明", categoryId: "所属分类" };
  return Object.entries(issues).map(([path, message]) => {
    if (Object.hasOwn(labels, path)) return { path, label: labels[path], message, target: path as "name" | "description" | "categoryId" };
    const parts = path.split(".");
    const indexed = (parts[0] === "draftFields" || parts[0] === "fields") && parts.length > 1 && /^\d+$/.test(parts[1]);
    const stableKey=parts[0]==="fieldKey"?parts.slice(1).join("."):path;
    const field = indexed ? fields[Number(parts[1])] : fields.find(item => item.key === stableKey);
    if (field) return { path, label: `字段“${field.name || "未命名字段"}”`, message, target: "field", fieldKey: field.key };
    if (parts[0] === "draftFields" || parts[0] === "fields" || parts[0]==="fieldKey") return { path, label: "字段定义", message, target: "fields" };
    return { path, label: "提交内容", message, target: null };
  });
}
