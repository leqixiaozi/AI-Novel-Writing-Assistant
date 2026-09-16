export type RunInputSchema=Record<string,unknown>;
export interface RunInputIssue {path:string;label:string;message:string;}
const unsafe=new Set(['__proto__','constructor','prototype']);
const annotations=new Set(['$schema','$id','title','description','default','examples','readOnly','writeOnly','deprecated','x-label']);
const constraints=new Set(['type','properties','required','additionalProperties','items','enum','const','minLength','maxLength','minimum','maximum','exclusiveMinimum','exclusiveMaximum','multipleOf','minItems','maxItems','uniqueItems','format']);
export const runInputRecord=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
export function runInputLabel(schema:RunInputSchema,index=0):string {
 const label=schema['x-label']??schema.title;return typeof label==='string'&&/[\u3400-\u9fff]/u.test(label)?label:`填写项目 ${index+1}`;
}
export function runInputSchemaIssues(schema:unknown,path='',depth=0):RunInputIssue[] {
 const issue=(message:string):RunInputIssue[]=>[{path,label:'输入规格',message}];
 if(depth>8||!runInputRecord(schema))return issue('该输入规格超出安全表单范围，请使用原来源业务表单；本次输入保留。');
 for(const key of Object.keys(schema))if(!annotations.has(key)&&!constraints.has(key))return issue('此合同含尚未支持的组合或条件规则，不能简化后运行；请核对高级规格或返回原业务入口。');
 if(schema.const!==undefined){if(Object.keys(schema).some(key=>!annotations.has(key)&&!['const','type'].includes(key)))return issue('固定输入还包含未解释的附加约束，不能只采用固定值而忽略规则。');const value=schema.const,kind=Array.isArray(value)?'array':value===null?'null':typeof value==='object'?'object':typeof value;if(schema.type!==undefined&&schema.type!==kind&&!(schema.type==='integer'&&typeof value==='number'&&Number.isInteger(value)))return issue('固定输入与发布类型不一致，请核对原合同。');return [];}
 if(!['object','array','string','number','integer','boolean','null'].includes(String(schema.type)))return issue('该合同未明确输入类型，不能按文本猜测；请返回合同维护核对正式规格。');
 if(schema.format!==undefined&&!['date','date-time','email','uri'].includes(String(schema.format)))return issue('此字段使用尚未支持的特殊格式；保留原输入，不能凭自由文本替代精确对象来源。');
 if(schema.enum!==undefined&&(!Array.isArray(schema.enum)||schema.enum.length>200||schema.enum.some(item=>item!==null&&typeof item==='object')))return issue('此字段的选项超出安全表单范围，请返回原业务表单选择。');
 for(const key of ['minLength','maxLength','minItems','maxItems'])if(schema[key]!==undefined&&(typeof schema[key]!=='number'||!Number.isInteger(schema[key])||Number(schema[key])<0))return issue('此版本的长度或数量规则不合法，不能忽略后运行。');
 for(const key of ['minimum','maximum','exclusiveMinimum','exclusiveMaximum','multipleOf'])if(schema[key]!==undefined&&(typeof schema[key]!=='number'||!Number.isFinite(schema[key])||key==='multipleOf'&&Number(schema[key])<=0))return issue('此版本的数字范围或步长规则不合法，不能忽略后运行。');
 if(schema.type==='object') {
  if(!runInputRecord(schema.properties))return issue('此合同没有已发布字段清单，不能使用任意 JSON 作为运行输入。');
  if(Object.keys(schema.properties).length>100)return issue('本合同字段超过完整表单上限，不会截断后运行。');
  if(schema.additionalProperties!==undefined&&typeof schema.additionalProperties!=='boolean')return issue('此合同含动态附加字段，普通表单尚不支持，输入保留。');
  if(schema.required!==undefined&&(!Array.isArray(schema.required)||schema.required.some(key=>typeof key!=='string'||!Object.hasOwn(schema.properties as Record<string,unknown>,key))))return issue('此合同的必填清单与实际发布字段不一致，不能忽略规则后运行。');
  const issues:RunInputIssue[]=[];Object.entries(schema.properties).forEach(([key,child],index)=>{if(unsafe.has(key))issues.push({path:`${path}.${key}`,label:'输入字段',message:'输入规格包含不安全字段，运行已阻止。'});else issues.push(...runInputSchemaIssues(child,`${path}.${key}`,depth+1).map(item=>({...item,label:runInputRecord(child)?runInputLabel(child,index):'输入字段'})));});return issues;
 }
 return schema.type==='array'?runInputSchemaIssues(schema.items,`${path}[]`,depth+1):[];
}
function same(a:unknown,b:unknown):boolean {
 if(a===b)return true;if(Array.isArray(a)&&Array.isArray(b))return a.length===b.length&&a.every((value,index)=>same(value,b[index]));
 if(runInputRecord(a)&&runInputRecord(b))return Object.keys(a).length===Object.keys(b).length&&Object.keys(a).every(key=>Object.hasOwn(b,key)&&same(a[key],b[key]));return false;
}
export function validateRunInput(schema:RunInputSchema,value:unknown,path='',label='本次输入'):RunInputIssue[] {
 const issues=runInputSchemaIssues(schema,path);if(issues.length)return issues;
 const fail=(message:string)=>[{path,label,message}];
 if(schema.const!==undefined)return same(schema.const,value)?[]:fail('该发布版本的输入已固定，不能修改为另一份内容。');
 if(schema.enum!==undefined&&!(schema.enum as unknown[]).some(option=>same(option,value)))return fail('请从此版本提供的选项中选择。');
 if(schema.type==='object') {
  if(!runInputRecord(value))return fail('请填写完整表单对象，不使用数组或单个文本。');
  const fields=schema.properties as Record<string,RunInputSchema>,required=Array.isArray(schema.required)?schema.required:[];
  const result:RunInputIssue[]=[];
  for(const key of Object.keys(value))if(unsafe.has(key)||!Object.hasOwn(fields,key))result.push({path:`${path}.${key}`,label:'未登记输入',message:'原输入含此合同没有提供的字段；内容保留在高级输入，请核对后明确处理，不能悄悄丢弃。'});
  Object.entries(fields).forEach(([key,field],index)=>{const next=`${path}.${key}`,name=runInputLabel(field,index);if(!Object.hasOwn(value,key)){if(required.includes(key))result.push({path:next,label:name,message:'这是必填项目，请先填写。'});}else result.push(...validateRunInput(field,value[key],next,name));});return result;
 }
 if(schema.type==='array') {
  if(!Array.isArray(value))return fail('请填写列表。');if(value.length>200)return fail('列表超过完整表单上限，运行已阻止，不会截断。');
  if(typeof schema.minItems==='number'&&value.length<schema.minItems||typeof schema.maxItems==='number'&&value.length>schema.maxItems)return fail('列表数量不符合已发布规格。');
  if(schema.uniqueItems===true&&value.some((item,index)=>value.slice(0,index).some(previous=>same(previous,item))))return fail('此列表不能包含重复项目。');
  return value.flatMap((item,index)=>validateRunInput(schema.items as RunInputSchema,item,`${path}[${index}]`,`${label}第 ${index+1} 项`));
 }
 if(schema.type==='null')return value===null?[]:fail('此固定空值项目不能填写其他内容。');
 if(schema.type==='boolean')return typeof value==='boolean'?[]:fail('请选择是或否。');
 if(schema.type==='number'||schema.type==='integer') {
  if(typeof value!=='number'||!Number.isFinite(value)||schema.type==='integer'&&!Number.isInteger(value))return fail('请填写有效数字，整数项目不允许小数。');
  if(typeof schema.minimum==='number'&&value<schema.minimum||typeof schema.maximum==='number'&&value>schema.maximum||typeof schema.exclusiveMinimum==='number'&&value<=schema.exclusiveMinimum||typeof schema.exclusiveMaximum==='number'&&value>=schema.exclusiveMaximum)return fail('数字超出本版本允许范围。');
  if(typeof schema.multipleOf==='number'&&(schema.multipleOf<=0||Math.abs(value/schema.multipleOf-Math.round(value/schema.multipleOf))>1e-8))return fail('数字不符合本版本步长。');return [];
 }
 if(typeof value!=='string')return fail('请填写文本。');
 const length=[...value].length;if(typeof schema.minLength==='number'&&length<schema.minLength||typeof schema.maxLength==='number'&&length>schema.maxLength)return fail('文本长度不符合本版本规格。');
 if(schema.format==='date'&&!/^\d{4}-\d{2}-\d{2}$/.test(value)||schema.format==='date-time'&&!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value))return fail('请填写此版本要求的日期或含时区的完整时刻。');
 if((schema.format==='date'||schema.format==='date-time')&&!Number.isFinite(Date.parse(value)))return fail('日期或时刻无效。');
 if(schema.format==='date'&&new Date(value).toISOString().slice(0,10)!==value)return fail('日期不存在，请核对月份与天数。');
 if(schema.format==='email'&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))return fail('邮箱格式无效。');
 if(schema.format==='uri'){try{new URL(value);}catch{return fail('请填写完整地址。');}}return [];
}
