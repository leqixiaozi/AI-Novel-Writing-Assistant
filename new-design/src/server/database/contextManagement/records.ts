import type {PoolClient} from 'pg';
import {NewDesignError,assertFound} from '../../domain/errors';
import {createRecordCard,findRecordCard,listRecordCards,replaceRecordCard,requireRecordCard,type RecordCardDb} from '../recordCards';
import {DEFAULT_SPACE_ID} from '../store';

export async function contextRecords(db:RecordCardDb,kind:string,where:Record<string,unknown>={}){
  return listRecordCards(db,kind,{where,includeArchived:true});
}
export async function contextRecord(db:RecordCardDb,kind:string,id:string,lock=false){
  return requireRecordCard(db,id,kind,'上下文记录不存在。',{includeArchived:true,lock});
}
export async function patchContextRecord(db:PoolClient,kind:string,id:string,patch:Record<string,unknown>){
  const row=await contextRecord(db,kind,id,true);
  return replaceRecordCard(db,{id:row.recordCardId,spaceId:row.recordSpaceId,typeKey:kind,values:{...row,...patch}});
}
export async function insertContextRecord(db:PoolClient,kind:string,input:Record<string,unknown>){
  const defaults:Record<string,Record<string,unknown>>={
    context_binding:{space_id:null,book_id:null,scope_ref:null,description:'',status:'active',revision:1,current_version_id:null,adopted_version_id:null,created_by:'',updated_by:''},
    context_binding_adoption:{from_version_id:null,to_version_id:null,actor:''},
    context_preview:{stale_at:null,stale_reason:''},
    context_management_event:{book_id:null,expected_revision:null,result_version_id:null,detail:{},actor:''},
    context_manifest_slot:{token_budget:null},
  };
  const values={...defaults[kind],...input};let spaceId=String(input.space_id??DEFAULT_SPACE_ID);
  if(values.book_id){const book=assertFound((await db.query('SELECT space_id FROM new_design.books WHERE id=$1',[values.book_id])).rows[0],'上下文所属书籍不存在。');spaceId=String(book.space_id);}
  else for(const [field,type]of [['binding_id','context_binding'],['binding_version_id','context_binding_version'],['preview_id','context_preview']] as const){if(values[field]){spaceId=(await contextRecord(db,type,String(values[field]))).recordSpaceId;break;}}
  return createRecordCard(db,{id:values.id as string|undefined,spaceId,typeKey:kind,title:String(values.name??values.slot_key??'上下文记录'),values});
}
export async function contextRequest(db:PoolClient,key:string,kind:string,subjectId?:string){
  await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`context-request:${key}`]);
  const row=(await contextRecords(db,'context_management_event',{idempotency_key:key}))[0];
  if(row&&(row.subject_kind!==kind||(subjectId&&row.subject_id!==subjectId)))throw new NewDesignError('请求标识已用于其他上下文操作。',409);
  return row??null;
}
export async function bindingVersionBelongs(db:RecordCardDb,id:string,bindingId:string){
  return (await findRecordCard(db,id,'context_binding_version',{includeArchived:true}))?.binding_id===bindingId;
}
