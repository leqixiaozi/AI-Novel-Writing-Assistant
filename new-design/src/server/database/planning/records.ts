import type {PoolClient} from 'pg';
import {NewDesignError,assertFound} from '../../domain/errors';
import {createRecordCard,findRecordCard,listRecordCards,requireRecordCard,replaceRecordCard,type RecordCardDb} from '../recordCards';
import {getNewDesignPool} from '../runtime';

export async function planningTransaction<T>(action:(client:PoolClient)=>Promise<T>){
  const client=await(await getNewDesignPool()).connect();
  try{await client.query('BEGIN');const result=await action(client);await client.query('COMMIT');return result;}
  catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}

export async function planningRow(db:RecordCardDb,id:string,kind='planning_object',lock=false){
  return requireRecordCard(db,id,kind,'规划记录不存在。',{lock,includeArchived:true});
}
export async function planningVersion(db:RecordCardDb,id:string,objectId?:string){
  const row=await planningRow(db,id,'planning_version');
  if(objectId&&row.object_id!==objectId)throw new NewDesignError('规划版本不属于当前对象。',422);
  return row;
}
export async function patchPlanningRecord(db:PoolClient,id:string,kind:string,patch:Record<string,unknown>){
  const row=await planningRow(db,id,kind,true);
  return replaceRecordCard(db,{id,spaceId:row.recordSpaceId,typeKey:kind,values:{...row,...patch}});
}
export async function insertPlanningRecord(db:PoolClient,bookId:string,kind:string,values:Record<string,unknown>){
  const book=assertFound((await db.query('SELECT space_id FROM new_design.books WHERE id=$1',[bookId])).rows[0],'书籍不存在。');
  return createRecordCard(db,{id:values.id as string|undefined,spaceId:book.space_id,typeKey:kind,title:String(values.title??'规划记录'),values:{...values,book_id:bookId}});
}
export async function planningOperation(db:RecordCardDb,where:Record<string,unknown>){
  return(await listRecordCards(db,'planning_operation_event',{where}))[0]??null;
}
export async function lockPlanningBook(db:PoolClient,bookId:string){
  await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`planning-book:${bookId}`]);
}
export async function newPlanningObject(db:PoolClient,input:{bookId:string;level:string;parentObjectId?:string|null;cardId?:string|null;title:string;sortOrder:number},id:string){
  await lockPlanningBook(db,input.bookId);
  const parentId=input.parentObjectId??null,cardId=input.cardId??null;
  const rows=await listRecordCards(db,'planning_object',{where:{book_id:input.bookId},includeArchived:true});
  if(rows.some(row=>input.level==='story'&&row.level==='story'||cardId&&row.card_id===cardId||row.level===input.level&&(row.parent_object_id??null)===parentId&&Number(row.sort_order)===input.sortOrder))throw new NewDesignError('同层规划位置、故事总计划或绑定资料已存在。',409);
  if(input.level==='story'){if(parentId||cardId)throw new NewDesignError('故事总计划不能绑定父级或资料。',422);}
  else{
    const parent=parentId?await findRecordCard(db,parentId,'planning_object'):null;
    const required:Record<string,string>={volume:'story',chapter:'volume',scene:'chapter'};
    if(!parent||parent.book_id!==input.bookId||parent.level!==required[input.level]||!cardId)throw new NewDesignError('规划层级不符合当前书籍。',422);
    const card=(await db.query('SELECT type.type_key FROM new_design.cards card JOIN new_design.books book ON book.space_id=card.space_id JOIN new_design.card_types type ON type.id=card.card_type_id WHERE book.id=$1 AND card.id=$2',[input.bookId,cardId])).rows[0];
    if(card?.type_key!==input.level)throw new NewDesignError('规划资料不属于本书或内容类型不匹配。',422);
  }
  return insertPlanningRecord(db,input.bookId,'planning_object',{id,level:input.level,parent_object_id:parentId,card_id:cardId,title:input.title,sort_order:input.sortOrder,status:'active',current_version_id:null,adopted_version_id:null,revision:1});
}
export async function validatePlanningReference(db:PoolClient,bookId:string,reference:{role:string;cardId:string;cardVersionId:string;action?:string|null;sortOrder:number}){
  const row=(await db.query("SELECT type.type_key FROM new_design.cards card JOIN new_design.card_types type ON type.id=card.card_type_id JOIN new_design.books book ON book.space_id=card.space_id AND book.status='active' WHERE book.id=$1 AND card.id=$2 AND card.current_version_id=$3 AND card.status='active'",[bookId,reference.cardId,reference.cardVersionId])).rows[0];
  const allowed:Record<string,string[]>={viewpoint:['character'],participant:['character'],location:['location'],event:['event'],foreshadow:['foreshadow','clue'],item:['prop'],organization:['organization']};
  if(!row||!allowed[reference.role]?.includes(row.type_key)||reference.sortOrder<0)throw new NewDesignError('规划引用必须是本书当前有效资料的精确版本，且用途匹配。',422);
  if(reference.role==='foreshadow'?!['plant','reinforce','recover','misdirect','reveal'].includes(reference.action??''):Boolean(reference.action))throw new NewDesignError('线索引用需要明确动作，其他用途不能设置线索动作。',422);
}
export async function planningReferences(db:RecordCardDb,where:Record<string,unknown>,frozenTitle=false){
  const refs=await listRecordCards(db,'planning_version_reference',{where}),result:Record<string,any>[]=[];
  for(const ref of refs){
    const card=(await db.query('SELECT card.title,version.title version_title,type.type_key,type.name type_name FROM new_design.cards card JOIN new_design.card_types type ON type.id=card.card_type_id JOIN new_design.card_versions version ON version.card_id=card.id AND version.id=$2 WHERE card.id=$1',[ref.card_id,ref.card_version_id])).rows[0];
    if(!card)throw new NewDesignError('规划引用的精确资料版本缺失。',409);
    result.push({...ref,type_key:card.type_key,type_name:card.type_name,title:frozenTitle?card.version_title:card.title});
  }
  return result.sort((a,b)=>String(a.planning_version_id).localeCompare(String(b.planning_version_id))||String(a.reference_role).localeCompare(String(b.reference_role))||Number(a.sort_order)-Number(b.sort_order)||String(a.id).localeCompare(String(b.id)));
}
