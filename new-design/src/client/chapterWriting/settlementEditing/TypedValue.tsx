import type {FieldDefinition,TreeSelectionRule} from "../../../common/contracts";
import {TreeSelector,type TreeSelectorNode} from "../../tree";

export interface FrozenValueChoices {nodes?:TreeSelectorNode[];rule?:TreeSelectionRule;objects?:Array<{id:string;label:string}>;}
export function valueLabel(value:unknown,field:FieldDefinition|null,choices:FrozenValueChoices={}):string {
  if(value===null||value===undefined||value==="")return "未记录";
  if(Array.isArray(value))return value.length?value.map(item=>valueLabel(item,field,choices)).join("、"):"未选择";
  if(typeof value==="boolean")return value?"是":"否";
  if(typeof value==="number")return String(value);
  if(typeof value==="string"){
    const option=field?.options.find(item=>item.value===value),node=choices.nodes?.find(item=>item.id===value),object=choices.objects?.find(item=>item.id===value);
    if(option)return option.label;if(node)return node.path?.length?node.path.join("／"):node.name;if(object)return object.label;
    if(field?.optionSource?.kind==="dictionary_tree"||choices.objects)return "引用资料不可用，请核对来源";
    if(/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(value))return "历史引用，请核对来源";
    return value;
  }
  return "此历史值需要核对，不能用文本直接覆盖";
}
export default function TypedValue({label,field,value,choices={},disabled=false,readOnly=false,onChange}:{label:string;field:FieldDefinition;value:unknown;choices?:FrozenValueChoices;disabled?:boolean;readOnly?:boolean;onChange?:(value:unknown)=>void}){
  if(readOnly)return <div className="nd-settlement-value"><span>{label}</span><p>{valueLabel(value,field,choices)}</p></div>;
  if(field.optionSource?.kind==="dictionary_tree")return <div className="nd-settlement-value"><span>{label}</span>{choices.nodes&&choices.rule?<TreeSelector label={label} nodes={choices.nodes} rule={{...choices.rule,allowInlineCreate:false,aiSuggestible:false}} selectedIds={Array.isArray(value)?value.filter((item):item is string=>typeof item==="string"):typeof value==="string"&&value?[value]:[]} disabled={disabled} onChange={ids=>onChange?.(field.type==="select"?ids[0]??null:ids)}/>:<p role="alert">字典来源无法读取，请先核对资料，不会改用自由输入。</p>}</div>;
  if(choices.objects)return <label>{label}<select disabled={disabled} value={typeof value==="string"?value:""} onChange={event=>onChange?.(event.target.value||null)}><option value="">请选择资料</option>{choices.objects.map(item=><option value={item.id} key={item.id}>{item.label}</option>)}</select></label>;
  if(field.type==="boolean")return <label>{label}<select disabled={disabled} value={value===true?"yes":value===false?"no":""} onChange={event=>onChange?.(event.target.value===""?null:event.target.value==="yes")}><option value="">请选择</option><option value="yes">是</option><option value="no">否</option></select></label>;
  if(field.type==="select")return <label>{label}<select disabled={disabled} value={typeof value==="string"?value:""} onChange={event=>onChange?.(event.target.value||null)}><option value="">请选择</option>{field.options.map(item=><option value={item.value} key={item.value}>{item.label}</option>)}</select></label>;
  if(field.type==="multi_select")return <fieldset disabled={disabled}><legend>{label}</legend>{field.options.map(item=><label key={item.value}><input type="checkbox" checked={Array.isArray(value)&&value.includes(item.value)} onChange={event=>{const current=Array.isArray(value)?value.filter((item):item is string=>typeof item==="string"):[];onChange?.(event.target.checked?[...current,item.value]:current.filter(choice=>choice!==item.value));}}/>{item.label}</label>)}</fieldset>;
  if(field.type==="long_text")return <label>{label}<textarea disabled={disabled} rows={3} value={typeof value==="string"?value:""} onChange={event=>onChange?.(event.target.value)}/></label>;
  return <label>{label}<input disabled={disabled} type={field.type==="number"?"number":field.type==="date"?"date":"text"} value={typeof value==="number"||typeof value==="string"?value:""} onChange={event=>onChange?.(field.type==="number"?(event.target.value===""?null:Number(event.target.value)):event.target.value)}/></label>;
}
