import { useEffect, useId, useRef, useState } from "react";
import type { DictionarySummary, FieldDefinition } from "../common/contracts";
import { newDesignApi } from "./api";
import { TreeSelector } from "./tree";
import { FormAiPanel, type FormAiContext } from "./businessForms/aiAssist";
import { selectableTreeNodeIds } from "../common/treePolicy";
import Help from './storyWorkspace/Help';

interface DynamicFormProps {
  fields: FieldDefinition[];
  values: Record<string, unknown>;
  issues?: Record<string, string>;
  disabled?: boolean;
  preview?: boolean;
  compactHelp?:boolean;
  scopeLabelByKey?: Record<string, string>;
  onChange?: (values: Record<string, unknown>) => void;
  aiContext?:FormAiContext;
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

function DictionaryTreeField({field,value,disabled,onChange}:{field:FieldDefinition;value:unknown;disabled?:boolean;onChange:(value:unknown)=>void}){
  const source=field.optionSource?.kind==="dictionary_tree"?field.optionSource:null,[dictionary,setDictionary]=useState<DictionarySummary|null>(null),[error,setError]=useState(""),[creatingParent,setCreatingParent]=useState<string|null|undefined>(undefined),[newName,setNewName]=useState(""),[newDescription,setNewDescription]=useState("");
  const [busy,setBusy]=useState(false),[pendingId,setPendingId]=useState<string|null>(null),[notice,setNotice]=useState("");
  const generation=useRef(0),inFlight=useRef(false),currentScope=useRef(""),disabledRef=useRef(disabled),changeRef=useRef(onChange),valueRef=useRef(value);
  const scope=source?`${source.dictionaryId}:${field.key}`:"",storageKey=`new-design:dictionary-inline:${scope}`;
  currentScope.current=scope;disabledRef.current=disabled;changeRef.current=onChange;valueRef.current=value;
  const retain=(id:string|null,name=newName,description=newDescription,parent=creatingParent)=>{try{if(id)sessionStorage.setItem(storageKey,JSON.stringify({dictionaryId:source?.dictionaryId,id,name,description,parent:parent??null}));else sessionStorage.removeItem(storageKey);return true;}catch{return false;}};
  useEffect(()=>{const sequence=++generation.current;setDictionary(null);setError("");setNotice("");setCreatingParent(undefined);setNewName("");setNewDescription("");setPendingId(null);setBusy(false);inFlight.current=false;if(!source)return;try{const raw=sessionStorage.getItem(storageKey);if(raw){const saved:unknown=JSON.parse(raw);if(saved&&typeof saved==="object"&&"dictionaryId"in saved&&saved.dictionaryId===source.dictionaryId&&"id"in saved&&typeof saved.id==="string"&&/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(saved.id)&&"name"in saved&&typeof saved.name==="string"&&"description"in saved&&typeof saved.description==="string"&&"parent"in saved&&(saved.parent===null||typeof saved.parent==="string")){setPendingId(saved.id);setNewName(saved.name);setNewDescription(saved.description);setCreatingParent(saved.parent);setNotice("原字典项新增结果尚待核对，填写和原节点凭证保留；不再次新增。");}}}catch{setError("字典新增恢复凭证无法读取，核对前不能再次新增。");setPendingId("unreadable");}void newDesignApi.getDictionary(source.dictionaryId).then(saved=>{if(sequence!==generation.current||currentScope.current!==scope)return;if(saved.id!==source.dictionaryId)throw new Error("字典结果不属于当前字段来源，请核对原字典。");setDictionary(saved);}).catch(loadError=>{if(sequence===generation.current&&currentScope.current===scope)setError(loadError instanceof Error?loadError.message:"字典树加载失败。");});return()=>{generation.current++;};},[scope]);
  if(!source)return null;
  const selectedIds=Array.isArray(value)?value.filter((item):item is string=>typeof item==="string"):typeof value==="string"&&value?[value]:[];
  const accept=(saved:DictionarySummary,id:string)=>{if(saved.id!==source.dictionaryId)throw new Error("新增回执不属于原字典，填写和凭证保留。");const created=saved.items.find(item=>item.id===id);if(!created)throw new Error("未核对到原节点 UUID，不能按同名节点代替；请只读核对原新增结果。");if(created.key!==`node_${id.replaceAll("-","").slice(0,12)}`||created.label!==newName.trim()||created.description!==newDescription.trim()||created.parentId!==(creatingParent??null)||created.status!=="active")throw new Error("原 UUID 的节点内容与原新增填写不一致，原填写和凭证保留；不能按其他内容代替新增回执。");setDictionary(saved);setPendingId(null);retain(null);setCreatingParent(undefined);setNewName("");setNewDescription("");const nodes=saved.items.map(item=>({id:item.id,parentId:item.parentId,name:item.label,status:item.status})),allowed=selectableTreeNodeIds(nodes,source.rule),next=[...new Set([...selectedIds,id])];if(!disabledRef.current&&JSON.stringify(valueRef.current)===JSON.stringify(value)&&allowed.has(id)&&(field.type==="select"||source.rule.maxSelections===null||next.length<=source.rule.maxSelections)){changeRef.current(field.type==="select"?id:next);setNotice("原字典节点已保存并选中。");}else setNotice("原字典节点已保存，未改动当前字段。请按字段的选择范围与数量规则明确选择。");};
  const saveChild=async()=>{if(disabledRef.current||inFlight.current||pendingId||!dictionary||dictionary.id!==source.dictionaryId||dictionary.scope!=="book"||!source.rule.allowInlineCreate||!newName.trim())return;const id=crypto.randomUUID(),sequence=generation.current,originalScope=scope,next={...dictionary,items:[...dictionary.items,{id,key:`node_${id.replaceAll("-","").slice(0,12)}`,label:newName.trim(),description:newDescription.trim(),parentId:creatingParent??null,value:{},sortOrder:dictionary.items.length*10+10,status:"active" as const,revision:1,currentVersionId:null,path:[],childCount:0,referenceCount:0}]};if(!retain(id)){setError("浏览器无法保留原节点凭证，尚未发送新增请求；填写保留，请检查网站存储权限。");return;}inFlight.current=true;setBusy(true);setPendingId(id);setError("");try{const saved=await newDesignApi.updateDictionary(next);if(sequence===generation.current&&currentScope.current===originalScope)accept(saved,id);}catch(saveError){if(sequence===generation.current&&currentScope.current===originalScope)setError(saveError instanceof Error?saveError.message:"新增字典项结果待核对，填写与原节点凭证保留。");}finally{if(sequence===generation.current&&currentScope.current===originalScope){inFlight.current=false;setBusy(false);}}};
  const check=async()=>{if(inFlight.current||!pendingId||pendingId==="unreadable")return;const sequence=generation.current,id=pendingId;inFlight.current=true;setBusy(true);setError("");try{const saved=await newDesignApi.getDictionary(source.dictionaryId);if(sequence===generation.current&&currentScope.current===scope)accept(saved,id);}catch(checkError){if(sequence===generation.current&&currentScope.current===scope)setError(checkError instanceof Error?checkError.message:"原新增结果尚未核对，不再次新增。");}finally{if(sequence===generation.current&&currentScope.current===scope){inFlight.current=false;setBusy(false);}}};
  return <>{dictionary?<TreeSelector label={field.name} nodes={[...dictionary.items].sort((a,b)=>a.sortOrder-b.sortOrder).map(item=>({id:item.id,parentId:item.parentId,name:item.label,description:item.description,status:item.status,sortOrder:item.sortOrder,path:item.path.map(part=>part.label)}))} rule={source.rule} selectedIds={selectedIds} disabled={disabled||busy||pendingId!==null} onChange={ids=>{if(!disabledRef.current&&!inFlight.current&&!pendingId)onChange(field.type==="select"?ids[0]??null:ids);}} onCreateChild={source.rule.allowInlineCreate&&dictionary.scope==="book"&&!pendingId?parentId=>{if(!disabledRef.current&&!inFlight.current)setCreatingParent(parentId);}:undefined}/>:<p className="nd-help-text">正在读取字典树…</p>}{creatingParent!==undefined&&<div className="nd-tree-inline-editor"><label className="nd-control"><span>中文名称</span><input autoFocus disabled={disabled||busy||pendingId!==null} value={newName} onChange={event=>setNewName(event.target.value)}/></label><label className="nd-control"><span>解释</span><input disabled={disabled||busy||pendingId!==null} value={newDescription} onChange={event=>setNewDescription(event.target.value)}/></label><div className="nd-row-actions"><button className="nd-button nd-button-secondary" type="button" disabled={busy||pendingId!==null} onClick={()=>setCreatingParent(undefined)}>取消</button><button className="nd-button nd-button-primary" type="button" disabled={disabled||busy||pendingId!==null||!newName.trim()} onClick={()=>void saveChild()}>{busy?"正在核对…":"新增并选中"}</button></div></div>}{pendingId&&<p role="status">原新增结果待核对；未找到原节点不证明未写入，不再次生成节点。<button type="button" disabled={busy||pendingId==="unreadable"} onClick={()=>void check()}>只读核对原字典项</button></p>}{notice&&<p role="status">{notice}</p>}{error&&<em role="alert">{error}</em>}</>;
}

export default function DynamicForm({ fields, values, issues = {}, disabled, preview, compactHelp=false, scopeLabelByKey = {}, onChange, aiContext }: DynamicFormProps) {
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
      {aiContext&&!preview&&<FormAiPanel context={aiContext} fields={fields} values={values} disabled={disabled}/>}
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
                {field.description && (compactHelp?<span id={helpId}><Help label={field.name}>{field.description}</Help></span>:<small id={helpId}>{field.description}</small>)}
                {field.optionSource?.kind === "dictionary_tree" ? (
                  <DictionaryTreeField field={field} value={value} disabled={inputDisabled} onChange={next=>patch(field,next)} />
                ) : field.type === "long_text" ? (
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
