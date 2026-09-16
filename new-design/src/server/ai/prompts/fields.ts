import { z } from "zod";
import { FIELD_TYPES } from "../../../common/contracts";

export const shortText = z.string().trim().min(1).max(160);
export const text = z.string().max(30000);
export const textList = z.array(z.string().trim().min(1).max(4000)).max(100);
export const valuesInput = z.record(z.string(), z.unknown());

export const fieldInput = z.object({
  key: z.string().min(1).max(160), name: z.string().max(300),
  description: z.string().max(4000),
  type: z.enum(FIELD_TYPES),
  required: z.boolean(), options: z.array(z.object({ value: z.string().min(1), label: z.string() }).passthrough()).max(10000),
  hidden: z.boolean().optional(), aiSuggestible: z.boolean().optional(),
}).passthrough();
export const typeInput = z.object({ key: z.string().min(1).max(160), name: z.string().max(300), description: text, fields: z.array(fieldInput).max(300) }).strict();
export type PromptField = z.infer<typeof fieldInput>;
export type PromptSchemaType = z.infer<typeof typeInput>;

export function assertUniqueKeys(items: Array<{ key: string }>, label: string): void {
  const keys = new Set<string>();
  for (const item of items) {
    if (["__proto__", "constructor", "prototype"].includes(item.key)) throw new Error(`${label}包含不安全的稳定键。`);
    if (keys.has(item.key)) throw new Error(`${label}包含重复的稳定键：${item.key}。`);
    keys.add(item.key);
  }
}

export function fieldOutput(field: PromptField): z.ZodType {
  let schema: z.ZodType;
  switch (field.type) {
    case "number": schema = z.number(); break;
    case "boolean": schema = z.boolean(); break;
    case "select": {
      const choices = [...new Set(field.options.map(item => item.value))];
      if (!choices.length) throw new Error(`“${field.name}”缺少允许选项，请先维护字典或选项。`);
      schema = z.enum(choices as [string, ...string[]]); break;
    }
    case "multi_select": {
      const choices = [...new Set(field.options.map(item => item.value))];
      schema = choices.length ? z.array(z.enum(choices as [string, ...string[]])).max(300) : z.array(z.never()).max(0);
      if (field.required) schema = (schema as z.ZodArray<z.ZodType>).min(1);
      break;
    }
    case "short_text": schema = field.required ? z.string().trim().min(1).max(field.key === "__title" ? 160 : 4000) : z.string().max(field.key === "__title" ? 160 : 4000); break;
    case "date": schema = field.required ? z.string().trim().min(1).max(100) : z.string().max(100); break;
    case "long_text": schema = field.required ? z.string().trim().min(1).max(30000) : text; break;
  }
  // Author-owned names/descriptions remain exclusively in user taskData, never system instructions.
  return schema;
}

export function fieldsOutput(fields: PromptField[], requireDeclared: boolean): z.ZodObject {
  assertUniqueKeys(fields, "字段规格");
  const shape: Record<string, z.ZodType> = Object.create(null) as Record<string, z.ZodType>;
  for (const field of fields) {
    if (field.hidden || field.aiSuggestible === false) {
      if (requireDeclared && field.required) throw new Error(`“${field.name}”为必填项但不允许 AI 生成，请调整规格或人工填写。`);
      continue;
    }
    const schema = fieldOutput(field);
    shape[field.key] = requireDeclared && field.required ? schema : schema.optional();
  }
  return z.object(shape).strict();
}

export function cardProposal(types: PromptSchemaType[], options: { evidence?: boolean; requireDeclared?: boolean } = {}): z.ZodType {
  if (!types.length) throw new Error("缺少可生成的内容类型规格，请先选择已发布的内容类型。");
  assertUniqueKeys(types, "内容类型规格");
  const schemas = types.map(type => z.object({
    [options.evidence ? "targetTypeKey" : "typeKey"]: z.literal(type.key),
    title: shortText,
    values: fieldsOutput(type.fields, options.requireDeclared !== false),
    ...(options.evidence ? { evidenceIndexes: z.array(z.number().int().nonnegative()).max(100), confidence: z.number().min(0).max(1).nullable() } : {}),
  }).strict());
  return schemas.length === 1 ? schemas[0]! : z.union([schemas[0]!,schemas[1]!,...schemas.slice(2)]);
}
