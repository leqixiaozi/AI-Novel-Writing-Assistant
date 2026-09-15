import { useId } from "react";
import type { FieldDefinition } from "../common/contracts";

interface DynamicFormProps {
  fields: FieldDefinition[];
  values: Record<string, unknown>;
  issues?: Record<string, string>;
  disabled?: boolean;
  preview?: boolean;
  scopeLabelByKey?: Record<string, string>;
  onChange?: (values: Record<string, unknown>) => void;
}

function valueOrDefault(field: FieldDefinition, values: Record<string, unknown>): unknown {
  return Object.prototype.hasOwnProperty.call(values, field.key) ? values[field.key] : field.defaultValue;
}

function isEmpty(value: unknown): boolean {
  return value === null || value === undefined || value === "" || (Array.isArray(value) && value.length === 0);
}

function isVisible(field: FieldDefinition, values: Record<string, unknown>): boolean {
  const rule = field.visibleWhen;
  if (!rule) return true;
  const actual = values[rule.fieldKey];
  if (rule.operator === "equals") return actual === rule.value;
  if (rule.operator === "not_equals") return actual !== rule.value;
  if (rule.operator === "is_empty") return isEmpty(actual);
  if (rule.operator === "is_not_empty") return !isEmpty(actual);
  return Array.isArray(actual) && actual.includes(rule.value);
}

export default function DynamicForm({ fields, values, issues = {}, disabled, preview, scopeLabelByKey = {}, onChange }: DynamicFormProps) {
  const formId = useId().replace(/:/g, "");
  const patch = (field: FieldDefinition, value: unknown) => onChange?.({ ...values, [field.key]: value });
  const groups = new Map<string, FieldDefinition[]>();
  for (const field of [...fields].filter((item)=>!item.hidden).sort((a, b) => a.order - b.order)) {
    if (!isVisible(field, values)) continue;
    const group = field.group.trim() || "基本信息";
    groups.set(group, [...(groups.get(group) ?? []), field]);
  }

  if (fields.length === 0) return <div className="nd-empty nd-empty-compact">添加字段后，这里会出现实际填写表单。</div>;

  return (
    <div className="nd-dynamic-form">
      {[...groups.entries()].map(([group, groupFields]) => (
        <fieldset key={group} className="nd-form-group">
          <legend>{group}</legend>
          {groupFields.map((field) => {
            const value = valueOrDefault(field, values);
            const inputDisabled = disabled || preview;
            const labelId = `nd-${formId}-${field.key}-label`;
            const helpId = field.description ? `nd-${formId}-${field.key}-help` : undefined;
            const errorId = issues[field.key] ? `nd-${formId}-${field.key}-error` : undefined;
            const describedBy = [helpId, errorId].filter(Boolean).join(" ") || undefined;
            return (
              <div className={`nd-control${issues[field.key] ? " has-error" : ""}`} key={field.key}>
                <span id={labelId}>{field.name}{field.required && <b aria-label="必填"> *</b>}{scopeLabelByKey[field.key] && <i className="nd-field-capability is-scope">{scopeLabelByKey[field.key]}</i>}{field.aiSuggestible && <i className="nd-field-capability">可由 AI 建议</i>}{field.stateSettlement === "tracked" && <i className="nd-field-capability">跟踪变化</i>}{field.stateSettlement === "lifecycle" && <i className="nd-field-capability">生命周期</i>}</span>
                {field.description && <small id={helpId}>{field.description}</small>}
                {field.type === "long_text" ? (
                  <textarea rows={4} disabled={inputDisabled} value={String(value ?? "")} aria-labelledby={labelId} aria-describedby={describedBy} aria-invalid={Boolean(issues[field.key])} onChange={(event) => patch(field, event.target.value)} />
                ) : field.type === "boolean" ? (
                  <select disabled={inputDisabled} value={value === true ? "true" : value === false ? "false" : ""} aria-labelledby={labelId} aria-describedby={describedBy} aria-invalid={Boolean(issues[field.key])} onChange={(event) => patch(field, event.target.value === "" ? null : event.target.value === "true")}>
                    <option value="">请选择</option><option value="true">是</option><option value="false">否</option>
                  </select>
                ) : field.type === "select" ? (
                  <select disabled={inputDisabled} value={String(value ?? "")} aria-labelledby={labelId} aria-describedby={describedBy} aria-invalid={Boolean(issues[field.key])} onChange={(event) => patch(field, event.target.value)}>
                    <option value="">请选择</option>{field.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                ) : field.type === "multi_select" ? (
                  <div className="nd-options" role="group" aria-labelledby={labelId} aria-describedby={describedBy}>
                    {field.options.map((option) => {
                      const selected = Array.isArray(value) && value.includes(option.value);
                      return (
                        <label key={option.value} className="nd-option">
                          <input type="checkbox" disabled={inputDisabled} checked={selected} onChange={(event) => {
                            const current = Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
                            patch(field, event.target.checked ? [...current, option.value] : current.filter((item) => item !== option.value));
                          }} />
                          <span>{option.label}</span>
                        </label>
                      );
                    })}
                  </div>
                ) : (
                  <input
                    type={field.type === "number" ? "number" : field.type === "date" ? "date" : "text"}
                    disabled={inputDisabled}
                    value={String(value ?? "")}
                    aria-labelledby={labelId}
                    aria-describedby={describedBy}
                    aria-invalid={Boolean(issues[field.key])}
                    onChange={(event) => patch(field, field.type === "number" ? (event.target.value === "" ? null : Number(event.target.value)) : event.target.value)}
                  />
                )}
                {issues[field.key] && <em id={errorId}>{issues[field.key]}</em>}
              </div>
            );
          })}
        </fieldset>
      ))}
    </div>
  );
}
