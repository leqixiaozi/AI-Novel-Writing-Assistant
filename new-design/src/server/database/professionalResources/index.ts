import {professionalReceiptRows,saveProfessionalReceipt} from './receipts';
import {createRecordCard,listRecordCards,requireRecordCard} from '../recordCards';
import {bookSummaries} from '../templateStore';
import {readRunPreview,runRows} from '../aiRunOrchestration/records';
import {AsyncLocalStorage} from "node:async_hooks";
import {randomUUID} from "node:crypto";
import type {Pool,PoolClient} from "pg";
import type {FieldDefinition} from "../../../common/contracts";
import {PUBLIC_RESOURCE_KINDS,PROFESSIONAL_ROUTE,professionalCommandSchema,type ProfessionalCatalog,type ProfessionalCommand,type ProfessionalReceipt,type ProfessionalRecovery,type ProfessionalResource,type ProfessionalResourceKind} from "../../../common/professionalResources";
import {getNewDesignPool} from "../runtime";
import {stableHash} from "../aiContracts";
import {validateCardValues} from "../../domain/validation";
import {validateDictionaryTreeValues,snapshotDictionaryTreeValues} from "../treeResources";
import {NewDesignError,assertFound} from "../../domain/errors";
import {publicCharactersCapability} from './publicCharacters';
const SPACE="60000000-0000-4000-8000-000000000001",isolation=new AsyncLocalStorage<Pool>();
type Row=Record<string,unknown>;
const iso=(value:unknown)=>value instanceof Date?value.toISOString():new Date(String(value)).toISOString();
const pool=async()=>isolation.getStore()??await getNewDesignPool();
export function withProfessionalResourcesPool<T>(value:Pool,work:()=>Promise<T>):Promise<T>{return isolation.run(value,work);}
export class ProfessionalResourceError extends NewDesignError {
 readonly recovery:ProfessionalRecovery;
 constructor(message:string,status:number,outcome:"not_written"|"unknown",requestKey:string|null,step:string,issues?:Record<string,string>){super(message,status,issues);const savedResult="原资源版本、书内资料与当前人工填写保留；按原请求凭证核对，不重复安装或采用。";this.recovery={failedStep:step,summary:message,savedResult,retainedResult:savedResult,sourceRoute:PROFESSIONAL_ROUTE,actionLabel:"返回专业创作资源",mutationOutcome:outcome,requestKey};}
}
function map(row:Row):ProfessionalResource{return{id:String(row.id),versionId:String(row.current_version_id),typeId:String(row.card_type_id),typeVersionId:String(row.type_version_id),kind:row.type_key as ProfessionalResourceKind,title:String(row.title),revision:Number(row.revision),values:row.values as Record<string,unknown>,fields:row.fields as FieldDefinition[],favorite:row.favorite===true,status:row.status as ProfessionalResource["status"]};}
const resourceQuery=`SELECT c.*,t.type_key,v.fields,COALESCE((SELECT preference FROM ${professionalReceiptRows} r WHERE r.resource_card_id=c.id AND r.operation='favorite' ORDER BY r.created_at DESC,r.request_key DESC LIMIT 1),false) favorite FROM new_design.cards c JOIN new_design.card_types t ON t.id=c.card_type_id JOIN new_design.card_type_versions v ON v.id=c.type_version_id AND v.card_type_id=t.id WHERE c.space_id=$1 AND c.current_version_id IS NOT NULL AND t.type_key=ANY($2::text[])`;
export async function getProfessionalCatalog():Promise<ProfessionalCatalog>{
 const db=await pool();const [resources,types,feedback,books]=await Promise.all([db.query(resourceQuery+" ORDER BY t.sort_order,c.updated_at DESC,c.id",[SPACE,PUBLIC_RESOURCE_KINDS]),db.query("SELECT t.id,t.type_key,v.id type_version_id,v.fields FROM new_design.card_types t JOIN new_design.card_type_versions v ON v.id=t.current_version_id WHERE t.space_id=$1 AND t.status='published' AND t.type_key=ANY($2::text[]) ORDER BY t.sort_order,t.id",["00000000-0000-4000-8000-000000000001",PUBLIC_RESOURCE_KINDS]),db.query(`SELECT resource_card_id,resource_version_id,preview_id,issue_id,feedback_effect,feedback_note,created_at FROM ${professionalReceiptRows} receipt_rows WHERE operation='feedback' ORDER BY created_at DESC,request_key LIMIT 200`),bookSummaries(db)]);
 return{publicCharactersCapability:await publicCharactersCapability(db),resources:resources.rows.map(map),types:types.rows.map(row=>({id:String(row.id),kind:row.type_key as ProfessionalResourceKind,typeVersionId:String(row.type_version_id),fields:row.fields as FieldDefinition[]})),books,feedback:feedback.rows.map(row=>({resourceId:String(row.resource_card_id),resourceVersionId:String(row.resource_version_id),previewId:row.preview_id?String(row.preview_id):null,issueId:row.issue_id?String(row.issue_id):null,effect:row.feedback_effect as "helpful"|"neutral"|"harmful",note:String(row.feedback_note),createdAt:iso(row.created_at)}))};
}
export async function readProfessionalReceipt(requestKey:string):Promise<ProfessionalReceipt|null>{
 if(!/^[\s\S]{8,160}$/.test(requestKey))throw new ProfessionalResourceError("原请求凭证格式不正确。",422,"not_written",null,"核对资源操作回执");
 const db=await pool(),client=await db.connect();try{await client.query("BEGIN");await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[`professional-resource:${requestKey}`]);const row=(await client.query(`SELECT receipt FROM ${professionalReceiptRows} receipt_rows WHERE request_key=$1`,[requestKey])).rows[0];await client.query("COMMIT");return row?{...row.receipt as ProfessionalReceipt,repeated:true}:null;}catch{throw new ProfessionalResourceError("原操作回执未读取，未找到不证明原请求未提交；保留凭证继续核对。",503,"unknown",requestKey,"读取原资源操作回执");}finally{client.release();}
}
async function valuesFor(client:PoolClient,fields:FieldDefinition[],values:Record<string,unknown>){
 const unknown=Object.keys(values).filter(key=>!fields.some(field=>field.key===key));if(unknown.length)throw new NewDesignError("填写中存在未发布字段，不会静默删除。",422,Object.fromEntries(unknown.map(key=>[key,"请核对原内容类型，保留填写。"])));const valid=validateCardValues(fields,values);if(Object.keys(valid.issues).length)throw new NewDesignError("请完善标示的资源信息。",422,valid.issues);const treeIssues=await validateDictionaryTreeValues(client,fields,valid.values);if(Object.keys(treeIssues).length)throw new NewDesignError("选项已变化，请核对原字典后保存。",422,treeIssues);return valid.values;
}
async function persistCard(client:PoolClient,row:Row|null,type:{id:string;versionId:string;fields:FieldDefinition[]},title:string,values:Record<string,unknown>,archive=false){
 const id=row?String(row.id):randomUUID(),versionId=randomUUID(),revision=row?Number(row.revision)+1:1,valid=archive?row?.values as Record<string,unknown>:await valuesFor(client,type.fields,values);
 if(!row)await client.query("INSERT INTO new_design.cards(id,space_id,card_type_id,title,status,revision,type_version_id,values) VALUES($1,$2,$3,$4,'active',1,$5,$6::jsonb)",[id,SPACE,type.id,title,type.versionId,JSON.stringify(valid)]);
 const versionInput=[versionId,id,revision,type.versionId,title,JSON.stringify(valid),archive?"archive":row?"edit":"create"];
 if(row?.type_key==='character'){
  // The sample editor changes published fields only. Keep the exact original
  // form provenance and local field snapshots, including inactive definitions.
  const saved=await client.query(`INSERT INTO new_design.card_versions(id,card_id,revision,type_version_id,title,values,source,form_version_id,form_resolution_kind)
   SELECT $1,$2,$3,$4,$5,$6::jsonb,$7,form_version_id,form_resolution_kind
   FROM new_design.card_versions WHERE id=$8 AND card_id=$2`,[...versionInput,row.current_version_id]);
  if(saved.rowCount!==1)throw new NewDesignError('公共角色原版本未读取，原填写保留。',409);
  for(const local of await listRecordCards(client,'card_version_local_value',{where:{card_version_id:row.current_version_id},includeArchived:true}))await createRecordCard(client,{spaceId:SPACE,typeKey:'card_version_local_value',title:'公共角色补充字段快照',values:{card_version_id:versionId,field_definition_id:local.field_definition_id,field_definition_version_id:local.field_definition_version_id,value:local.value}});
 }else await client.query("INSERT INTO new_design.card_versions(id,card_id,revision,type_version_id,title,values,source) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7)",versionInput);
 await snapshotDictionaryTreeValues(client,type.fields,valid,versionId);
 await client.query("UPDATE new_design.cards SET title=$2,values=$3::jsonb,revision=$4,type_version_id=$5,current_version_id=$6,status=$7,archived_at=CASE WHEN $7='archived' THEN now() ELSE NULL END,updated_at=now() WHERE id=$1",[id,title,JSON.stringify(valid),revision,type.versionId,versionId,archive?"archived":"active"]);return{id,versionId};
}
/** Owned transaction bridge: extraction confirms a new resource in the original
 * card/version/receipt ledger; installing into a book remains a separate command. */
export async function createProfessionalResourceInTransaction(client:PoolClient,input:{requestKey:string;typeId:string;typeVersionId:string;title:string;values:Record<string,unknown>}){
 await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`professional-resource:${input.requestKey}`]);if((await client.query(`SELECT request_key FROM ${professionalReceiptRows} receipt_rows WHERE request_key=$1`,[input.requestKey])).rows.length)throw new NewDesignError('原资源保存凭证已经存在，禁止覆盖或重复创建。',409);
 const command=professionalCommandSchema.parse({operation:'create',requestKey:input.requestKey,typeId:input.typeId,title:input.title,values:input.values});if(command.operation!=='create')throw new NewDesignError('资源保存合同不正确。',422);
 const type=assertFound((await client.query("SELECT t.id,v.id version_id,v.fields FROM new_design.card_types t JOIN new_design.card_type_versions v ON v.id=t.current_version_id WHERE t.id=$1 AND v.id=$2 AND t.space_id='00000000-0000-4000-8000-000000000001' AND t.status='published' AND t.type_key='writing_config' FOR SHARE OF t,v",[input.typeId,input.typeVersionId])).rows[0],'原写法类型精确版本不可用。');
 const saved=await persistCard(client,null,{id:String(type.id),versionId:String(type.version_id),fields:type.fields as FieldDefinition[]},command.title,command.values);
 const receipt:ProfessionalReceipt={requestKey:command.requestKey,operation:'create',resourceIds:[saved.id],bookId:null,versionIds:[saved.versionId],adoptionIds:[],targetCardIds:[],retainedResult:'写法已保存到原资源库；尚未安装到任何书籍。',createdAt:new Date().toISOString(),repeated:false};
 await saveProfessionalReceipt(client,saved.id,{request_key:command.requestKey,input_hash:stableHash(command),operation:'create',resource_card_id:saved.id,resource_version_id:saved.versionId,receipt:{...receipt}});return saved;
}
export async function executeProfessionalCommand(raw:unknown):Promise<ProfessionalReceipt>{
 const parsed=professionalCommandSchema.safeParse(raw);if(!parsed.success)throw new ProfessionalResourceError("本次资源操作输入不完整或超过允许范围。",422,"not_written",null,"核对专业资源输入",Object.fromEntries(parsed.error.issues.map(issue=>[issue.path.join(".")||"form","请核对该项填写与允许范围。"])));const input=parsed.data,inputHash=stableHash(input);
 let client:PoolClient;try{client=await(await pool()).connect();}catch{throw new ProfessionalResourceError("数据库连接尚未建立，资源操作未提交。",503,"not_written",input.requestKey,"连接专业资源底座");}
 let commitStarted=false,step="准备资源操作";
 try{
  await client.query("BEGIN");await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[`professional-resource:${input.requestKey}`]);
  const prior=(await client.query(`SELECT * FROM ${professionalReceiptRows} receipt_rows WHERE request_key=$1`,[input.requestKey])).rows[0];if(prior){if(prior.input_hash!==inputHash)throw new NewDesignError("原凭证用于不同资源操作，请先核对原结果。",409);const result={...prior.receipt as ProfessionalReceipt,repeated:true};commitStarted=true;await client.query("COMMIT");return result;}
  const sources=input.operation==="create"?[]:input.operation==="install"?input.resources:[input];if(new Set(sources.map(item=>item.resourceId)).size!==sources.length)throw new NewDesignError("同一资源不可重复安装。",422);
  const rows=new Map<string,Row>();for(const source of [...sources].sort((a,b)=>a.resourceId.localeCompare(b.resourceId))){const row=assertFound((await client.query(resourceQuery+" AND c.id=$3 AND c.status='active' FOR UPDATE OF c",[SPACE,PUBLIC_RESOURCE_KINDS,source.resourceId])).rows[0],"指定资源不存在或已归档，未使用其他资源代替。");if(Number(row.revision)!==source.expectedRevision||row.current_version_id!==source.versionId)throw new NewDesignError("原资源版本已变化，当前填写保留；请明确核对新版本后操作。",409);rows.set(source.resourceId,row);}
  if([...rows.values()].some(row=>row.type_key==='character')){
   if(!['edit','archive','favorite'].includes(input.operation))throw new NewDesignError('公共角色请通过逐字段映射和完整预览导入本书，不作为策略快照安装。',422);
   if(!(await publicCharactersCapability(client)).operational)throw new NewDesignError('公共角色样本管理未启用；原版本和已保存回执保持可读。',503);
  }
  const bookId="bookId" in input?input.bookId:null;const book=bookId?assertFound((await client.query("SELECT * FROM new_design.books WHERE id=$1 AND status='active' FOR UPDATE",[bookId])).rows[0],"目标书籍不存在或已归档。"):null;if(book&&"expectedBookRevision" in input&&Number(book.revision)!==input.expectedBookRevision)throw new NewDesignError("目标书籍已变化，请核对本书后明确操作。",409);
  const result:ProfessionalReceipt={requestKey:input.requestKey,operation:input.operation,resourceIds:[...rows.keys()],bookId,versionIds:[],adoptionIds:[],targetCardIds:[],retainedResult:"原资源版本与原书籍资料保留。",createdAt:new Date().toISOString(),repeated:false};
  const row="resourceId" in input?assertFound(rows.get(input.resourceId),"原资源未锁定。"):null;
  if(input.operation==="create"){step="保存新资源到原资源库";const type=assertFound((await client.query("SELECT t.id,t.type_key,v.id version_id,v.fields FROM new_design.card_types t JOIN new_design.card_type_versions v ON v.id=t.current_version_id WHERE t.id=$1 AND t.space_id=$2 AND t.status='published' AND t.type_key=ANY($3::text[]) FOR SHARE OF t,v",[input.typeId,"00000000-0000-4000-8000-000000000001",PUBLIC_RESOURCE_KINDS])).rows[0],"原资源内容类型未发布。");if(input.expectedTypeVersionId&&input.expectedTypeVersionId!==type.version_id)throw new NewDesignError('资源规格在填写后变化，原填写保留，请核对新规格后重新准备。',409);
   if(type.type_key==='character'){
    if(!input.expectedTypeVersionId)throw new NewDesignError('请选择确切的公共角色规格版本后保存样本。',422);
    if(!(await publicCharactersCapability(client)).operational)throw new NewDesignError('公共角色样本管理未启用；原版本和已保存回执保持可读。',503);
   }
   const saved=await persistCard(client,null,{id:String(type.id),versionId:String(type.version_id),fields:type.fields as FieldDefinition[]},input.title,input.values);result.resourceIds=[saved.id];result.versionIds=[saved.versionId];}
  else if(input.operation==="edit"||input.operation==="archive"||input.operation==="rule_settings"){
   step=input.operation==="archive"?"归档原资源（保留历史）":input.operation==="rule_settings"?"保存质量规则启停与范围":"保存原资源修订";const current=assertFound(row,"原资源未读取。");if(input.operation==="rule_settings"&&current.type_key!=="quality_rule")throw new NewDesignError("仅质量规则可以调整启停与检查范围。",422);const values=input.operation==="edit"?input.values:input.operation==="rule_settings"?{...current.values as Record<string,unknown>,enabled:input.enabled,check_scope:input.scopes}:current.values as Record<string,unknown>;
   const saved=await persistCard(client,current,{id:String(current.card_type_id),versionId:String(current.type_version_id),fields:current.fields as FieldDefinition[]},input.operation==="edit"?input.title:String(current.title),values,input.operation==="archive");result.versionIds=[saved.versionId];
  }else if(input.operation==="adopt_title"){
   step="明确采用标题到目标书名";const current=assertFound(row,"原标题未读取。");if(current.type_key!=="title_candidate")throw new NewDesignError("请选择真实标题候选，不能以写法或规则代替书名。",422);await client.query("UPDATE new_design.books SET name=$2,revision=revision+1,updated_at=now() WHERE id=$1",[input.bookId,current.title]);result.versionIds=[input.versionId];result.retainedResult="标题已明确采用到本书名称；原标题候选和正文保持独立，未改正文。";
  }else if(input.operation==="install"){
   step="安装选中资源为本书独立快照";for(const source of input.resources){const current=assertFound(rows.get(source.resourceId),"原资源未锁定。");if(current.type_key==="title_candidate")throw new NewDesignError("标题通过明确采用修改书名，不安装成写法快照。",422);const type=assertFound((await client.query("SELECT t.id,v.id version_id,v.fields FROM new_design.card_types t JOIN new_design.card_type_versions v ON v.id=t.current_version_id WHERE t.space_id=$1 AND t.type_key=$2 AND t.status='published' FOR SHARE OF t,v",[book?.space_id,current.type_key])).rows[0],`目标书籍尚未发布“${String(current.title)}”对应内容规格。`);const fields=type.fields as FieldDefinition[],valid=await valuesFor(client,fields,current.values as Record<string,unknown>),id=randomUUID(),versionId=randomUUID(),adoptionId=randomUUID();
    await client.query("INSERT INTO new_design.cards(id,space_id,card_type_id,title,status,revision,type_version_id,values) VALUES($1,$2,$3,$4,'active',1,$5,$6::jsonb)",[id,book?.space_id,type.id,current.title,type.version_id,JSON.stringify(valid)]);await client.query("INSERT INTO new_design.card_versions(id,card_id,revision,type_version_id,title,values,source) VALUES($1,$2,1,$3,$4,$5::jsonb,'create')",[versionId,id,type.version_id,current.title,JSON.stringify(valid)]);await snapshotDictionaryTreeValues(client,fields,valid,versionId);await client.query("UPDATE new_design.cards SET current_version_id=$2 WHERE id=$1",[id,versionId]);
    for(const [fieldKey,value] of [["$title",current.title],...Object.entries(valid)])await createRecordCard(client,{spaceId:String(book!.space_id),typeKey:'card_field_origin',title:String(fieldKey),values:{card_id:id,field_key:fieldKey,source_kind:'resource',source_id:current.id,source_card_id:null,source_card_version_id:null,source_detail:{},confirmation_status:'confirmed',original_value:value,current_value:value}});
    await createRecordCard(client,{id:adoptionId,spaceId:String(book!.space_id),typeKey:'resource_adoption',title:'安装资源快照',values:{resource_card_id:current.id,resource_version_id:source.versionId,book_id:input.bookId,target_card_id:id,action:'install_snapshot',snapshot:{typeKey:current.type_key,title:current.title,values:valid}}});result.targetCardIds.push(id);result.versionIds.push(versionId);result.adoptionIds.push(adoptionId);
   }result.retainedResult="全部选中资源已安装为本书独立资料快照；原资源后续修改不会自动替换本书资料。";
  }else if(input.operation==="feedback"){
   step="记录真实试验或质量效果反馈";
   if(input.previewId){
    const preview=await readRunPreview(client,input.previewId,true),submissions=await runRows(client,'ai_run_submission',{preview_id:input.previewId});
    if(preview.source_kind!=='prompt_composition_debug'||!(await client.query("SELECT t.id FROM new_design.ai_tasks t JOIN new_design.ai_task_steps step ON step.task_id=t.id AND step.step_key='execute_prompt_composition_debug' JOIN new_design.ai_task_attempts a ON a.id=step.current_attempt_id WHERE t.id=ANY($1::uuid[]) AND a.debug_result IS NOT NULL AND a.status='succeeded' FOR SHARE OF t,a",[submissions.map(item=>item.ai_task_id)])).rowCount)throw new NewDesignError("试运行没有已保存成功结果，不能把未确认输出记为效果反馈。",404);
   }else await requireRecordCard(client,input.issueId!,'quality_issue',"原质量问题不存在，未用其他问题代替。",{lock:true});
   result.versionIds=[input.versionId];result.retainedResult="作者效果反馈已记录并引用真实原结果；这是主观反馈，没有验证修复、改正文或提升质量债为阻断。";
  }
  const sourceId=result.resourceIds.length===1?result.resourceIds[0]:null,sourceVersion=input.operation==="install"?null:result.versionIds[0]??("versionId" in input?input.versionId:null);
  step="保存资源操作回执";await saveProfessionalReceipt(client,assertFound(result.resourceIds[0],"原资源回执缺少所属资源。"),{request_key:input.requestKey,input_hash:inputHash,operation:input.operation,resource_card_id:sourceId,resource_version_id:sourceVersion,book_id:bookId,preview_id:input.operation==="feedback"?input.previewId:null,issue_id:input.operation==="feedback"?input.issueId:null,preference:input.operation==="favorite"?input.favorite:null,feedback_effect:input.operation==="feedback"?input.effect:null,feedback_note:input.operation==="feedback"?input.note:null,receipt:{...result}});commitStarted=true;await client.query("COMMIT");return result;
 }catch(error){let rollbackAck=false;try{await client.query("ROLLBACK");rollbackAck=true;}catch{/* Lack of ACK must remain unknown. */}throw new ProfessionalResourceError(error instanceof NewDesignError?error.message:!commitStarted&&rollbackAck?"本次资源操作已确认回滚，原资源和填写保留；检查底座后可重新提交原操作。":"资源操作保存结果未确认；先读取原请求回执，不重复安装或采用。",error instanceof NewDesignError?error.status:503,!commitStarted&&rollbackAck?"not_written":"unknown",input.requestKey,step,error instanceof NewDesignError?error.issues:undefined);
 }finally{client.release();}
}
