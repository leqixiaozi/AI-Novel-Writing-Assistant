import type { FieldDefinition, FieldType } from "../common/contracts";

const TYPE_OPTIONS: Array<{ value: FieldType; label: string }> = [
  { value: "short_text", label: "短文本" },
  { value: "long_text", label: "长文本" },
  { value: "number", label: "数字" },
  { value: "boolean", label: "是 / 否" },
  { value: "select", label: "单选" },
  { value: "multi_select", label: "多选" },
  { value: "date", label: "日期" },
];

interface FieldBuilderProps {
  fields: FieldDefinition[];
  publishedKeys: Set<string>;
  onChange: (fields: FieldDefinition[]) => void;
}

function createField(order: number, published: boolean): FieldDefinition {
  return {
    key: `field_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    name: "新字段",
    description: "",
    type: "short_text",
    required: published ? false : false,
    defaultValue: null,
    options: [],
    group: "基本信息",
    order,
  };
}

function defaultValueFor(field: FieldDefinition): string {
  if (field.defaultValue === null || field.defaultValue === undefined) return "";
  if (Array.isArray(field.defaultValue)) return field.defaultValue.join(", ");
  return String(field.defaultValue);
}

function parseDefaultValue(field: FieldDefinition, raw: string): unknown {
  if (!raw.trim()) return null;
  if (field.type === "number") return Number(raw);
  if (field.type === "boolean") return raw === "true";
  if (field.type === "multi_select") return raw.split(",").map((item) => item.trim()).filter(Boolean);
  return raw;
}

export default function FieldBuilder({ fields, publishedKeys, onChange }: FieldBuilderProps) {
  const patch = (index: number, next: Partial<FieldDefinition>) => {
    onChange(fields.map((field, fieldIndex) => fieldIndex === index ? { ...field, ...next } : field));
  };
  const move = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= fields.length) return;
    const next = [...fields];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next.map((field, order) => ({ ...field, order })));
  };

  return (
    <section className="nd-section" aria-labelledby="nd-fields-title">
      <div className="nd-section-heading">
        <div>
          <p className="nd-kicker">字段定义</p>
          <h2 id="nd-fields-title">这类卡片要收集什么</h2>
        </div>
        <button className="nd-button nd-button-secondary" type="button" onClick={() => onChange([...fields, createField(fields.length, publishedKeys.size > 0)])}>
          ＋ 添加字段
        </button>
      </div>

      {fields.length === 0 ? (
        <div className="nd-empty nd-empty-compact">还没有字段。添加“姓名”“人物定位”等信息，右侧会立即生成表单。</div>
      ) : (
        <div className="nd-field-list">
          {fields.map((field, index) => {
            const locked = publishedKeys.has(field.key);
            const choiceField = field.type === "select" || field.type === "multi_select";
            return (
              <article className={`nd-field-row${locked ? " is-locked" : ""}`} key={field.key}>
                <div className="nd-field-index" aria-hidden="true">{String(index + 1).padStart(2, "0")}</div>
                <div className="nd-field-main">
                  <div className="nd-grid-2">
                    <label className="nd-control">
                      <span>字段名称</span>
                      <input value={field.name} disabled={locked} onChange={(event) => patch(index, { name: event.target.value })} />
                    </label>
                    <label className="nd-control">
                      <span>字段类型</span>
                      <select value={field.type} disabled={locked} onChange={(event) => patch(index, { type: event.target.value as FieldType, defaultValue: null, options: [] })}>
                        {TYPE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                      </select>
                    </label>
                  </div>
                  <label className="nd-control">
                    <span>解释</span>
                    <input value={field.description} disabled={locked} placeholder="告诉填写者这项信息有什么用" onChange={(event) => patch(index, { description: event.target.value })} />
                  </label>
                  <div className="nd-grid-3">
                    <label className="nd-control">
                      <span>分组</span>
                      <input value={field.group} disabled={locked} onChange={(event) => patch(index, { group: event.target.value })} />
                    </label>
                    <label className="nd-control">
                      <span>默认值</span>
                      {field.type === "boolean" ? (
                        <select value={defaultValueFor(field)} disabled={locked} onChange={(event) => patch(index, { defaultValue: parseDefaultValue(field, event.target.value) })}>
                          <option value="">不预填</option><option value="true">是</option><option value="false">否</option>
                        </select>
                      ) : (
                        <input value={defaultValueFor(field)} disabled={locked} inputMode={field.type === "number" ? "decimal" : undefined} onChange={(event) => patch(index, { defaultValue: parseDefaultValue(field, event.target.value) })} />
                      )}
                    </label>
                    <label className="nd-check-control">
                      <input type="checkbox" checked={field.required} disabled={locked || publishedKeys.size > 0} onChange={(event) => patch(index, { required: event.target.checked })} />
                      <span>必填</span>
                    </label>
                  </div>
                  {choiceField && (
                    <label className="nd-control">
                      <span>选项（每行一个）</span>
                      <textarea
                        rows={3}
                        disabled={locked}
                        value={field.options.map((option) => option.label).join("\n")}
                        onChange={(event) => patch(index, {
                          options: event.target.value.split("\n").map((label) => label.trim()).filter(Boolean).map((label, optionIndex) => ({ value: `option_${optionIndex + 1}`, label })),
                        })}
                      />
                    </label>
                  )}
                  {locked && <p className="nd-lock-note">已发布字段保持稳定；如需扩展，请添加新的非必填字段。</p>}
                </div>
                <div className="nd-field-actions">
                  <button type="button" title="上移" disabled={index === 0 || locked} onClick={() => move(index, -1)}>↑</button>
                  <button type="button" title="下移" disabled={index === fields.length - 1 || locked} onClick={() => move(index, 1)}>↓</button>
                  <button type="button" title="删除" disabled={locked} onClick={() => onChange(fields.filter((_, fieldIndex) => fieldIndex !== index).map((item, order) => ({ ...item, order })))}>×</button>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
