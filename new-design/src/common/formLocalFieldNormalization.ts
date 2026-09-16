import type {FormLocalFieldDefinition,TreeSelectionRule} from "./contracts";

/** Mirrors only fieldDefinitionSchema's declared defaults and trims.
 * No validation relaxation: required order/type/source IDs and unknown extensions
 * remain untouched for the strict write validator to accept or reject. */
export function normalizeFormLocalField(field:FormLocalFieldDefinition):FormLocalFieldDefinition {
  const normalized=structuredClone(field);
  if(typeof normalized.key==='string')normalized.key=normalized.key.trim();
  if(typeof normalized.name==='string')normalized.name=normalized.name.trim();
  if(normalized.description===undefined)normalized.description='';
  else if(typeof normalized.description==='string')normalized.description=normalized.description.trim();
  if(normalized.group===undefined)normalized.group='基本信息';
  else if(typeof normalized.group==='string')normalized.group=normalized.group.trim();
  if(normalized.required===undefined)normalized.required=false;
  normalized.defaultValue=normalized.defaultValue??null;
  if(normalized.options===undefined)normalized.options=[];
  else if(Array.isArray(normalized.options))for(const option of normalized.options){if(option&&typeof option==='object'){if(typeof option.value==='string')option.value=option.value.trim();if(typeof option.label==='string')option.label=option.label.trim();}}
  const visibility=normalized.visibleWhen;
  if(visibility&&typeof visibility==='object'&&typeof visibility.fieldKey==='string')visibility.fieldKey=visibility.fieldKey.trim();
  const source=normalized.optionSource;
  if(source&&typeof source==='object'&&source.kind==='dictionary_tree'){
    if(source.settleOnChapter===undefined)source.settleOnChapter=false;
    // The rule itself is required; do not invent one for a missing source contract.
    if(source.rule&&typeof source.rule==='object'&&!Array.isArray(source.rule)){
      const defaults:Omit<TreeSelectionRule,'mode'|'depthMode'>={rootNodeId:null,relativeDepth:null,leafOnly:false,allowParentSelection:true,showFullPath:true,allowInlineCreate:false,aiSuggestible:true,minSelections:0,maxSelections:null};
      const rule=source.rule;
      source.rule={...defaults,...rule};
      // Explicit undefined behaves like Zod .default; null/invalid supplied values
      // do not and must remain available to strict validation.
      source.rule.rootNodeId=rule.rootNodeId===undefined?defaults.rootNodeId:rule.rootNodeId;
      source.rule.relativeDepth=rule.relativeDepth===undefined?defaults.relativeDepth:rule.relativeDepth;
      source.rule.leafOnly=rule.leafOnly===undefined?defaults.leafOnly:rule.leafOnly;
      source.rule.allowParentSelection=rule.allowParentSelection===undefined?defaults.allowParentSelection:rule.allowParentSelection;
      source.rule.showFullPath=rule.showFullPath===undefined?defaults.showFullPath:rule.showFullPath;
      source.rule.allowInlineCreate=rule.allowInlineCreate===undefined?defaults.allowInlineCreate:rule.allowInlineCreate;
      source.rule.aiSuggestible=rule.aiSuggestible===undefined?defaults.aiSuggestible:rule.aiSuggestible;
      source.rule.minSelections=rule.minSelections===undefined?defaults.minSelections:rule.minSelections;
      source.rule.maxSelections=rule.maxSelections===undefined?defaults.maxSelections:rule.maxSelections;
    }
  }
  return normalized;
}
