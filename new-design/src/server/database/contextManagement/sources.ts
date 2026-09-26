import type {PoolClient} from 'pg';
import type {ContextSourceSelector,ContextSourceType} from '../../../common/contracts';
import {findRecordCard,listRecordCards} from '../recordCards';
import {resolveReadyKnowledgeVersion} from '../knowledgeReference/content';

export type ContextCandidate={sourceType:ContextSourceType;stableObjectId:string;exactVersionId:string;sourceRevision:number;sourceHash:string;sourceLabel:string;tokenEstimate:number;metadata:Record<string,unknown>;retrievalRunId:string|null;retrievalRank:number|null};
export function sourceDependencyKind(type:ContextSourceType):string{
  switch(type){case'body_version':return'chapter_body_version';case'story_time':return'story_event_timing';case'research_version':return'research_record_version';case'research_pack_version':return'research_reference_pack_version';case'prompt_component':return'card_version';default:return type;}
}
export async function researchReferencesForBook(client:PoolClient,bookId:string){
  const references=await listRecordCards(client,'book_research_reference',{where:{book_id:bookId}}),versionIds=new Set<string>();
  for(const ref of references){if(ref.research_version_id)versionIds.add(String(ref.research_version_id));if(ref.pack_version_id)for(const item of await listRecordCards(client,'research_reference_pack_item',{where:{pack_version_id:ref.pack_version_id}}))versionIds.add(String(item.research_version_id));}
  return{references,versionIds};
}
export async function readCardCandidate(client:PoolClient,bookId:string,stableId:string,exactId?:string|null):Promise<ContextCandidate|null>{
  const row=(await client.query(`SELECT card.id,card.space_id,version.id version_id,version.revision,version.title,version.values,type.type_key,card.status,
    EXISTS(SELECT 1 FROM new_design.card_relations relation WHERE relation.status='active' AND (relation.source_card_id=card.id OR relation.target_card_id=card.id)) relation_exists,
    dependency_content_hash(version.title||version.values::text||version.type_version_id::text) source_hash
    FROM new_design.cards card JOIN new_design.card_versions version ON version.card_id=card.id JOIN new_design.card_types type ON type.id=card.card_type_id JOIN new_design.books book ON book.id=$3
    WHERE card.id=$1 AND version.id=COALESCE($2,card.current_version_id) AND card.status='active' AND NOT type.is_internal AND (card.space_id=book.space_id OR NOT EXISTS(SELECT 1 FROM new_design.books owner WHERE owner.space_id=card.space_id))`,[stableId,exactId??null,bookId])).rows[0];
  if(!row)return null;
  const memberships=await listRecordCards(client,'material_tag_membership',{where:{card_id:stableId,status:'active'}}),tags:string[]=[];
  for(const membership of memberships){const tag=await findRecordCard(client,String(membership.tag_id),'material_tag');if(!tag||tag.status!=='active'||!tag.current_version_id)continue;const version=await findRecordCard(client,String(tag.current_version_id),'material_tag_version');if(version)tags.push(tag.id,String(tag.tag_key??tag.key??''),String(version.name));}
  const position=(await listRecordCards(client,'story_time_position',{where:{card_id:stableId}}))[0],mounts=await listRecordCards(client,'card_mount',{where:{card_id:stableId,status:'active'}});
  const resources=(await client.query("SELECT id FROM new_design.dependency_resources WHERE resource_kind='card_version' AND stable_object_id=$1 AND exact_version_id=$2",[stableId,row.version_id])).rows;
  let stale=false;for(const resource of resources){if((await listRecordCards(client,'dependency_resource_state',{where:{resource_id:resource.id,state:'stale'}})).length){stale=true;break;}}
  const sourceType=row.type_key==='prompt_component'?'prompt_component':'card_version';
  return{sourceType,stableObjectId:stableId,exactVersionId:String(row.version_id),sourceRevision:Number(row.revision),sourceHash:String(row.source_hash),sourceLabel:String(row.title),tokenEstimate:Math.max(1,Math.ceil(JSON.stringify(row.values??{}).length/4)),metadata:{content_type:String(row.type_key),tag:tags,material_status:row.status,story_range:position?.start_order==null?null:Number(position.start_order),relation_exists:Boolean(row.relation_exists),association_exists:mounts.length>0,source_type:sourceType,stale},retrievalRunId:null,retrievalRank:null};
}
export async function candidateForExplicitSource(client:PoolClient,bookId:string,selector:ContextSourceSelector):Promise<ContextCandidate|null>{
  if(['card_version','prompt_component'].includes(selector.sourceType))return readCardCandidate(client,bookId,String(selector.stableObjectId),selector.exactVersionId);
  const stableId=selector.stableObjectId,exactId=selector.exactVersionId;if(!stableId||!exactId)return null;
  let revision=1,label='参考资料',text='',metadata:Record<string,unknown>={},hash:string|null=null;
  if(selector.sourceType==='asset_version'){
    const row=await resolveReadyKnowledgeVersion(client,bookId,stableId,exactId);if(!row)return null;
    const version=(await client.query('SELECT version FROM new_design.asset_versions WHERE id=$1',[exactId])).rows[0];if(!version)return null;
    revision=Number(version.version);label=String(row.title);text=String(row.text);hash=String(row.checksum);metadata={material_status:'active'};
  }else if(selector.sourceType==='body_version'){
    const row=(await client.query('SELECT version.version,version.content,version.content_hash,document.title FROM new_design.chapter_body_versions version JOIN new_design.chapter_documents document ON document.id=version.chapter_document_id WHERE document.book_id=$3 AND document.id=$1 AND version.id=$2',[stableId,exactId,bookId])).rows[0];if(!row)return null;
    revision=Number(row.version);label=String(row.title);text=String(row.content);hash=String(row.content_hash);metadata={material_status:'active'};
  }else if(selector.sourceType==='planning_version'){
    const object=await findRecordCard(client,stableId,'planning_object'),version=await findRecordCard(client,exactId,'planning_version');if(object?.book_id!==bookId||version?.object_id!==stableId)return null;
    revision=Number(version.version);label=String(object.title);text=JSON.stringify(version.content);hash=String(version.content_hash);metadata={material_status:object.status};
  }else if(['canonical_fact','state_change','knowledge_state_change','story_time','story_event_relation'].includes(selector.sourceType)){
    const kind=selector.sourceType==='story_time'?'story_event_timing':selector.sourceType,row=await findRecordCard(client,exactId,kind);if(!row||row.book_id!==bookId)return null;
    const expectedStable=['knowledge_state_change','story_event_relation'].includes(kind)?row.proposal_id:row.id;
    if(expectedStable!==stableId||row.status!==(kind==='canonical_fact'?'confirmed':'active'))return null;
    revision=Number(kind==='canonical_fact'?row.revision:row.sequence);label=String(row.predicate??row.state_key??row.holder_key??row.start_label??row.time_mode??row.relation_type??label);
    const{recordCardId,recordSpaceId,recordStatus,recordRevision,...values}=row;void recordCardId;void recordSpaceId;void recordStatus;void recordRevision;
    text=JSON.stringify(kind==='canonical_fact'?row.value_json:values);if(kind==='canonical_fact')hash=String(row.value_hash);
    metadata=kind==='canonical_fact'?{canonical_status:row.status}:{material_status:row.status,...(kind==='story_event_timing'?{story_range:row.normalized_start}:{}),...(kind==='story_event_relation'?{relation_exists:true}:{})};
  }else if(['research_version','research_pack_version','research_document_version'].includes(selector.sourceType)){
    const{references,versionIds}=await researchReferencesForBook(client,bookId);
    if(selector.sourceType==='research_version'){
      const record=await findRecordCard(client,stableId,'research_record'),version=await findRecordCard(client,exactId,'research_record_version');if(!record||version?.record_id!==stableId||!versionIds.has(exactId)||!['completed','partial'].includes(version.run_status))return null;
      revision=Number(version.version);label=String(record.title);text=String(version.report)+JSON.stringify(version.structured_result);hash=String(version.run_hash);metadata={material_status:record.status};
    }else if(selector.sourceType==='research_pack_version'){
      const pack=await findRecordCard(client,stableId,'research_reference_pack'),version=await findRecordCard(client,exactId,'research_reference_pack_version');if(pack?.status!=='published'||version?.pack_id!==stableId||!references.some(ref=>ref.pack_version_id===exactId))return null;
      revision=Number(version.version);label=String(pack.name);text=String(version.note);metadata={material_status:pack.status};
    }else{
      const records=await listRecordCards(client,'research_record',{where:{source_document_version_id:exactId}});let allowed=false;
      for(const record of records){const versions=await listRecordCards(client,'research_record_version',{where:{record_id:record.id}});if(versions.some(version=>versionIds.has(version.id))){allowed=true;break;}}
      if(!allowed)return null;
      const row=(await client.query("SELECT version.*,document.title,document.status FROM new_design.research_document_versions version JOIN new_design.research_documents document ON document.id=version.document_id WHERE document.id=$1 AND version.id=$2 AND document.status='active'",[stableId,exactId])).rows[0];if(!row)return null;
      revision=Number(row.version);label=String(row.title);text=String(row.content_text??row.content??'');hash=String(row.content_hash);metadata={material_status:row.status,character_count:Number(row.character_count)};
    }
  }else return null;
  if(!hash){const source=(await client.query('SELECT resolved_hash FROM new_design.resolve_dependency_resource($1,$2,$3)',[sourceDependencyKind(selector.sourceType),stableId,exactId])).rows[0];if(!source)return null;hash=String(source.resolved_hash);}
  return{sourceType:selector.sourceType,stableObjectId:stableId,exactVersionId:exactId,sourceRevision:revision,sourceHash:hash,sourceLabel:label||'参考资料',tokenEstimate:Math.max(1,Math.ceil(Number(metadata.character_count??text.length)/4)),metadata:{source_type:selector.sourceType,...metadata},retrievalRunId:null,retrievalRank:null};
}
