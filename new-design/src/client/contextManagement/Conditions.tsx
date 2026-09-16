import type { ContextAuthorCatalog } from "../../common/contextAuthor";
import type { ContextActivationField, ContextActivationOperator, ContextActivationRule } from "../../common/contracts";
import { replaceActivationChild } from "../../common/contextAuthorEditing";
import { ContextConditionValue } from "./Controls";

const fields:Record<ContextActivationField,string>={task_key:"任务",task_group:"任务组",content_type:"内容类型",tag:"标签",material_status:"资料状态",canonical_status:"事实状态",volume:"卷",chapter:"章",scene:"场景",story_range:"故事范围",relation_exists:"关系存在",association_exists:"挂载存在",source_type:"来源类型",stale:"资料失效",manual_switch:"手动开关"};
const operators:Record<ContextActivationOperator,string>={equals:"等于",not_equals:"不等于",in:"属于",not_in:"不属于",contains:"包含",exists:"存在",not_exists:"不存在",gte:"大于等于",lte:"小于等于",between:"介于",enabled:"已开启"};

export function ContextConditions({catalog,rule,onChange,depth=0}:{catalog:ContextAuthorCatalog|null;rule:ContextActivationRule;onChange:(rule:ContextActivationRule)=>void;depth?:number}){
  if(rule.kind==="condition")return <div className="nd-context-condition-row">
    <select aria-label="条件字段" value={rule.field} onChange={event=>onChange({...rule,field:event.target.value as ContextActivationField,value:""})}>{Object.entries(fields).map(([value,label])=><option value={value} key={value}>{label}</option>)}</select>
    <select aria-label="条件判断" value={rule.operator} onChange={event=>onChange({...rule,operator:event.target.value as ContextActivationOperator})}>{Object.entries(operators).map(([value,label])=><option value={value} key={value}>{label}</option>)}</select>
    <ContextConditionValue catalog={catalog} condition={rule} index={0} onChange={value=>onChange({...rule,value})}/>
  </div>;
  return <fieldset className="nd-context-author-group"><legend>{depth?"条件分组":"激活条件"}</legend>
    <label className="nd-control"><span>组合关系</span><select value={rule.operator} onChange={event=>onChange({...rule,operator:event.target.value as "and"|"or"})}><option value="and">全部满足</option><option value="or">任一满足</option></select></label>
    {rule.items.map((child,index)=><div className="nd-context-author-child" key={index}><ContextConditions catalog={catalog} rule={child} depth={depth+1} onChange={value=>onChange(replaceActivationChild(rule,index,value))}/><button type="button" aria-label={`删除第 ${index+1} 项条件或分组`} onClick={()=>onChange(replaceActivationChild(rule,index,null))}>移除</button></div>)}
    <div className="nd-context-actions"><button className="nd-button nd-button-secondary" type="button" disabled={rule.items.length>=40} onClick={()=>onChange({...rule,items:[...rule.items,{kind:"condition",field:"task_key",operator:"equals",value:""}]})}>＋ 添加条件</button><button className="nd-button nd-button-secondary" type="button" disabled={depth>=3||rule.items.length>=40} onClick={()=>onChange({...rule,items:[...rule.items,{kind:"group",operator:"and",items:[]}]})}>＋ 添加分组</button></div>
  </fieldset>;
}
