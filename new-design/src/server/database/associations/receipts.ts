import {executeBookFormWrite} from "../referenceParity";
import type {PoolClient} from "pg";
import type {AssociationWorkspace,CardGroupFormSummary} from "../../../common/contracts";
import {assertFound,NewDesignError} from "../../domain/errors";
import {readStructureWriteReceipt,structureWriteHash,StructureWriteError} from "../structureWrites";
import {findRecordCard} from '../recordCards';
interface AssociationReceipt extends CardGroupFormSummary {associationResult:{bookId:string;targetId:string;operation:string;workspace:AssociationWorkspace};}
export function associationReceiptKey(key:string){const bytes=structureWriteHash({namespace:'association_write',key}).slice(0,32).split('');bytes[12]='5';bytes[16]='8';const hex=bytes.join('');return`${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;}
export async function executeAssociationWrite(bookId:string,targetId:string,operation:string,input:{idempotencyKey:string},write:(client:PoolClient)=>Promise<AssociationWorkspace>):Promise<AssociationWorkspace>{
  const saved=await executeBookFormWrite<AssociationReceipt>(bookId,associationReceiptKey(input.idempotencyKey),{command:'association_write',bookId,targetId,operation,input},async client=>{
    assertFound((await client.query("SELECT id FROM new_design.books WHERE id=$1 AND status='active' FOR UPDATE",[bookId])).rows[0],'书籍不存在。');
    if((await client.query("SELECT 1 FROM new_design.card_version_actions WHERE action_key LIKE 'association.%' AND payload->>'idempotency_key'=$1 LIMIT 1",[input.idempotencyKey])).rows[0])throw new StructureWriteError('form','save','原关联请求缺少完整回执，请保留原凭证核对，不能用当前关联替代当次保存结果。',409,'unknown');
    const workspace=await write(client),row=assertFound(await findRecordCard(client,workspace.formId,'card_group_form',{includeArchived:true}),'无法核对关联表单来源。');
    const version=assertFound(await findRecordCard(client,String(row.current_version_id),'card_group_form_version',{includeArchived:true}),'无法核对关联表单版本。');
    return{id:String(row.id),key:String(row.form_key),name:String(row.name),description:String(row.description??''),status:row.status as CardGroupFormSummary['status'],revision:Number(row.revision),currentVersion:Number(version.version),currentVersionId:String(row.current_version_id),draftDefinition:row.draft_definition,isSystem:Boolean(row.is_system),createdAt:new Date(String(row.created_at)).toISOString(),updatedAt:new Date(String(row.updated_at)).toISOString(),associationResult:{bookId,targetId,operation,workspace}};
  });
  if(saved.associationResult?.bookId!==bookId||saved.associationResult.targetId!==targetId||saved.associationResult.operation!==operation)throw new NewDesignError('原关联回执范围不一致，请保留原凭证核对。',409);
  return saved.associationResult.workspace;
}
export async function readAssociationWriteReceipt(bookId:string,targetId:string,operation:string,input:{idempotencyKey:string}):Promise<AssociationWorkspace|null>{
  const saved=await readStructureWriteReceipt('form',associationReceiptKey(input.idempotencyKey));if(!saved)return null;
  if(saved.operation!=='save'||saved.inputHash!==structureWriteHash({kind:'form',operation:'save',input:{command:'association_write',bookId,targetId,operation,input}}))throw new StructureWriteError('form','save','原关联回执与完整冻结输入不同，请保留原凭证核对。',409,'unknown');
  const result=(saved.result as AssociationReceipt).associationResult;if(result?.bookId!==bookId||result.targetId!==targetId||result.operation!==operation)throw new StructureWriteError('form','save','原关联回执来源不一致。',409,'unknown');return result.workspace;
}
