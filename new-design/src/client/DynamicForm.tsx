import { useEffect, useId, useState } from "react";
import type { DictionarySummary, FieldDefinition } from "../common/contracts";
import { newDesignApi } from "./api";
import { TreeSelector } from "./tree";
import { FormAiPanel, type FormAiContext } from "./businessForms/aiAssist";

interface DynamicFormProps {
  fields: FieldDefinition[];
  values: Record<string, unknown>;
  issues?: Record<string, string>;
  disabled?: boolean;
  preview?: boolean;
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
  useEffect(()=>{if(!source)return;void newDesignApi.getDictionary(source.dictionaryId).then(setDictionary).catch(loadError=>setError(loadError instanceof Error?loadError.message:"字典树加载失败。"));},[source?.dictionaryId]);
  if(!source)return null;
  const selectedIds=Array.isArray(value)?value.filter((item):item is string=>typeof item==="string"):typeof value==="string"&&value?[value]:[];
  const saveChild=async()=>{if(!dictionary||!newName.trim())return;const id=crypto.randomUUID(),next={...dictionary,items:[...dictionary.items,{id,key:`node_${id.replaceAll("-","").slice(0,12)}`,label:newName.trim(),description:newDescription.trim(),parentId:creatingParent??null,value:{},sortOrder:dictionary.items.length*10+10,status:"active" as const,revision:1,currentVersionId:null,path:[],childCount:0,referenceCount:0}]};try{const saved=await newDesignApi.updateDictionary(next);setDictionary(saved);setCreatingParent(undefined);setNewName("");setNewDescription("");const created=saved.items.find(item=>item.id===id)??saved.items.find(item=>item.label===newName.trim()&&item.parentId===(creatingParent??null));if(created)onChange(field.type==="select"?created.id:[...selectedIds,created.id]);}catch(saveError){setError(saveError instanceof Error?saveError.message:"新增字典项失败。");}};
  return <>{dictionary?<TreeSelector label={field.name} nodes={dictionary.items.map(item=>({id:item.id,parentId:item.parentId,name:item.label,description:item.description,status:item.status,path:item.path.map(part=>part.label)}))} rule={source.rule} selectedIds={selectedIds} disabled={disabled} onChange={ids=>onChange(field.type==="select"?ids[0]??null:ids)} onCreateChild={source.rule.allowInlineCreate&&dictionary.scope==="book"?parentId=>setCreatingParent(parentId):undefined}/>:<p className="nd-help-text">正在读取字典树…</p>}{creatingParent!==undefined&&<div className="nd-tree-inline-editor"><label className="nd-control"><span>中文名称</span><input autoFocus value={newName} onChange={event=>setNewName(event.target.value)}/></label><label className="nd-control"><span>解释</span><input value={newDescription} onChange={event=>setNewDescription(event.target.value)}/></label><div className="nd-row-actions"><button className="nd-button nd-button-secondary" type="button" onClick={()=>setCreatingParent(undefined)}>取消</button><button className="nd-button nd-button-primary" type="button" disabled={!newName.trim()} onClick={()=>void saveChild()}>新增并选中</button></div></div>}{error&&<em role="alert">{error}</em>}</>;
}

export default function DynamicForm({ fields, values, issues = {}, disabled, preview, scopeLabelByKey = {}, onChange, aiContext }: DynamicFormProps) {
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
                {field.description && <small id={helpId}>{field.description}</small>}
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
