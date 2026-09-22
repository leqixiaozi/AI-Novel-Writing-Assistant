import type {PoolClient} from 'pg';
import {listRecordCards} from '../recordCards';
import {insertPlanningRecord,patchPlanningRecord,planningRow} from './records';

export async function invalidatePlanningDownstream(db:PoolClient,object:Record<string,any>,fromId:string,toId:string,adoptionId:string){
  const bookId=String(object.book_id),objects=await listRecordCards(db,'planning_object',{where:{book_id:bookId},includeArchived:true}),versions=await listRecordCards(db,'planning_version',{where:{book_id:bookId}});
  const affected=new Set<string>();
  for(const child of objects)if(child.parent_object_id===object.id&&versions.some(version=>version.object_id===child.id&&[child.current_version_id,child.adopted_version_id].includes(version.id)&&version.based_on_parent_version_id===fromId))affected.add(child.id);
  let changed=true;while(changed){changed=false;for(const child of objects)if(affected.has(child.parent_object_id)&&!affected.has(child.id)){affected.add(child.id);changed=true;}}
  const descendants=versions.filter(version=>{const child=objects.find(row=>row.id===version.object_id);return child&&affected.has(child.id)&&[child.current_version_id,child.adopted_version_id].includes(version.id);});
  const impact=async(kind:string,targetId:string,reason:string)=>{
    const where={adoption_id:adoptionId,target_kind:kind,target_id:targetId};
    if((await listRecordCards(db,'planning_impact',{where})).length)return;
    await insertPlanningRecord(db,bookId,'planning_impact',{...where,source_object_id:object.id,source_from_version_id:fromId,source_to_version_id:toId,status:'pending_review',reason,resolved_at:null});
  };
  for(const version of descendants){
    if(!version.stale_at){
      await patchPlanningRecord(db,version.id,'planning_version',{stale_at:new Date().toISOString(),stale_reason:'上游采用了其他规划版本，需要重新核对。'});
      await insertPlanningRecord(db,bookId,'planning_version_action',{object_id:version.object_id,version_id:version.id,action:'mark_stale',actor:'system',note:'上游采用了其他规划版本，需要重新核对。'});
    }
    await impact('plan_version',version.id,'该子计划基于被替代的上游版本。');
  }
  const invalidIds=new Set([fromId,...descendants.map(row=>row.id)]);
  const timings=(await listRecordCards(db,'story_event_timing',{where:{book_id:bookId}})).filter(row=>row.status==='active'&&invalidIds.has(row.plan_version_id));
  for(const timing of timings){
    await patchPlanningRecord(db,timing.id,'story_event_timing',{status:'stale'});
    if(timing.proposal_id){
      const proposal=await planningRow(db,timing.proposal_id,'story_time_proposal',true);
      await patchPlanningRecord(db,proposal.id,'story_time_proposal',{status:'stale',revision:proposal.revision+1,updated_at:new Date().toISOString()});
      await insertPlanningRecord(db,bookId,'story_time_review_action',{proposal_id:proposal.id,proposal_version_id:timing.proposal_version_id,action:'mark_stale',actor:'system',note:'来源计划采用了其他版本，故事时间等待复核。'});
    }
    await impact('story_time',timing.id,'故事时间引用了被替代的计划版本。');
  }
  const relationVersions=await listRecordCards(db,'story_relation_proposal_version',{where:{book_id:bookId}});
  const relations=(await listRecordCards(db,'story_event_relation',{where:{book_id:bookId}})).filter(row=>row.status==='active'&&relationVersions.some(version=>version.id===row.proposal_version_id&&invalidIds.has(version.plan_version_id)));
  for(const relation of relations){
    await patchPlanningRecord(db,relation.id,'story_event_relation',{status:'stale'});
    const proposal=await planningRow(db,relation.proposal_id,'story_relation_proposal',true);
    await patchPlanningRecord(db,proposal.id,'story_relation_proposal',{status:'stale',revision:proposal.revision+1,updated_at:new Date().toISOString()});
    await insertPlanningRecord(db,bookId,'story_relation_review_action',{proposal_id:proposal.id,proposal_version_id:relation.proposal_version_id,action:'mark_stale',actor:'system',note:'来源计划采用了其他版本，事件关系等待复核。'});
    await impact('story_relation',relation.id,'事件关系引用了被替代的计划版本。');
  }
  for(const kind of ['story_time','story_relation']){
    const candidates=await listRecordCards(db,kind+'_proposal',{where:{book_id:bookId,status:'proposed'}});
    const candidateVersions=kind==='story_relation'?relationVersions:await listRecordCards(db,'story_time_proposal_version',{where:{book_id:bookId}});
    for(const proposal of candidates)if(candidateVersions.some(version=>version.id===proposal.current_version_id&&invalidIds.has(version.plan_version_id)))await patchPlanningRecord(db,proposal.id,kind+'_proposal',{status:'stale',revision:proposal.revision+1,updated_at:new Date().toISOString()});
  }
  if(object.level==='chapter'||object.level==='scene'){
    const cardId=object.level==='chapter'?object.card_id:(await planningRow(db,object.parent_object_id)).card_id;
    const bodies=(await db.query('SELECT adopted_version_id FROM new_design.chapter_documents WHERE book_id=$1 AND chapter_card_id=$2 AND adopted_version_id IS NOT NULL',[bookId,cardId])).rows;
    for(const body of bodies)await impact('chapter_body',body.adopted_version_id,'规划切版不会覆盖正文，该正文需要人工判断是否受影响。');
  }
}
