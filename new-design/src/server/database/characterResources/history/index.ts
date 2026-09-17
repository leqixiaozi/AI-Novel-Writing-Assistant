import type {PoolClient} from 'pg';
import type {CharacterResourceHistory,ResourceHistoryChange,ResourceHistoryItem} from '../../../../common/characterResources/history';
import type {ResourceLedgerSelection} from '../../../../common/characterResources';
import {z} from 'zod';
import {getNewDesignPool} from '../../runtime';
import {readCharacterResourcesInTransaction,resourceLedgerQuerySchema} from '..';
import {readStableResourceSupplementBasisInTransaction,assertResourceSupplementHistoricalSourceAvailableInTransaction} from '../../resourceSupplements';
import {stableHash} from '../../aiContracts';
import {NewDesignError} from '../../../domain/errors';
import {displaySettlementValue} from '../../chapterSettlement';
type Row=Record<string,any>;
const json=(value:unknown):Record<string,unknown>|null=>value==null?null:JSON.parse(JSON.stringify(value));
/** Immutable confirmation history and current holding are independent sources. SELECT only. */
export async function readCharacterResourceHistoryInTransaction(db:PoolClient,bookId:string,characterId:string,selection:ResourceLedgerSelection):Promise<CharacterResourceHistory>{
 const current=await readCharacterResourcesInTransaction(db,bookId,characterId,resourceLedgerQuerySchema.parse(selection));
 if(!current.selection)throw new NewDesignError('请选择完整的原持有维度核对资源历史。',422);
 const rows=(await db.query(`SELECT relation.id relation_id,relation.status relation_status,target.id resource_id,target.title,target.status resource_status,
  change.id change_id,to_jsonb(original_relation) relation_version,to_jsonb(original_resource) resource_version,
  to_jsonb(anchor) anchor,to_jsonb(original_character) character_version,contract.detail editing_contract,
  document.logical_order,checkpoint.id checkpoint_id,checkpoint.session_id
 FROM new_design.books book
 JOIN new_design.card_relations relation ON relation.space_id=book.space_id AND relation.source_card_id=$2 AND relation.relation_type_id=$3
 JOIN new_design.cards target ON target.id=relation.target_card_id AND target.space_id=book.space_id
 JOIN new_design.card_types target_type ON target_type.id=target.card_type_id AND target_type.type_key='prop'
 JOIN new_design.state_changes change ON change.book_id=book.id
  AND ((change.subject_kind='relation' AND change.subject_id=relation.id) OR (change.subject_kind='card' AND change.subject_id=target.id))
 JOIN new_design.chapter_documents document ON document.id=change.chapter_document_id AND document.book_id=book.id
 LEFT JOIN LATERAL(SELECT checkpoint.* FROM new_design.chapter_stable_checkpoints checkpoint
  WHERE checkpoint.book_id=book.id AND checkpoint.chapter_document_id=document.id AND checkpoint.body_version_id=change.body_version_id
  ORDER BY checkpoint.created_at DESC,checkpoint.id DESC LIMIT 1) checkpoint ON true
 LEFT JOIN LATERAL(SELECT version.* FROM new_design.card_relation_versions version
  WHERE version.card_relation_id=relation.id AND version.created_at<=change.created_at ORDER BY version.revision DESC LIMIT 1) original_relation ON true
 LEFT JOIN new_design.card_versions original_resource ON original_resource.id=original_relation.target_card_version_id AND original_resource.card_id=target.id
 LEFT JOIN new_design.card_versions original_character ON original_character.id=original_relation.source_card_version_id AND original_character.card_id=relation.source_card_id
 LEFT JOIN LATERAL(SELECT event.detail FROM new_design.chapter_settlement_items item
  JOIN new_design.chapter_settlement_events event ON event.session_id=item.session_id AND event.item_id=item.id AND event.detail->>'editingKind'='contract'
  WHERE item.state_proposal_id=change.proposal_id AND item.decision='confirm'
  ORDER BY (event.detail->>'itemRevision')::int DESC,event.created_at DESC,event.id DESC LIMIT 1) contract ON true
 LEFT JOIN new_design.chapter_text_anchors anchor ON anchor.id=change.text_anchor_id
 WHERE book.id=$1 AND book.status='active'
 ORDER BY document.logical_order DESC,change.sequence DESC,relation.id LIMIT 201`,[bookId,characterId,selection.relationTypeId])).rows as Row[];
 const fullChanges=(await db.query('SELECT change.* FROM new_design.state_changes change WHERE change.book_id=$1 AND change.id=ANY($2::uuid[])',[bookId,[...new Set(rows.slice(0,200).map(row=>String(row.change_id)))]] )).rows as Row[];
 const changesById=new Map(fullChanges.map(change=>[String(change.id),json(change)! as Row]));
 const chapters:CharacterResourceHistory['chapters']=[],byCheckpoint=new Map<string,CharacterResourceHistory['chapters'][number]>(),items=new Map<string,ResourceHistoryItem>();
 for(const row of rows.slice(0,200)){
  const checkpointId=row.checkpoint_id?String(row.checkpoint_id):null;
  if(checkpointId&&!byCheckpoint.has(checkpointId)){
   const chapter:CharacterResourceHistory['chapters'][number]={checkpointId,basis:null,unavailableReason:null};
   try{chapter.basis=await readStableResourceSupplementBasisInTransaction(db,bookId,checkpointId);}catch(error){if(!(error instanceof NewDesignError)||error.status!==409)throw error;chapter.unavailableReason=error.message;}
   chapters.push(chapter);byCheckpoint.set(checkpointId,chapter);
  }
  const chapter=checkpointId?byCheckpoint.get(checkpointId):null,change=changesById.get(String(row.change_id)),relationVersion=row.relation_version as Row|null,resourceVersion=row.resource_version as Row|null,anchor=row.anchor as Row|null,contract=row.editing_contract as Row|null;
  if(!change)throw new NewDesignError('原确认变化未完整读取，请保留来源重新核对。',409);
  const originalStates=chapter?.basis?.original.confirmedSources as {states?:Row[]}|undefined;
  let reason=chapter?.unavailableReason??(!chapter?.basis?'原稳定确认来源缺失，请在原章节核对。':null);
  if(!reason&&(!originalStates?.states?.some(source=>stableHash(source)===stableHash(change))))reason='原变化未通过完整稳定确认清单核验，历史保留待核对。';
  if(!reason&&(!relationVersion||relationVersion.status!=='active'||!resourceVersion||!row.character_version))reason='原关系或资源引用版本缺失，不能按当前档案补齐历史。';
  if(!reason&&anchor&&(!chapter?.basis||anchor.status!=='active'||anchor.book_id!==bookId||anchor.chapter_document_id!==change.chapter_document_id||anchor.body_version_id!==change.body_version_id||!Number.isSafeInteger(anchor.start_offset)||!Number.isSafeInteger(anchor.end_offset)||anchor.start_offset<0||anchor.end_offset<=anchor.start_offset||chapter.basis.bodyContent.slice(anchor.start_offset,anchor.end_offset)!==anchor.excerpt))reason='原正文证据与确切采用版本不一致，请保留历史核对。';
  if(!reason&&change.text_anchor_id&&!anchor)reason='原正文证据缺失，不能补猜原文位置。';
  if(!reason)try{await assertResourceSupplementHistoricalSourceAvailableInTransaction(db,bookId,Number(row.logical_order),[{subjectKind:change.subject_kind,id:String(change.subject_id)}]);}catch(error){if(!(error instanceof NewDesignError)||error.status!==409)throw error;reason=error.message;}
  const item=items.get(String(row.relation_id))??{relationId:String(row.relation_id),resourceId:String(row.resource_id),name:String(row.title),relationStatus:String(row.relation_status),resourceStatus:String(row.resource_status),currentHolding:current.items.find(item=>item.relationId===row.relation_id)?.holding??null,changes:[]};
  const field=contract&&contract.bodyVersionId===change.body_version_id&&contract.draft?.subjectId===change.subject_id&&contract.draft?.subjectKind===change.subject_kind&&contract.draft?.stateKey===change.state_key&&stableHash(contract.draft?.beforeValue)===stableHash(change.before_json)&&stableHash(contract.draft?.afterValue)===stableHash(change.after_json)&&contract.field?.key===change.state_key?contract.field:null;
  const rawDisplay=(value:unknown)=>value===null?'未确认':typeof value==='string'?value:JSON.stringify(value);
  const source:ResourceHistoryChange={id:String(change.id),subjectKind:change.subject_kind,subjectId:String(change.subject_id),stateKey:String(change.state_key),before:change.before_json,after:change.after_json,reason:String(change.reason),fieldLabel:field?.label??String(change.state_key),beforeDisplay:field?displaySettlementValue(field.field,change.before_json,field.dictionaryNodes):rawDisplay(change.before_json),afterDisplay:field?displaySettlementValue(field.field,change.after_json,field.dictionaryNodes):rawDisplay(change.after_json),checkpointId,chapterDocumentId:String(change.chapter_document_id),bodyVersionId:String(change.body_version_id),chapterOrder:Number(row.logical_order),available:!reason,unavailableReason:reason,original:{change:json(change)!,relationVersion:json(relationVersion),resourceVersion:json(resourceVersion),characterVersion:json(row.character_version),anchor:json(anchor),editingContract:json(contract)},sourceRoute:`/new-design/books/${bookId}/writing?chapterDocument=${change.chapter_document_id}${row.session_id?`&session=${row.session_id}`:''}`};
  item.changes.push(source);items.set(item.relationId,item);
 }
 const result:Omit<CharacterResourceHistory,'sourceHash'>={contract:'character_resource_history_v1',bookId,characterId,selection:current.selection,items:[...items.values()],chapters,truncated:rows.length>200||current.truncated};
 return{...result,sourceHash:stableHash(result)};
}
export async function getCharacterResourceHistory(bookId:string,characterId:string,selection:ResourceLedgerSelection):Promise<CharacterResourceHistory>{
 z.string().uuid().parse(bookId);z.string().uuid().parse(characterId);resourceLedgerQuerySchema.parse(selection);
 const db=await(await getNewDesignPool()).connect();try{await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');const result=await readCharacterResourceHistoryInTransaction(db,bookId,characterId,selection);await db.query('COMMIT');return result;}catch(error){await db.query('ROLLBACK');throw error;}finally{db.release();}
}
