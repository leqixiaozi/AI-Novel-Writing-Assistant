import type {FieldDefinition} from "../../common/contracts";
import type {SettlementRelationDefinition} from "../../common/chapterSettlementEditing";

export default function DimensionEditor({fields,dimensions,disabled,onChange}:{fields:FieldDefinition[];dimensions:SettlementRelationDefinition["dimensions"];disabled:boolean;onChange:(dimensions:SettlementRelationDefinition["dimensions"])=>void}){
  const patch=(index:number,value:Partial<SettlementRelationDefinition["dimensions"][number]>)=>onChange(dimensions.map((item,position)=>position===index?{...item,...value}:item));
  return <section className="nd-relation-dimensions"><div className="nd-section-heading"><div><h3>可结算维度</h3><p>选择正式属性并明确记录方式，章节结算只开放可直接跟踪的维度。</p></div><button type="button" disabled={disabled} onClick={()=>onChange([...dimensions,{fieldKey:"",label:"",direction:"forward",policy:"tracked",mode:"absolute"}])}>添加维度</button></div>
    {dimensions.length?dimensions.map((item,index)=>{const field=fields.find(field=>field.key===item.fieldKey);return <div className="nd-relation-dimension" key={index} data-dimension-index={index}>
      <label>对应正式属性<select disabled={disabled} value={item.fieldKey} onChange={event=>{const field=fields.find(item=>item.key===event.target.value);patch(index,{fieldKey:event.target.value,label:field?.name??"",mode:item.mode==="delta"&&field?.type!=="number"?"absolute":item.mode});}}><option value="">请选择属性</option>{fields.map(field=><option value={field.key} key={field.key}>{field.name}</option>)}</select></label>
      <label>中文名称<input disabled={disabled} value={item.label} onChange={event=>patch(index,{label:event.target.value})}/></label>
      <label>关系方向<select disabled={disabled} value={item.direction} onChange={event=>patch(index,{direction:event.target.value as typeof item.direction})}><option value="forward">从来源到目标</option><option value="inverse">从目标到来源</option><option value="bidirectional">双方共享</option></select></label>
      <label>结算范围<select disabled={disabled} value={item.policy} onChange={event=>patch(index,{policy:event.target.value as typeof item.policy})}><option value="tracked">跟踪变化</option><option value="lifecycle_only">只记生命周期</option><option value="derived">派生状态，不直接填写</option></select></label>
      <label>填写方式<select disabled={disabled} value={item.mode} onChange={event=>patch(index,{mode:event.target.value as typeof item.mode})}><option value="absolute">填写变化后的值</option><option value="delta" disabled={field?.type!=="number"}>填写数字变化量</option><option value="lifecycle">记录生命周期进度</option><option value="derived">按来源推导，不直接填写</option></select></label>
      {!field&&<p role="alert">此维度缺少对应正式属性，请选择或补充属性后保存。</p>}<button type="button" disabled={disabled} onClick={()=>onChange(dimensions.filter((_,position)=>position!==index))}>移除此维度</button>
    </div>;}):<p>尚未配置可结算维度。发布属性并配置维度后，才可在章节结算中选择关系状态。</p>}
  </section>;
}
