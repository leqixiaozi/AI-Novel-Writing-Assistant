import type {PoolClient} from 'pg';
import {NewDesignError} from '../domain/errors';
import {createRecordCard,listRecordCards,requireRecordCard,replaceRecordCard,type RecordCardDb} from './recordCards';
import {DEFAULT_SPACE_ID} from './store';

export async function researchCandidate(db:RecordCardDb,id:string,recordId?:string,lock=false){
  const candidate=await requireRecordCard(db,id,'research_candidate','研究候选不存在。',{lock}),batch=await requireRecordCard(db,candidate.batch_id,'research_candidate_batch','研究批次不存在。');
  const version=await requireRecordCard(db,batch.research_version_id,'research_record_version','研究版本不存在。');
  if(recordId&&version.record_id!==recordId)throw new NewDesignError('候选不属于本研究记录。',404);
  return{...candidate,research_version_id:batch.research_version_id,record_id:version.record_id};
}
export async function patchResearchRecord(db:PoolClient,id:string,kind:string,patch:Record<string,unknown>){
  const row=await requireRecordCard(db,id,kind,'研究记录不存在。',{lock:true});
  return replaceRecordCard(db,{id,spaceId:row.recordSpaceId,typeKey:kind,title:typeof patch.title==='string'?patch.title:undefined,values:{...row,...patch}});
}
export async function insertResearchRecord(db:PoolClient,kind:string,values:Record<string,unknown>){
  return createRecordCard(db,{id:values.id as string|undefined,spaceId:DEFAULT_SPACE_ID,typeKey:kind,title:String(values.title??'研究记录'),values});
}
export async function insertResearchCandidate(db:PoolClient,values:Record<string,unknown>){
  return insertResearchRecord(db,'research_candidate',{revision:1,relation_candidates:[],evidence_ids:[],confidence:null,merge_key:'',status:'candidate',...values});
}
export async function saveResearchOrigin(db:PoolClient,spaceId:string,cardId:string,fieldKey:string,sourceId:string,value:unknown){
  const previous=(await listRecordCards(db,'card_field_origin',{where:{card_id:cardId,field_key:fieldKey},lock:true}))[0];
  const values={...(previous??{}),card_id:cardId,field_key:fieldKey,source_kind:'research',source_id:sourceId,confirmation_status:'confirmed',original_value:value,current_value:value,updated_at:new Date().toISOString()};
  if(previous)await replaceRecordCard(db,{id:previous.id,spaceId:previous.recordSpaceId,typeKey:'card_field_origin',values});
  else await createRecordCard(db,{spaceId,typeKey:'card_field_origin',title:fieldKey,values});
}
export async function refreshResearchBatch(db:PoolClient,id:string){
  await requireRecordCard(db,id,'research_candidate_batch','研究批次不存在。',{lock:true});
  const pending=(await listRecordCards(db,'research_candidate',{where:{batch_id:id,status:'candidate'}})).length;
  await patchResearchRecord(db,id,'research_candidate_batch',{status:pending?'partially_adopted':'adopted'});
}
