import {characterRecordCtes,insertCharacterRecords,updateCharacterRecords,lockedCharacterQuery,characterCapability} from '../characterDialogue/storage';
import {randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import type {FieldDefinition} from '../../../common/contracts';
import {characterAuthorInfluenceCommandSchema,characterAuthorInfluenceSchema,characterAuthorInfluenceReceiptSchema,type CharacterAuthorInfluence} from '../../../common/characterAuthor';
import {getNewDesignPool} from '../runtime';
import {stableHash} from '../aiContracts';
import {createAuthorMaterialInTransaction} from '../authorMaterials';
import {NewDesignError,assertFound} from '../../domain/errors';
import {readCharacterAuthorSource} from './sources';

type Row={id:string;book_id:string;card_id:string;source_hash:string;draft:CharacterAuthorInfluence['draft'];target_start:number;target_end:number;status:CharacterAuthorInfluence['status'];revision:number;guidance_card_id:string|null;guidance_version_id:string|null;input_payload:{cutoffBodyVersionId:string|null}};
type GuidanceMaterial={id:string;current_version_id:string;title:string;values:Record<string,unknown>;type_name:string;type_key:string};
const GUIDE_TYPE='character_author_guidance';
export async function influenceCapability(client:PoolClient){return characterCapability(client,['character_author_trial','character_author_influence_candidate'],'new_design.assert_character_author_trial(jsonb,jsonb)');}
async function scope(client:PoolClient,bookId:string,cardId:string,lock=false){return assertFound((await client.query(`SELECT person.title,book.space_id FROM new_design.books book JOIN new_design.cards person ON person.space_id=book.space_id AND person.status='active' JOIN new_design.card_types type ON type.id=person.card_type_id AND type.type_key='character' WHERE book.id=$1 AND person.id=$2 AND book.status='active' ${lock?'FOR UPDATE OF book':''}`,[bookId,cardId])).rows[0],'创作倾向人物不属于当前有效书籍，未改选。');}
async function nextOrder(client:PoolClient,bookId:string){return Number((await client.query(`WITH ${characterRecordCtes.chapter_stable_checkpoints}
SELECT COALESCE(max(document.logical_order),0)+1 next_order FROM new_design.chapter_documents document JOIN chapter_stable_checkpoints checkpoint ON checkpoint.chapter_document_id=document.id AND checkpoint.body_version_id=document.adopted_version_id AND checkpoint.status='stable' WHERE document.book_id=$1 AND document.status='active'`,[bookId])).rows[0].next_order);}
const select=`WITH ${characterRecordCtes.character_author_influence_candidates},
${characterRecordCtes.character_author_trials}
SELECT candidate.*,trial.input_payload,trial.source_snapshot FROM character_author_influence_candidates candidate JOIN character_author_trials trial ON trial.id=candidate.id`;
async function present(client:PoolClient,row:Row,lockSources=false):Promise<CharacterAuthorInfluence>{
 let effectiveStatus=row.status,reason='创作指导候选；不是已发生事实、正式认知或状态。';
 if(['draft','active'].includes(row.status)){
  if(await nextOrder(client,row.book_id)>Number(row.target_end)+1){effectiveStatus='expired';reason='后续稳定章节已越过原适用范围；停止新上下文引用。';}
  else try{const current=await readCharacterAuthorSource(client,row.book_id,row.card_id,row.input_payload.cutoffBodyVersionId,lockSources);if(current.hash!==row.source_hash){effectiveStatus='expired';reason='人物、关系或截至章原来源已变化；停止新上下文引用。';}}catch(error){if(!(error instanceof NewDesignError))throw error;effectiveStatus='expired';reason='原人物或截至章来源未完整核对；停止新上下文引用。';}
  if(effectiveStatus!=='expired'&&row.guidance_card_id){const material=(await client.query("SELECT 1 FROM new_design.cards WHERE id=$1 AND current_version_id=$2 AND status='active'",[row.guidance_card_id,row.guidance_version_id])).rowCount;if(!material){effectiveStatus='expired';reason='原创作指导版本被修改或归档；不使用另一版本替代。';}}
 }
 const references=row.guidance_version_id?(await client.query(`WITH ${characterRecordCtes.chapter_writing_requests}
SELECT request.id FROM chapter_writing_requests request JOIN new_design.ai_tasks task ON task.id=request.ai_task_id AND task.status='succeeded' WHERE request.book_id=$1 AND request.result_body_version_id IS NOT NULL AND request.controlled_output IS NOT NULL AND EXISTS(SELECT 1 FROM jsonb_array_elements(request.controlled_snapshot->'input'->'materials') item WHERE item->>'cardId'=$2 AND item->>'versionId'=$3) ORDER BY request.created_at DESC,request.id DESC LIMIT 101`,[row.book_id,row.guidance_card_id,row.guidance_version_id])).rows:[];
 if(references.length&&effectiveStatus==='active')reason='原候选生成已引用此版本；未消耗指导，有效范围内重写和后续章仍可引用。不表示正文已采用或人物已执行。';
 return characterAuthorInfluenceSchema.parse({id:row.id,bookId:row.book_id,cardId:row.card_id,sourceHash:row.source_hash,draft:row.draft,targetStart:Number(row.target_start),targetEnd:Number(row.target_end),status:row.status,effectiveStatus,revision:Number(row.revision),guidanceCardId:row.guidance_card_id??null,guidanceVersionId:row.guidance_version_id??null,referencedRequestIds:references.slice(0,100).map(item=>String(item.id)),referencesTruncated:references.length>100,reason});
}
async function readOnly<T>(work:(client:PoolClient)=>Promise<T>){const client=await(await getNewDesignPool()).connect();try{await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');const result=await work(client);await client.query('COMMIT');return result;}catch(error){await client.query('ROLLBACK').catch(()=>undefined);throw error;}finally{client.release();}}
export async function getCharacterAuthorInfluences(bookId:string,cardId:string){return readOnly(async client=>{await scope(client,bookId,cardId);const capability=await influenceCapability(client),rows=capability.installed?(await client.query(select+' WHERE candidate.book_id=$1 AND candidate.card_id=$2 ORDER BY candidate.created_at DESC,candidate.id DESC LIMIT 201',[bookId,cardId])).rows:[],candidates:CharacterAuthorInfluence[]=[];for(const row of rows.slice(0,200))candidates.push(await present(client,row));return{bookId,cardId,capability,candidates,truncated:rows.length>200,nextChapterOrder:await nextOrder(client,bookId)};});}
export async function readCharacterAuthorInfluenceDecision(bookId:string,cardId:string,requestKey:string){return readOnly(async client=>{await scope(client,bookId,cardId);if(!(await influenceCapability(client)).installed)return null;const row=(await client.query(`WITH ${characterRecordCtes.character_author_influence_decisions}
SELECT receipt FROM character_author_influence_decisions WHERE request_key=$1 AND book_id=$2 AND card_id=$3`,[requestKey,bookId,cardId])).rows[0];return row?characterAuthorInfluenceReceiptSchema.parse(row.receipt):null;});}

async function guideType(client:PoolClient,spaceId:string){
 const existing=(await client.query('SELECT id,status,current_version_id,source_card_type_id FROM new_design.card_types WHERE space_id=$1 AND type_key=$2',[spaceId,GUIDE_TYPE])).rows[0];
 const definitions:Array<[string,string,FieldDefinition['type']]>=[['content_kind','资料性质','short_text'],['character_id','人物原编号','short_text'],['source_trial_id','谈话原回合','short_text'],['source_hash','原冻结来源','short_text'],['draft_json','原结构化创作指导','long_text'],['target_start','适用起章','number'],['target_end','适用止章','number']];
 const fields:FieldDefinition[]=definitions.map(([key,name,type],order)=>({key,name,type,description:'明确选用的创作指导，不是已发生事实。',required:true,defaultValue:null,options:[],group:'谈话创作指导',order,aiSuggestible:false,stateSettlement:'none'}));
 if(existing){const version=(await client.query('SELECT fields FROM new_design.card_type_versions WHERE id=$1 AND card_type_id=$2',[existing.current_version_id,existing.id])).rows[0];if(existing.status!=='published'||existing.source_card_type_id||!version||stableHash(version.fields)!==stableHash(fields))throw new NewDesignError('本书同名创作指导类型与原受控规格不一致，未覆盖。',409);return existing.id as string;}
 const id=randomUUID(),versionId=randomUUID();await client.query("INSERT INTO new_design.card_types(id,space_id,type_key,name,description,status,draft_fields,is_system,sort_order,semantic_capabilities) VALUES($1,$2,$3,'谈话创作指导','仅明确选择的后续创作倾向，不是正式事实或状态。','published',$4::jsonb,false,990,'[]'::jsonb)",[id,spaceId,GUIDE_TYPE,JSON.stringify(fields)]);await client.query('INSERT INTO new_design.card_type_versions(id,card_type_id,version,fields) VALUES($1,$2,1,$3::jsonb)',[versionId,id,JSON.stringify(fields)]);await client.query('UPDATE new_design.card_types SET current_version_id=$2 WHERE id=$1',[id,versionId]);return id;
}
export async function decideCharacterAuthorInfluence(raw:unknown){
 const input=characterAuthorInfluenceCommandSchema.parse(raw),hash=stableHash(input),client=await(await getNewDesignPool()).connect();let committing=false,absent=false;
 try{await client.query('BEGIN');await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`character-author-influence:${input.requestKey}`]);
  if(!(await influenceCapability(client)).installed){absent=true;throw new NewDesignError('创作倾向尚未安装；原候选保留。',503);}
  const prior=(await client.query(`WITH ${characterRecordCtes.character_author_influence_decisions}
SELECT input_hash,receipt FROM character_author_influence_decisions WHERE request_key=$1`,[input.requestKey])).rows[0];if(prior){if(prior.input_hash!==hash)throw new NewDesignError('原创作倾向选择键不能改动完整输入。',409);committing=true;await client.query('COMMIT');return characterAuthorInfluenceReceiptSchema.parse(prior.receipt);}
  absent=true;const person=await scope(client,input.bookId,input.cardId,true);await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`character-author-influence-person:${input.bookId}:${input.cardId}`]);
  const row=assertFound((await lockedCharacterQuery<Row>(client,select+' WHERE candidate.id=$1 AND candidate.book_id=$2 AND candidate.card_id=$3',[input.candidateId,input.bookId,input.cardId])).rows[0],'原创作倾向候选未找到。');if(row.source_hash!==input.sourceHash||Number(row.revision)!==input.expectedRevision)throw new NewDesignError('原创作倾向修订已变化，选择保留。',409);
  if(input.action==='activate'){
   if(!(await influenceCapability(client)).operational)throw new NewDesignError('创作倾向带入尚未启用，原候选保留。',503);
   if(row.status!=='draft'||(await present(client,row,true)).effectiveStatus==='expired')throw new NewDesignError('原倾向已选择或来源失效，不能带入。',409);
   if(input.targetStart<await nextOrder(client,input.bookId))throw new NewDesignError('创作倾向只能带入后续未完成章，请核对原适用范围。',409);
   const typeId=await guideType(client,String(person.space_id)),receipt=await createAuthorMaterialInTransaction(client,input.bookId,{requestKey:input.requestKey,cardTypeId:typeId,title:`${person.title} · 谈话创作指导`,values:{content_kind:'author_selected_creative_guidance',character_id:input.cardId,source_trial_id:row.id,source_hash:row.source_hash,draft_json:JSON.stringify(row.draft),target_start:input.targetStart,target_end:input.targetEnd},formVersionId:null,formResolutionKind:'type_schema'});
   const version=assertFound((await client.query('SELECT current_version_id FROM new_design.cards WHERE id=$1',[receipt.card.id])).rows[0],'原指导版本回执未找到。');
   await updateCharacterRecords(client,'character_author_influence_candidate',`WITH ${characterRecordCtes.character_author_influence_candidates}
SELECT character_author_influence_candidates.*,('superseded')::text AS status,(revision+1)::integer AS revision,(now())::timestamptz AS updated_at FROM character_author_influence_candidates WHERE book_id=$1 AND card_id=$2 AND status='active' AND target_start<=$4 AND target_end>=$3`,[input.bookId,input.cardId,input.targetStart,input.targetEnd]);
   await updateCharacterRecords(client,'character_author_influence_candidate',`WITH ${characterRecordCtes.character_author_influence_candidates}
SELECT character_author_influence_candidates.*,('active')::text AS status,($2)::integer AS target_start,($3)::integer AS target_end,($4)::uuid AS guidance_card_id,($5)::uuid AS guidance_version_id,(revision+1)::integer AS revision,(now())::timestamptz AS updated_at FROM character_author_influence_candidates WHERE id=$1`,[row.id,input.targetStart,input.targetEnd,receipt.card.id,version.current_version_id]);
  }else{if(input.targetStart!==Number(row.target_start)||input.targetEnd!==Number(row.target_end)||input.action==='dismiss'&&row.status!=='draft'||input.action==='revoke'&&row.status!=='active')throw new NewDesignError('原倾向状态或范围与本次放弃／撤销选择不一致。',409);await updateCharacterRecords(client,'character_author_influence_candidate',`WITH ${characterRecordCtes.character_author_influence_candidates}
SELECT character_author_influence_candidates.*,('dismissed')::text AS status,(revision+1)::integer AS revision,(now())::timestamptz AS updated_at FROM character_author_influence_candidates WHERE id=$1`,[row.id]);}
  const candidate=await present(client,assertFound((await client.query(select+' WHERE candidate.id=$1',[row.id])).rows[0],'原选择结果未读取。')),receipt={requestKey:input.requestKey,inputHash:hash,candidate};await insertCharacterRecords(client,'character_author_influence_decision',`SELECT ($1)::uuid AS request_key,($2)::uuid AS book_id,($3)::uuid AS card_id,($4)::uuid AS candidate_id,($5)::char(64) AS input_hash,($6::jsonb)::jsonb AS input_payload,($7::jsonb)::jsonb AS receipt`,[input.requestKey,input.bookId,input.cardId,row.id,hash,JSON.stringify(input),JSON.stringify(receipt)]);committing=true;await client.query('COMMIT');return receipt;
 }catch(error){let rollback=false;try{await client.query('ROLLBACK');rollback=true;}catch{}const result=new NewDesignError(error instanceof NewDesignError?error.message:'原倾向选择结果未确认，请保留原请求只读核对。',error instanceof NewDesignError?error.status:503);Object.assign(result,{recovery:{mutationOutcome:absent&&!committing&&rollback?'not_written':'unknown',summary:result.message,sourceRoute:`/new-design/books/${input.bookId}/story-setting?tab=characters&selected=${input.cardId}&detail=intelligence`,actionLabel:'返回原人物谈话',savedResult:'原倾向、完整选择和原请求保留；不会自动重调模型。'}});throw result;}
 finally{client.release();}
}

/** Only actual chapter/scene participants receive active guidance in the standard material preview. */
export async function readActiveCharacterAuthorGuidance(client:PoolClient,bookId:string,chapterOrder:number,participantIds:string[]){
 if(!(await influenceCapability(client)).operational||!participantIds.length)return[];
 const rows=(await client.query(select+" WHERE candidate.book_id=$1 AND candidate.card_id=ANY($2::uuid[]) AND candidate.status='active' AND candidate.target_start<=$3 AND candidate.target_end>=$3 ORDER BY candidate.id LIMIT 301",[bookId,[...new Set(participantIds)],chapterOrder])).rows;
 if(rows.length>300)throw new NewDesignError('适用创作指导超过完整冻结范围，未截断后生成。',422);
 const materials:GuidanceMaterial[]=[];for(const row of rows){if((await present(client,row)).effectiveStatus!=='active')continue;const material=(await client.query("SELECT card.id,version.id current_version_id,version.title,version.values,type.name type_name,type.type_key FROM new_design.cards card JOIN new_design.card_versions version ON version.id=$2 AND version.card_id=card.id JOIN new_design.card_types type ON type.id=card.card_type_id WHERE NOT type.is_internal AND card.id=$1 AND card.current_version_id=version.id AND card.status='active'",[row.guidance_card_id,row.guidance_version_id])).rows[0];if(material)materials.push(material);}return materials;
}
