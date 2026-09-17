import {randomUUID} from "node:crypto";
import type {PoolClient} from "pg";
import type {ScopedFieldDefinition} from "../../../common/contracts";
import {NewDesignError} from "../../domain/errors";
import {structureWriteHash} from "../structureWrites";
import type {FieldWriteReceipt} from "../../../common/referenceParity";
export type {FieldWriteReceipt} from "../../../common/referenceParity";
export class FieldWriteError extends NewDesignError {
  readonly recovery;
  constructor(bookId:string,message:string,status:number,outcome:"unknown"|"not_written",issues?:Record<string,string>){
    super(message,status,issues);
    this.recovery={failedStep:"保存补充信息",summary:message,
      savedResult:outcome==="unknown"?"保存结果尚未确认；填写、原请求与历史保留，请按原请求核对。":"本次事务已回滚，填写与历史保留。",
      sourceRoute:`/new-design/books/${bookId}/story-setting`,actionLabel:"返回资料填写",mutationOutcome:outcome};
  }
}
function receipt(row:Record<string,unknown>|undefined,bookId:string,key:string):FieldWriteReceipt|null{
  if(!row)return null;
  if(String(row.book_id)!==bookId)throw new FieldWriteError(bookId,"原请求属于其他书籍，请保留原凭证核对。",409,"unknown");
  const saved=(row.impact as {receipt?:FieldWriteReceipt}|null)?.receipt;
  if(!saved||saved.bookId!==bookId||saved.requestKey!==key||!/^[a-f0-9]{64}$/.test(saved.inputHash)||!saved.result||saved.result.id!==String(row.field_definition_id)||saved.result.currentVersion.id!==String(row.to_version_id))
    throw new FieldWriteError(bookId,"原请求缺少完整输入与当次结果回执，无法用最新资料确认原保存结果。",409,"unknown");
  return saved;
}
async function read(client:PoolClient,bookId:string,key:string){
  return receipt((await client.query(`SELECT adoption.field_definition_id,adoption.to_version_id,adoption.impact,book.id book_id
    FROM new_design.field_scope_adoptions adoption JOIN new_design.field_definitions definition ON definition.id=adoption.field_definition_id
    JOIN new_design.books book ON book.space_id=definition.space_id WHERE adoption.idempotency_key=$1`,[key])).rows[0],bookId,key);
}
export async function readFieldWriteReceipt(bookId:string,key:string,expected?:{operation:string;input:unknown}):Promise<FieldWriteReceipt|null>{
  const {getNewDesignPool}=await import("../runtime"),client=await(await getNewDesignPool()).connect();
  try{await client.query("BEGIN READ ONLY");await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[`field-write:${key}`]);const value=await read(client,bookId,key);if(value&&expected&&(value.operation!==expected.operation||value.inputHash!==structureWriteHash({bookId,...expected})))throw new FieldWriteError(bookId,"原回执与完整冻结输入不一致，请保留原凭证核对。",409,"unknown");await client.query("COMMIT");return value;}
  catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
}
/** The original input, field history and immutable receipt share one transaction. */
export class FieldWriteSession {
  private committing=false;
  private priorUnknown=false;
  private readonly inputHash:string;
  constructor(private client:PoolClient,private bookId:string,private operation:string,private key:string,private input:unknown){
    this.inputHash=structureWriteHash({bookId,operation,input});
  }
  async begin(){
    await this.client.query("BEGIN");
    await this.client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[`field-write:${this.key}`]);
    let prior:FieldWriteReceipt|null;
    try{prior=await read(this.client,this.bookId,this.key);}catch(error){this.priorUnknown=true;throw error;}
    if(prior&&(prior.inputHash!==this.inputHash||prior.operation!==this.operation)){this.priorUnknown=true;throw new FieldWriteError(this.bookId,"原请求已有不同输入的回执，请保留原凭证核对。",409,"unknown");}
    return prior?.result??null;
  }
  async record(result:ScopedFieldDefinition,adoption:{action:"create"|"revise"|"archive";fromVersionId?:string|null;expectedTypeRevision?:number;expectedSubjectRevision?:number;createdBy:string;impact?:Record<string,unknown>}){
    const saved:FieldWriteReceipt={bookId:this.bookId,operation:this.operation,requestKey:this.key,inputHash:this.inputHash,result};
    await this.client.query(`INSERT INTO new_design.field_scope_adoptions(id,field_definition_id,action,idempotency_key,from_version_id,to_version_id,expected_type_revision,expected_subject_revision,impact,created_by)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10)`,[randomUUID(),result.id,adoption.action,this.key,adoption.fromVersionId??null,result.currentVersion.id,adoption.expectedTypeRevision??null,adoption.expectedSubjectRevision??null,JSON.stringify({...adoption.impact,originalInput:this.input,receipt:saved}),adoption.createdBy]);
  }
  async commit(result:ScopedFieldDefinition){this.committing=true;await this.client.query("COMMIT");return result;}
  async fail(error:unknown):Promise<never>{
    let rollback=false;try{await this.client.query("ROLLBACK");rollback=true;}catch{}
    if(this.priorUnknown||error instanceof FieldWriteError&&error.recovery.mutationOutcome==="unknown")throw error;
    const proven=!this.committing&&rollback;
    throw new FieldWriteError(this.bookId,error instanceof NewDesignError?error.message:proven?"保存未完成，本次事务已回滚。":"响应中断，保存结果尚未确认，请按原请求核对。",error instanceof NewDesignError?error.status:503,proven?"not_written":"unknown",error instanceof NewDesignError?error.issues:undefined);
  }
}
