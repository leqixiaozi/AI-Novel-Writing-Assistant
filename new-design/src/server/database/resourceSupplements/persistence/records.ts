import {randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import {NewDesignError,assertFound} from '../../../domain/errors';
import {stableHash} from '../../aiContracts/integrity';
import {archiveRecordCard,createRecordCard,listRecordCards,replaceRecordCard,requireRecordCard} from '../../recordCards';
import {lockStoryRecords} from '../../storyTimeline/persistence';
import {insertSettlementRecords,updateSettlementRecords} from '../../chapterSettlement/recordStorage';

type Values=Record<string,any>;
type Result={rows:Values[];rowCount:number};
type Conflict={keys:string[];ignore?:boolean;update?:(previous:Values,incoming:Values)=>Values};
const immutable=new Set(['chapter_resource_supplement','resource_supplement_correction_origin','resource_supplement_formal_commit','resource_supplement_impact_review','resource_supplement_integrity_journal','resource_supplement_integrity_issue','resource_supplement_integrity_resolution','chapter_revision_event','chapter_revision_impact']);

async function owningSpace(client:PoolClient,values:Values):Promise<string>{
  if(values.book_id)return String(assertFound((await client.query('SELECT space_id FROM new_design.books WHERE id=$1',[values.book_id])).rows[0],'书籍不存在。').space_id);
  const parents:Array<[string,string]>=[['preview_id','chapter_revision_preview'],['plan_id','chapter_revision_plan'],['execution_id','chapter_revision_execution']];
  for(const [field,type] of parents)if(values[field])return(await requireRecordCard(client,String(values[field]),type,'原修订记录不存在。',{includeArchived:true})).recordSpaceId;
  throw new NewDesignError('记录缺少可核实的本书来源。',422);
}

function matchesSnapshot(selected:Values,current:Values):boolean{
  return Object.keys(selected).every(field=>{
    let a=selected[field]??null,b=current[field]??null;
    if(a!==null&&b!==null&&(field.endsWith('_at')||field.endsWith('_time'))){a=new Date(String(a)).toISOString();b=new Date(String(b)).toISOString();}
    if(typeof a==='number'&&typeof b==='string'&&b.trim()!==''&&Number.isFinite(Number(b)))b=Number(b);
    if(typeof b==='number'&&typeof a==='string'&&a.trim()!==''&&Number.isFinite(Number(a)))a=Number(a);
    return stableHash(a)===stableHash(b);
  });
}

/** All callers own an open transaction. The shared story lock also orders edits with settlement writers. */
export async function insertRevisionRecords(client:PoolClient,typeKey:string,select:string,parameters:unknown[],uniqueKeys:string[][],conflict?:Conflict):Promise<Result>{
  if(typeKey==='chapter_adoption_preparation'||typeKey==='chapter_adoption_session'||typeKey==='chapter_stable_checkpoint')return insertSettlementRecords(client,typeKey,select,parameters,conflict);
  await lockStoryRecords(client);
  const incoming=(await client.query(select,parameters)).rows,rows:Values[]=[];
  for(const values of incoming){
    let collision:Values|undefined;
    for(const key of uniqueKeys){
      if(key.some(field=>values[field]===null||values[field]===undefined))continue;
      const where=Object.fromEntries(key.map(field=>[field,values[field]]));
      const found=await listRecordCards(client,typeKey,{where,includeArchived:!typeKey.startsWith('current_'),lock:true});
      if(!found.length)continue;
      if(found.length!==1||!conflict||stableHash(key)!==stableHash(conflict.keys))throw new NewDesignError('原记录键已经存在，请核对原请求。',409);
      if(collision&&collision.recordCardId!==found[0].recordCardId)throw new NewDesignError('原记录键身份冲突。',409);
      collision=found[0];
    }
    if(collision){
      if(conflict?.ignore)continue;
      if(!conflict?.update||immutable.has(typeKey))throw new NewDesignError('原记录不可覆盖。',409);
      rows.push(await replaceRecordCard(client,{id:collision.recordCardId,spaceId:collision.recordSpaceId,typeKey,values:{...collision,...conflict.update(collision,values)}}));
      continue;
    }
    rows.push(await createRecordCard(client,{id:typeof values.id==='string'?values.id:randomUUID(),spaceId:await owningSpace(client,values),typeKey,title:String(values.title??'章节修订记录'),values}));
  }
  return{rows,rowCount:rows.length};
}

async function selectedRecords(client:PoolClient,typeKey:string,select:string,parameters:unknown[],identityFields:string[]){
  await lockStoryRecords(client);
  const selected=(await client.query(select,parameters)).rows,result:Array<{current:Values;patch:Values}>=[];
  for(const selection of selected){
    const values=selection.record_values as Values;
    const matches=await listRecordCards(client,typeKey,{where:Object.fromEntries(identityFields.map(field=>[field,values[field]])),lock:true});
    if(matches.length!==1||!matchesSnapshot(values,matches[0]))throw new NewDesignError('原章节记录在等待期间已更新，请读取原请求后核对。',409);
    result.push({current:matches[0],patch:selection.record_patch??{}});
  }
  return result;
}

export async function updateRevisionRecords(client:PoolClient,typeKey:string,select:string,parameters:unknown[],identityFields:string[]):Promise<Result>{
  if(immutable.has(typeKey))throw new NewDesignError('原补充资料和修订证据不可修改。',409);
  const rows:Values[]=[];
  for(const {current,patch} of await selectedRecords(client,typeKey,select,parameters,identityFields)){
    const values={...current,...patch};
    if(typeKey==='chapter_adoption_preparation')rows.push(...(await updateSettlementRecords(client,typeKey,'SELECT $1::uuid AS record_card_id,$2::text AS status',[current.recordCardId,values.status])).rows);
    else if(typeKey==='chapter_adoption_session')rows.push(...(await updateSettlementRecords(client,typeKey,'SELECT $1::uuid AS record_card_id,$2::uuid AS adoption_id,$3::text AS status,$4::integer AS revision,$5::timestamptz AS updated_at',[current.recordCardId,values.adoption_id,values.status,values.revision,values.updated_at])).rows);
    else rows.push(await replaceRecordCard(client,{id:current.recordCardId,spaceId:current.recordSpaceId,typeKey,values}));
  }
  return{rows,rowCount:rows.length};
}

export async function deleteRevisionRecords(client:PoolClient,typeKey:string,select:string,parameters:unknown[],identityFields:string[]):Promise<Result>{
  if(typeKey!=='current_knowledge_state_projection')throw new NewDesignError('此章节记录不可删除。',409);
  const rows:Values[]=[];
  for(const {current} of await selectedRecords(client,typeKey,select,parameters,identityFields)){
    await archiveRecordCard(client,{id:current.recordCardId,spaceId:current.recordSpaceId,typeKey,payload:{reason:'source_change_invalidated'}});
    rows.push(current);
  }
  return{rows,rowCount:rows.length};
}
