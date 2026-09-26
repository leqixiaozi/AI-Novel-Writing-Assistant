import type {FieldDefinition,RelationTypeSummary} from '../../common/contracts';
import DynamicForm from '../DynamicForm';

export default function RelationProperties({type,values,disabled,onChange}:{type:RelationTypeSummary|undefined;values:Record<string,unknown>;disabled:boolean;onChange:(values:Record<string,unknown>)=>void}){
 if(!type)return null;
 const fields:FieldDefinition[]=type.propertiesSchema.map((property,index)=>({...property,description:'',defaultValue:null,options:[],group:'关系属性',order:index}));
 const unknown=Object.keys(values).filter(key=>!fields.some(field=>field.key===key));
 return <>{unknown.length>0&&<p role="alert">来源属性 {unknown.join('、')} 不属于所选规则。请选择对应规则，或明确移除这些属性后填写目标关系。</p>}{unknown.length>0&&<button className="nd-button" disabled={disabled} onClick={()=>onChange(Object.fromEntries(Object.entries(values).filter(([key])=>!unknown.includes(key))))}>移除未映射属性</button>}<DynamicForm fields={fields} values={values} disabled={disabled} compactHelp onChange={next=>onChange({...Object.fromEntries(unknown.map(key=>[key,values[key]])),...next})}/></>;
}
