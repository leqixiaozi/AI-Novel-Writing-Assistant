import type {PoolClient} from "pg";
import type {CardSummary} from "../../../common/contracts";
import type {AuthorMaterialWriteReceipt} from "../../../common/authorMaterials";
import {NewDesignError,assertFound} from "../../domain/errors";
import {getNewDesignPool} from "../runtime";
export interface AuthorWriteContext {bookId:string;requestKey:string;inputHash:string;operation:"create"|"update";cardTypeId:string;}
export interface AuthorWriteExtras {authorWrite?:AuthorWriteContext;}
export type AuthorSavedCard=CardSummary&{authorReceipt?:AuthorMaterialWriteReceipt};
export class AuthorMaterialWriteError extends NewDesignError {constructor(message:string,status:number,public readonly mutationOutcome:"not_written"|"unknown",issues?:Record<string,string>){super(message,status,issues);}}
export async function prepareAuthorMaterialConnection(context?:AuthorWriteContext){try{const pool=await getNewDesignPool(),client=await pool.connect();return {pool,client};}catch(error){if(!context)throw error;throw new AuthorMaterialWriteError("数据库连接尚未建立，资料保存未提交；保留填写后检查运行维护。",503,"not_written");}}
export async function claimAuthorMaterialWrite(client:PoolClient,context:AuthorWriteContext,cardId:string|null,spaceId?:string):Promise<AuthorMaterialWriteReceipt|null>{
 await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[`author-material:${context.bookId}:${context.requestKey}`]);
 const book=assertFound((await client.query("SELECT space_id FROM new_design.books WHERE id=$1 AND status='active' FOR SHARE",[context.bookId])).rows[0],"本书不存在或已归档。");
 if(spaceId&&book.space_id!==spaceId)throw new NewDesignError("资料不属于本书空间。",422);
 if(cardId&&!((await client.query("SELECT id FROM new_design.cards WHERE id=$1 AND space_id=$2 AND card_type_id=$3 AND status='active'",[cardId,book.space_id,context.cardTypeId])).rows[0]))throw new NewDesignError("选中资料或内容类型不属于本书可编辑范围。",422);
 const row=(await client.query("SELECT author_input_hash,author_write_receipt FROM new_design.card_versions WHERE author_book_id=$1 AND author_request_key=$2",[context.bookId,context.requestKey])).rows[0];
 if(!row)return null;if(row.author_input_hash!==context.inputHash)throw new NewDesignError("原请求凭证已经用于另一份填写，请保留当前草稿并核对原结果。",409);
 return {...row.author_write_receipt as AuthorMaterialWriteReceipt,repeated:true};
}
export async function persistAuthorMaterialReceipt(client:PoolClient,context:AuthorWriteContext,versionId:string,card:CardSummary,extras:{localValues?:Record<string,unknown>;tagIds?:string[];aiDraftDecisionIds?:string[]}):Promise<AuthorMaterialWriteReceipt>{const receipt:AuthorMaterialWriteReceipt={bookId:context.bookId,requestKey:context.requestKey,operation:context.operation,inputHash:context.inputHash,cardVersionId:versionId,repeated:false,card,localValues:extras.localValues??{},tagIds:extras.tagIds??null,aiDraftDecisionIds:extras.aiDraftDecisionIds??[]};const result=await client.query("UPDATE new_design.card_versions SET author_book_id=$2,author_request_key=$3,author_input_hash=$4,author_write_receipt=$5::jsonb WHERE id=$1 AND author_request_key IS NULL",[versionId,context.bookId,context.requestKey,context.inputHash,JSON.stringify(receipt)]);if(result.rowCount!==1)throw new NewDesignError("原资料保存凭证未写入，正式修改尚未确认。",503);return receipt;}
export async function rethrowAuthorMaterialWrite(client:PoolClient,error:unknown,commitStarted:boolean):Promise<never>{let rollbackSucceeded=false;try{await client.query("ROLLBACK");rollbackSucceeded=true;}catch{/* No proof means unknown. */}throw new AuthorMaterialWriteError(error instanceof NewDesignError?error.message:"底座未确认保存回执，请保留原请求并只读核对。",error instanceof NewDesignError?error.status:503,!commitStarted&&rollbackSucceeded?"not_written":"unknown",error instanceof NewDesignError?error.issues:undefined);}
