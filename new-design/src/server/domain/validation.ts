import { z } from "zod";
import { FIELD_TYPES, type FieldDefinition } from "../../common/contracts";

const optionSchema = z.object({
  value: z.string().trim().min(1, "选项值不能为空。"),
  label: z.string().trim().min(1, "选项名称不能为空。"),
});

export const fieldDefinitionSchema = z.object({
  key: z.string().trim().regex(/^[a-z][a-z0-9_]{1,62}$/, "字段标识需以小写字母开头，只能包含小写字母、数字和下划线。"),
  name: z.string().trim().min(1, "字段名称不能为空。").max(80),
  description: z.string().trim().max(300).default(""),
  type: z.enum(FIELD_TYPES),
  required: z.boolean().default(false),
  defaultValue: z.unknown().optional().nullable(),
  options: z.array(optionSchema).default([]),
  group: z.string().trim().max(80).default("基本信息"),
  order: z.number().int().min(0).max(10_000),
}).superRefine((field, context) => {
  const needsOptions = field.type === "select" || field.type === "multi_select";
  if (needsOptions && field.options.length === 0) {
    context.addIssue({ code: "custom", path: ["options"], message: "选择类型至少需要一个选项。" });
  }
  const optionValues = new Set<string>();
  for (const option of field.options) {
    if (optionValues.has(option.value)) {
      context.addIssue({ code: "custom", path: ["options"], message: `选项值“${option.value}”重复。` });
    }
    optionValues.add(option.value);
  }
});

export const fieldsSchema = z.array(fieldDefinitionSchema).max(100).superRefine((fields, context) => {
  const keys = new Set<string>();
  for (const [index, field] of fields.entries()) {
    if (keys.has(field.key)) {
      context.addIssue({ code: "custom", path: [index, "key"], message: `字段标识“${field.key}”重复。` });
    }
    keys.add(field.key);
  }
});

export const createCardTypeSchema = z.object({
  key: z.string().trim().regex(/^[a-z][a-z0-9_-]{1,62}$/, "类型标识需以小写字母开头。"),
  name: z.string().trim().min(1, "类型名称不能为空。").max(80),
  description: z.string().trim().max(500).default(""),
  fields: fieldsSchema.default([]),
});

export const updateCardTypeSchema = z.object({
  name: z.string().trim().min(1, "类型名称不能为空。").max(80),
  description: z.string().trim().max(500).default(""),
  fields: fieldsSchema,
  revision: z.number().int().positive(),
});

export const revisionSchema = z.object({ revision: z.number().int().positive() });

export const createCardSchema = z.object({
  cardTypeId: z.string().uuid("元卡片类型无效。"),
  title: z.string().trim().min(1, "卡片标题不能为空。").max(160),
  values: z.record(z.string(), z.unknown()).default({}),
});

export const updateCardSchema = z.object({
  title: z.string().trim().min(1, "卡片标题不能为空。").max(160),
  values: z.record(z.string(), z.unknown()).default({}),
  revision: z.number().int().positive(),
});

function isBlank(value: unknown): boolean {
  return value === undefined || value === null || value === "" || (Array.isArray(value) && value.length === 0);
}

function validateValue(field: FieldDefinition, value: unknown): string | null {
  if (isBlank(value)) return field.required ? `${field.name}为必填项。` : null;
  switch (field.type) {
    case "short_text":
    case "long_text":
    case "date":
      return typeof value === "string" ? null : `${field.name}需要填写文本。`;
    case "number":
      return typeof value === "number" && Number.isFinite(value) ? null : `${field.name}需要填写有效数字。`;
    case "boolean":
      return typeof value === "boolean" ? null : `${field.name}需要选择是或否。`;
    case "select":
      return typeof value === "string" && field.options.some((option) => option.value === value)
        ? null
        : `${field.name}的选项无效。`;
    case "multi_select":
      return Array.isArray(value) && value.every((item) => typeof item === "string" && field.options.some((option) => option.value === item))
        ? null
        : `${field.name}包含无效选项。`;
  }
}

export function validateCardValues(
  fields: FieldDefinition[],
  incomingValues: Record<string, unknown>,
): { values: Record<string, unknown>; issues: Record<string, string> } {
  const definitions = new Map(fields.map((field) => [field.key, field]));
  const issues: Record<string, string> = {};
  const values: Record<string, unknown> = {};

  for (const key of Object.keys(incomingValues)) {
    if (!definitions.has(key)) issues[key] = `字段“${key}”不在当前元卡片定义中。`;
  }

  for (const field of fields) {
    const supplied = Object.prototype.hasOwnProperty.call(incomingValues, field.key);
    const value = supplied ? incomingValues[field.key] : field.defaultValue;
    const error = validateValue(field, value);
    if (error) issues[field.key] = error;
    if (!isBlank(value)) values[field.key] = value;
  }

  return { values, issues };
}

export function validatePublishedEvolution(previous: FieldDefinition[], next: FieldDefinition[]): Record<string, string> {
  const issues: Record<string, string> = {};
  const nextByKey = new Map(next.map((field) => [field.key, field]));
  for (const oldField of previous) {
    const candidate = nextByKey.get(oldField.key);
    if (!candidate) {
      issues.fields = `已发布字段“${oldField.name}”不能删除。`;
      continue;
    }
    if (JSON.stringify(candidate) !== JSON.stringify(oldField)) {
      issues[oldField.key] = `已发布字段“${oldField.name}”不能修改；请新增字段。`;
    }
  }
  const previousKeys = new Set(previous.map((field) => field.key));
  for (const field of next) {
    if (!previousKeys.has(field.key) && field.required) {
      issues[field.key] = `新增字段“${field.name}”必须为非必填，确保旧卡片仍可使用。`;
    }
  }
  return issues;
}
