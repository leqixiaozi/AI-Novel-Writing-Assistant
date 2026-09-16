import type { DictionarySummary, FieldDefinition, FieldType, StandardFieldSemantic, TreeSelectionMode, TreeSelectionRule } from "../common/contracts";

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
  allowPublishedPresentationEdits?: boolean;
  dictionaries?:DictionarySummary[];
  semantics?:StandardFieldSemantic[];
  onChange: (fields: FieldDefinition[]) => void;
}

const DEFAULT_TREE_RULE:TreeSelectionRule={mode:"single",rootNodeId:null,depthMode:"whole_tree",relativeDepth:null,leafOnly:false,allowParentSelection:true,showFullPath:true,allowInlineCreate:false,aiSuggestible:true,minSelections:0,maxSelections:1};

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

export default function FieldBuilder({ fields, publishedKeys, allowPublishedPresentationEdits = false, dictionaries=[],semantics=[],onChange }: FieldBuilderProps) {
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
          <h2 id="nd-fields-title">这类资料要收集什么</h2>
        </div>
        <button className="nd-button nd-button-secondary" type="button" onClick={() => onChange([...fields, createField(fields.length, publishedKeys.size > 0)])}>
          ＋ 添加字段
        </button>
      </div>
      {semantics.length>0&&<label className="nd-control nd-field-template-picker"><span>从字段模板创建</span><select defaultValue="" onChange={event=>{const semantic=semantics.find(item=>item.id===event.target.value);if(!semantic)return;const choice=semantic.dataType==="select"||semantic.dataType==="multi_select",mode:TreeSelectionMode=semantic.dataType==="multi_select"?"multiple":"single";onChange([...fields,{...createField(fields.length,publishedKeys.size>0),name:semantic.name,description:semantic.description,type:semantic.dataType,standardFieldId:semantic.id,stateSettlement:semantic.settlementSuggestion,optionSource:choice&&semantic.recommendedDictionaryId?{kind:"dictionary_tree",dictionaryId:semantic.recommendedDictionaryId,rule:{...DEFAULT_TREE_RULE,mode,maxSelections:mode==="single"?1:null},settleOnChapter:semantic.settlementSuggestion!=="none"}:undefined}]);event.target.value="";}}><option value="">选择已定义的业务含义</option>{semantics.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select><small>创建后可独立调整，原模板不会反向改写卡片字段。</small></label>}

      {fields.length === 0 ? (
        <div className="nd-empty nd-empty-compact">还没有字段。添加“姓名”“人物定位”等信息，右侧会立即生成表单。</div>
      ) : (
        <div className="nd-field-list">
          {fields.map((field, index) => {
            const locked = publishedKeys.has(field.key);
            const choiceField = field.type === "select" || field.type === "multi_select";
            const dictionarySource = field.optionSource?.kind === "dictionary_tree" ? field.optionSource : null;
            const selectedDictionary = dictionarySource ? dictionaries.find((item) => item.id === dictionarySource.dictionaryId) ?? null : null;
            return (
              <article className={`nd-field-row${locked ? " is-locked" : ""}`} key={field.key}>
                <div className="nd-field-index" aria-hidden="true">{String(index + 1).padStart(2, "0")}</div>
                <div className="nd-field-main">
                  <div className="nd-grid-2">
                    <label className="nd-control">
                      <span>字段名称</span>
                      <input value={field.name} disabled={locked && !allowPublishedPresentationEdits} onChange={(event) => patch(index, { name: event.target.value })} />
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
                    <input value={field.description} disabled={locked && !allowPublishedPresentationEdits} placeholder="告诉填写者这项信息有什么用" onChange={(event) => patch(index, { description: event.target.value })} />
                  </label>
                  <div className="nd-grid-3">
                    <label className="nd-control">
                      <span>分组</span>
                      <input value={field.group} disabled={locked && !allowPublishedPresentationEdits} onChange={(event) => patch(index, { group: event.target.value })} />
                    </label>
                    <label className="nd-control">
                      <span>默认值</span>
                      {field.type === "boolean" ? (
                        <select value={defaultValueFor(field)} disabled={locked && !allowPublishedPresentationEdits} onChange={(event) => patch(index, { defaultValue: parseDefaultValue(field, event.target.value) })}>
                          <option value="">不预填</option><option value="true">是</option><option value="false">否</option>
                        </select>
                      ) : (
                        <input value={defaultValueFor(field)} disabled={locked && !allowPublishedPresentationEdits} inputMode={field.type === "number" ? "decimal" : undefined} onChange={(event) => patch(index, { defaultValue: parseDefaultValue(field, event.target.value) })} />
                      )}
                    </label>
                    <label className="nd-check-control">
                      <input type="checkbox" checked={field.required} disabled={locked || publishedKeys.size > 0} onChange={(event) => patch(index, { required: event.target.checked })} />
                      <span>必填</span>
                    </label>
                  </div>
                  {choiceField && (
                    <div className="nd-field-option-source">
                      <label className="nd-control"><span>选项来源</span><select disabled={locked} value={dictionarySource?"dictionary_tree":"inline"} onChange={event=>patch(index,event.target.value==="dictionary_tree"?{options:[],optionSource:{kind:"dictionary_tree",dictionaryId:dictionaries[0]?.id??"",rule:{...DEFAULT_TREE_RULE,mode:field.type==="multi_select"?"multiple":"single",maxSelections:field.type==="multi_select"?null:1},settleOnChapter:false}}:{optionSource:{kind:"inline"}})}><option value="inline">内嵌选项</option><option value="dictionary_tree" disabled={!dictionaries.length}>字典树</option></select></label>
                      {dictionarySource?<>
                        <div className="nd-form-grid">
                          <label className="nd-control"><span>绑定字典</span><select disabled={locked} value={dictionarySource.dictionaryId} onChange={event=>patch(index,{optionSource:{...dictionarySource,dictionaryId:event.target.value,rule:{...dictionarySource.rule,rootNodeId:null}}})}>{dictionaries.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
                          <label className="nd-control"><span>选择方式</span><select disabled={locked} value={dictionarySource.rule.mode} onChange={event=>{const mode=event.target.value as TreeSelectionMode;patch(index,{type:mode==="single"||mode==="cascade_single"?"select":"multi_select",optionSource:{...dictionarySource,rule:{...dictionarySource.rule,mode,maxSelections:mode==="single"||mode==="cascade_single"?1:dictionarySource.rule.maxSelections}}});}}><option value="single">单选</option><option value="multiple">多选</option><option value="cascade_single">逐级单选</option><option value="cascade_multiple">逐级多选</option></select></label>
                          <label className="nd-control"><span>可选范围</span><select disabled={locked} value={dictionarySource.rule.depthMode} onChange={event=>{const depthMode=event.target.value as TreeSelectionRule["depthMode"];patch(index,{optionSource:{...dictionarySource,rule:{...dictionarySource.rule,depthMode,rootNodeId:depthMode==="whole_tree"?null:dictionarySource.rule.rootNodeId,relativeDepth:depthMode==="relative_depth"?(dictionarySource.rule.relativeDepth??1):null}}});}}><option value="whole_tree">整棵树</option><option value="branch">包含指定节点的分支</option><option value="direct_children">仅指定节点的直接下级</option><option value="descendants">指定节点的所有后代</option><option value="relative_depth">指定节点以下若干层</option></select></label>
                          {dictionarySource.rule.depthMode!=="whole_tree"&&<label className="nd-control"><span>范围起点</span><select disabled={locked} value={dictionarySource.rule.rootNodeId??""} onChange={event=>patch(index,{optionSource:{...dictionarySource,rule:{...dictionarySource.rule,rootNodeId:event.target.value||null}}})}><option value="">请选择节点</option>{(selectedDictionary?.items??[]).filter(item=>item.status==="active").map(item=><option key={item.id} value={item.id}>{item.path.map(part=>part.label).join(" / ")||item.label}</option>)}</select></label>}
                          {dictionarySource.rule.depthMode==="relative_depth"&&<label className="nd-control"><span>向下开放层数</span><input disabled={locked} type="number" min="1" value={dictionarySource.rule.relativeDepth??1} onChange={event=>patch(index,{optionSource:{...dictionarySource,rule:{...dictionarySource.rule,relativeDepth:Math.max(1,Number(event.target.value)||1)}}})}/></label>}
                          <label className="nd-control"><span>最少选择</span><input disabled={locked} type="number" min="0" value={dictionarySource.rule.minSelections} onChange={event=>patch(index,{required:Number(event.target.value)>0,optionSource:{...dictionarySource,rule:{...dictionarySource.rule,minSelections:Math.max(0,Number(event.target.value)||0)}}})}/></label>
                          <label className="nd-control"><span>最多选择</span><input disabled={locked||field.type==="select"} type="number" min="1" placeholder="不限" value={dictionarySource.rule.maxSelections??""} onChange={event=>patch(index,{optionSource:{...dictionarySource,rule:{...dictionarySource.rule,maxSelections:event.target.value?Math.max(1,Number(event.target.value)):null}}})}/></label>
                        </div>
                        <div className="nd-tree-rule-checks">
                          <label className="nd-check-control"><input disabled={locked} type="checkbox" checked={dictionarySource.rule.leafOnly} onChange={event=>patch(index,{optionSource:{...dictionarySource,rule:{...dictionarySource.rule,leafOnly:event.target.checked}}})}/><span>仅允许最末级</span></label>
                          <label className="nd-check-control"><input disabled={locked} type="checkbox" checked={dictionarySource.rule.allowParentSelection} onChange={event=>patch(index,{optionSource:{...dictionarySource,rule:{...dictionarySource.rule,allowParentSelection:event.target.checked}}})}/><span>允许选择有下级的节点</span></label>
                          <label className="nd-check-control"><input disabled={locked} type="checkbox" checked={dictionarySource.rule.showFullPath} onChange={event=>patch(index,{optionSource:{...dictionarySource,rule:{...dictionarySource.rule,showFullPath:event.target.checked}}})}/><span>显示完整路径</span></label>
                          <label className="nd-check-control"><input disabled={locked} type="checkbox" checked={dictionarySource.rule.allowInlineCreate} onChange={event=>patch(index,{optionSource:{...dictionarySource,rule:{...dictionarySource.rule,allowInlineCreate:event.target.checked}}})}/><span>允许原地新增</span></label>
                          <label className="nd-check-control"><input disabled={locked} type="checkbox" checked={dictionarySource.rule.aiSuggestible} onChange={event=>patch(index,{aiSuggestible:event.target.checked,optionSource:{...dictionarySource,rule:{...dictionarySource.rule,aiSuggestible:event.target.checked}}})}/><span>允许 AI 建议</span></label>
                          <label className="nd-check-control"><input disabled={locked} type="checkbox" checked={dictionarySource.settleOnChapter} onChange={event=>patch(index,{optionSource:{...dictionarySource,settleOnChapter:event.target.checked}})}/><span>章节采用后结算变化</span></label>
                        </div>
                      </>:<label className="nd-control">
                      <span>选项（每行一个）</span>
                      <textarea
                        rows={3}
                        disabled={locked && !allowPublishedPresentationEdits}
                        value={field.options.map((option) => option.label).join("\n")}
                        onChange={(event) => patch(index, {
                          options: event.target.value.split("\n").map((label) => label.trim()).filter(Boolean).map((label, optionIndex) => ({ value: field.options[optionIndex]?.value ?? `option_${optionIndex + 1}`, label })),
                        })}
                      />
                      </label>}
                    </div>
                  )}
                  {locked && <p className="nd-lock-note">{allowPublishedPresentationEdits ? "稳定标识与数据类型保持不变；本书可以独立调整名称、说明、分组和选项显示。" : "已发布字段保持稳定；如需扩展，请添加新的非必填字段。"}</p>}
                </div>
                <div className="nd-field-actions">
                  <button type="button" title="上移" disabled={index === 0 || (locked && !allowPublishedPresentationEdits)} onClick={() => move(index, -1)}>↑</button>
                  <button type="button" title="下移" disabled={index === fields.length - 1 || (locked && !allowPublishedPresentationEdits)} onClick={() => move(index, 1)}>↓</button>
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
