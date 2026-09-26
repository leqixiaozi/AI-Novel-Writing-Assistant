import type {PoolClient} from "pg";
import {z} from "zod";
import type {AuthorMaterialWriteInput,AuthorMaterialWriteReceipt} from "../../../common/authorMaterials";
import {getNewDesignPool} from "../runtime";
import {createCard,createCardInTransaction,updateCard,updateCardInTransaction} from "../store";
import {formHash} from "../formAssist";
import {assertFound,NewDesignError} from "../../domain/errors";
import {AuthorMaterialWriteError} from "./ledger";
export {AuthorMaterialWriteError} from "./ledger";
const uuid=z.string().uuid(),values=z.record(z.string().max(100),z.unknown()).refine(value=>Object.keys(value).length<=500,"最多填写 500 项资料信息。");
export const authorMaterialWriteSchema=z.object({requestKey:uuid,cardTypeId:uuid,title:z.string().trim().min(1,"请填写资料标题。").max(500),values,localValues:values.optional(),revision:z.number().int().positive().optional(),formVersionId:uuid.nullable().optional(),formResolutionKind:z.enum(["installed_form","type_schema","system_default","generic","legacy"]).optional(),tagIds:z.array(uuid).max(500).optional(),aiDraftDecisionIds:z.array(uuid).max(500).optional()}).strict();
async function write(bookId:string,cardId:string|null,input:AuthorMaterialWriteInput):Promise<AuthorMaterialWriteReceipt>{
 const parsed=authorMaterialWriteSchema.parse(input);let book;try{const pool=await getNewDesignPool();book=assertFound((await pool.query("SELECT space_id FROM new_design.books WHERE id=$1 AND status='active'",[bookId])).rows[0],"本书不存在或已归档。");if(cardId&&!parsed.revision)throw new NewDesignError("请先读取选中资料的正式修订。",422,{revision:"资料修订未读取。"});if(!cardId&&parsed.localValues&&Object.keys(parsed.localValues).length)throw new NewDesignError("新建资料不能携带其他资料的独立补充信息。",422);}catch(error){throw new AuthorMaterialWriteError(error instanceof NewDesignError?error.message:"书籍来源未读取，保存尚未提交。",error instanceof NewDesignError?error.status:503,"not_written",error instanceof NewDesignError?error.issues:undefined);}
 const operation=cardId?"update":"create",authorWrite={bookId,requestKey:parsed.requestKey,inputHash:formHash({bookId,cardId,operation,input:parsed}),operation:operation as "create"|"update",cardTypeId:parsed.cardTypeId};
 const saved=cardId?await updateCard(cardId,{...parsed,revision:parsed.revision!,authorWrite}):await createCard({...parsed,spaceId:String(book.space_id),authorWrite});return assertFound(saved.authorReceipt,"原保存回执缺失，请只读核对原请求。");
}
export const createAuthorMaterial=(bookId:string,input:AuthorMaterialWriteInput)=>write(bookId,null,input);
export const updateAuthorMaterial=(bookId:string,cardId:string,input:AuthorMaterialWriteInput)=>write(bookId,cardId,input);
export async function readAuthorMaterialWriteReceipt(bookId:string,requestKey:string):Promise<AuthorMaterialWriteReceipt|null>{const pool=await getNewDesignPool(),client=await pool.connect();try{await client.query("BEGIN");const validatedBook=uuid.parse(bookId),validatedKey=uuid.parse(requestKey);await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[`author-material:${validatedBook}:${validatedKey}`]);const book=assertFound((await client.query("SELECT space_id FROM new_design.books WHERE id=$1",[validatedBook])).rows[0],"书籍来源不存在。");const row=(await client.query("SELECT version.author_write_receipt FROM new_design.card_versions version JOIN new_design.cards card ON card.id=version.card_id WHERE version.author_book_id=$1 AND version.author_request_key=$2 AND card.space_id=$3",[validatedBook,validatedKey,book.space_id])).rows[0];const receipt=row?row.author_write_receipt as AuthorMaterialWriteReceipt:null;await client.query("COMMIT");return receipt;}catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}}

/** Standard author saving without owning the enclosing atomic batch commit. */
export async function updateAuthorMaterialInTransaction(client:PoolClient,bookId:string,cardId:string,input:AuthorMaterialWriteInput):Promise<AuthorMaterialWriteReceipt>{
 const parsed=authorMaterialWriteSchema.parse(input);if(!parsed.revision)throw new NewDesignError("资料修订未读取。",422);
 const authorWrite={bookId,requestKey:parsed.requestKey,inputHash:formHash({bookId,cardId,operation:"update",input:parsed}),operation:"update" as const,cardTypeId:parsed.cardTypeId};
 const saved=await updateCardInTransaction(client,cardId,{...parsed,revision:parsed.revision,authorWrite});return assertFound(saved.authorReceipt,"原保存回执未准备完成。");
}

/** Creates a new independent card through the same normal author writer. */
export async function createAuthorMaterialInTransaction(client:PoolClient,bookId:string,input:AuthorMaterialWriteInput):Promise<AuthorMaterialWriteReceipt>{
 const parsed=authorMaterialWriteSchema.parse(input);if(parsed.localValues&&Object.keys(parsed.localValues).length)throw new NewDesignError("新建资料不能携带原资料的独立补充信息。",422);
 const book=assertFound((await client.query("SELECT space_id FROM new_design.books WHERE id=$1 AND status='active'",[bookId])).rows[0],"本书不存在或已归档。"),authorWrite={bookId,requestKey:parsed.requestKey,inputHash:formHash({bookId,cardId:null,operation:"create",input:parsed}),operation:"create" as const,cardTypeId:parsed.cardTypeId};
 const saved=await createCardInTransaction(client,{...parsed,spaceId:String(book.space_id),authorWrite});return assertFound(saved.authorReceipt,"原新建资料回执未准备完成。");
}
