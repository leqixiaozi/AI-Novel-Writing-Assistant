import {createHash} from "node:crypto";
import type {PoolClient} from "pg";
import {z} from "zod";
import type {CardGroupFormSummary,TemplateGroupSummary} from "../../../common/contracts";
import type {StructureWriteKind,StructureWriteOperation,StructureWriteReceipt} from "../../../common/structureWrites";
import {NewDesignError} from "../../domain/errors";
import {getNewDesignPool} from "../runtime";
export {strictFormInputSchema} from "./formSchema";

export const structureRequestKeySchema=z.string().uuid();
function canonical(value:unknown):unknown {
  if(Array.isArray(value))return value.map(canonical);
  if(value&&typeof value==="object")return Object.fromEntries(Object.entries(value).filter(([,item])=>item!==undefined).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>[key,canonical(item)]));
  return value;
}
export function structureWriteHash(value:unknown):string{return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");}
export class StructureWriteError extends NewDesignError {
  readonly recovery;
  constructor(kind:StructureWriteKind,operation:StructureWriteOperation,message:string,status:number,outcome:"not_written"|"unknown",issues?:Record<string,string>,proof:"before_write"|"rollback"="before_write"){
    super(message,status,issues);
    const stage=operation==="save"?(kind==="form"?"保存创作表单草稿":"保存开书模板草稿"):(kind==="form"?"发布创作表单版本":"发布开书模板版本");
    this.recovery={failedStep:outcome==="unknown"?`核对${stage}结果`:stage,summary:message,
      savedResult:outcome==="unknown"?"写入结果尚未确认；原稿、原请求和已有版本保留，请按原请求核对。":proof==="rollback"?"本次事务已回滚，未写入；当前草稿与已有正式版本保留。":"输入校验未通过，尚未进入写入；当前草稿与已有正式版本保留。",
      actionLabel:kind==="form"?"返回创作表单":"返回开书模板",
      sourceRoute:kind==="form"?"/new-design/structure/forms":"/new-design/structure/templates",mutationOutcome:outcome};
  }
}
export function parseStructureWriteInput<S extends z.ZodType>(kind:StructureWriteKind,operation:StructureWriteOperation,schema:S,value:unknown):z.output<S>{
  const parsed=schema.safeParse(value);if(parsed.success)return parsed.data;
  const labels:Record<string,string>={key:"内部标识",name:"名称",description:"用途说明",definition:"表单定义",primaryTypeKey:"主要内容类型",groups:"分组",sections:"资料区块",slots:"资料位置",allowedTypeKeys:"允许内容类型",relationTypeKey:"资料关系",localFields:"补充字段",min:"最少数量",max:"最多数量",revision:"来源修订",requestKey:"原请求凭证",draftConfig:"模板设置"};
  const issues=Object.fromEntries(parsed.error.issues.map(issue=>[issue.path.map(String).join('.'),`${issue.path.map(key=>typeof key==='number'?`第${key+1}项`:labels[String(key)]??'来源规格').join('／')}：${issue.code==='unrecognized_keys'?'包含尚未识别的正式字段，不能静默删除。':'请核对必填值、格式或实际范围。'}`]));
  throw new StructureWriteError(kind,operation,"输入校验失败；请在原草稿中核对标识出的填写位置，再明确保存或发布。",422,"not_written",issues,"before_write");
}
async function lock(client:PoolClient,kind:StructureWriteKind,key:string){await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[`structure-write:${kind}:${key}`]);}
function mapReceipt(row:Record<string,unknown>):StructureWriteReceipt{return{kind:row.kind as StructureWriteKind,operation:row.operation as StructureWriteOperation,requestKey:String(row.request_key),inputHash:String(row.input_hash),result:row.result_summary as StructureWriteReceipt["result"]};}
export async function readStructureWriteReceipt(kind:StructureWriteKind,key:string):Promise<StructureWriteReceipt|null>{
  structureRequestKeySchema.parse(key);
  const client=await(await getNewDesignPool()).connect();
  try{await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");await lock(client,kind,key);const row=(await client.query("SELECT * FROM new_design.structure_write_receipts WHERE kind=$1 AND request_key=$2",[kind,key])).rows[0];const result=row?mapReceipt(row):null;await client.query("COMMIT");return result;}
  catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
}
export async function executeStructureWrite<T extends CardGroupFormSummary|TemplateGroupSummary>(kind:StructureWriteKind,operation:StructureWriteOperation,key:string|undefined,input:unknown,write:(client:PoolClient)=>Promise<T>):Promise<T>{
  if(key!==undefined)structureRequestKeySchema.parse(key);
  const hash=structureWriteHash({kind,operation,input}),client=await(await getNewDesignPool()).connect();let committing=false,rolledBack=false,priorConflict=false;
  try{
    await client.query("BEGIN");
    if(key){await lock(client,kind,key);const prior=(await client.query("SELECT * FROM new_design.structure_write_receipts WHERE kind=$1 AND request_key=$2",[kind,key])).rows[0];if(prior){if(prior.input_hash!==hash||prior.operation!==operation){priorConflict=true;throw new NewDesignError("原请求已有另一输入的回执；请保留原凭证核对，不会覆盖已有草稿或追加版本。",409);}committing=true;await client.query("COMMIT");return mapReceipt(prior).result as T;}}
    const result=await write(client);
    if(key)await client.query("INSERT INTO new_design.structure_write_receipts(kind,request_key,operation,input_hash,result_summary) VALUES($1,$2,$3,$4,$5::jsonb)",[kind,key,operation,hash,JSON.stringify(result)]);
    committing=true;await client.query("COMMIT");return result;
  }catch(error){try{await client.query("ROLLBACK");rolledBack=true;}catch{rolledBack=false;}
    const proven=!committing&&rolledBack;
    if(priorConflict)throw new StructureWriteError(kind,operation,"原请求已有不同输入的保存回执；本次未覆盖，但原请求结果不能按当前草稿确认。请保留原凭证核对。",409,"unknown");
    if(proven&&error instanceof NewDesignError)throw new StructureWriteError(kind,operation,error.message,error.status,"not_written",error.issues,"rollback");
    if(proven&&(error as {code?:string})?.code==="23505")throw new StructureWriteError(kind,operation,"内部标识已存在；请保留草稿，重新准备一个新项目后再保存。",409,"not_written",undefined,"rollback");
    throw new StructureWriteError(kind,operation,proven?"保存事务未完成，已安全回滚。请保留草稿，修复服务后重新准备。":"服务响应中断，尚不能确认保存或发布结果。请保留原请求并只读核对。",503,proven?"not_written":"unknown",undefined,proven?"rollback":"before_write");
  }finally{client.release();}
}
