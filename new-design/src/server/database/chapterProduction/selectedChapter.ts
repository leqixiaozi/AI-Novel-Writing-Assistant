import {getNewDesignPool} from '../runtime';
import {stableHash} from '../aiContracts';
import {assertFound,NewDesignError} from '../../domain/errors';
import {prepareChapterProduction,type SelectedChapterProductionInput} from './index';

/** Resolve only the actual source chapter. Repeated commands retain their original plan snapshot. */
export async function prepareSelectedChapterProduction(documentId:string,input:SelectedChapterProductionInput):Promise<{bookId:string;requestId:string;repeated:boolean}>{
  const pool=await getNewDesignPool(),hash=stableHash({documentId,...input,createdBy:input.createdBy??'user'});
  const source=assertFound((await pool.query('SELECT id,book_id,chapter_card_id FROM new_design.chapter_documents WHERE id=$1',[documentId])).rows[0],'本章正文来源不存在。');
  const prior=(await pool.query('SELECT id,request_hash,controlled_snapshot FROM new_design.chapter_writing_requests WHERE book_id=$1 AND chapter_document_id=$2 AND idempotency_key=$3',[source.book_id,documentId,input.idempotencyKey])).rows[0];
  if(prior){if(prior.request_hash!==hash||!prior.controlled_snapshot)throw new NewDesignError('原凭证对应其他输入或历史写作合同，请只读核对，不调用另一个模型。',409);return {bookId:String(source.book_id),requestId:String(prior.id),repeated:true};}
  const plan=assertFound((await pool.query("SELECT id,adopted_version_id,revision FROM new_design.planning_objects WHERE book_id=$1 AND card_id=$2 AND level='chapter' AND status='active'",[source.book_id,source.chapter_card_id])).rows[0],'本章正式规划未读取到。');
  if(!plan.adopted_version_id)throw new NewDesignError('请先在故事规划采用本章计划，当前正文和填写保留。',409);
  const result=await prepareChapterProduction({requestKey:input.idempotencyKey,bookId:String(source.book_id),chapterCardId:String(source.chapter_card_id),planningObjectId:String(plan.id),planningVersionId:String(plan.adopted_version_id),expectedPlanningRevision:Number(plan.revision),documentId,expectedDocumentRevision:input.expectedRevision,instruction:input.instruction??'',issuePolicy:'completion_first',operation:input.operationKind,baseBodyVersionId:input.baseBodyVersionId,selectionStart:input.selectionStart,selectionEnd:input.selectionEnd,commandHash:hash,actor:'user',knowledgeSources:input.knowledgeSources});
  return {bookId:String(source.book_id),requestId:result.requestId,repeated:result.repeated};
}
