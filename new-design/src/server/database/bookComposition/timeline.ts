import {appendCompositionReceipt,compositionStoryIds,lockStoryRecords,planningObjectRows,planningVersionReferenceRows,readCompositionReceipt} from './records';
import {experienceCandidateSourceSchema} from '../../../common/characterExperiences/schema';
import {recentBodyExperienceCandidateSourceSchema} from '../../../common/characterExperiences/recentBodies';
import {validateRecentBodyExperienceCommandInTransaction,saveRecentBodyExperienceTimeInTransaction,recordRecentBodyExperienceAdoptionInTransaction} from '../characterExperiences/recentBodies';
import {validateExperienceCommandInTransaction,recordExperienceAdoptionInTransaction} from '../characterExperiences';
import {randomUUID} from "node:crypto";
import type {PoolClient} from "pg";
import {z} from "zod";
import type {AuthorTimelineCommand,AuthorTimelineWorkspace,AuthorTimelinePreviewInput,AuthorTimelinePreview,AuthorTimelineSaveInput,AuthorTimelineReceipt} from "../../../common/bookComposition/timeline";
import {getNewDesignPool} from "../runtime";
import {NewDesignError,assertFound} from "../../domain/errors";
import {formHash} from "../formAssist";
import {getStoryTimeProposal,getStoryRelationProposal,listAuthorStoryOccurrencesInTransaction,readAuthorFormalStoryTimelineInTransaction,validateAuthorTimelineCommandInTransaction,proposeStoryTime,editStoryTimeProposal,reviewStoryTimeProposal,proposeStoryRelation,editStoryRelationProposal,reviewStoryRelationProposal,saveStoryNarrativeOccurrence} from "../storyTimeline";

const id=z.string().uuid(),text=z.string().max(10000),nullableText=text.nullable(),nullableId=id.nullable(),number=z.number().finite().nullable();
const instant=nullableText.refine(value=>value===null||/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value)&&Number.isFinite(Date.parse(value)),"请填写带明确时区的有效日期时间，例如 2026-09-16T08:00:00+08:00。");
// This author command does not manufacture body/AI evidence; existing evidence is reviewed by its owning domain.
const evidence={evidenceKind:z.literal("manual"),chapterDocumentId:z.null(),bodyVersionId:z.null(),textAnchorId:z.null(),factId:z.null(),planVersionId:z.null(),stateProposalId:z.null()};
const time=z.object({lifecycle:z.enum(["planned","occurred","cancelled","invalidated"]),timeMode:z.enum(["absolute","custom_calendar","relative","partial","unknown"]),startCertainty:z.enum(["known","partial","unknown"]),endCertainty:z.enum(["known","partial","unknown"]),startInstant:instant,endInstant:instant,timezoneName:nullableText,calendarKey:nullableText,startLabel:nullableText,endLabel:nullableText,normalizedStart:number,normalizedEnd:number,durationValue:number,durationUnit:nullableText,relativeToEventCardId:nullableId,relativeRelation:z.enum(["before","after","simultaneous"]).nullable(),relativeOffset:number,replacesTimingId:nullableId,reason:text.trim().min(1),...evidence}).strict();
const relation=z.object({relationFamily:z.enum(["temporal","causal"]),relationType:z.enum(["before","after","simultaneous","overlaps","contains","causes","enables","blocks","depends_on"]),sourceEventCardId:id,targetEventCardId:id,confidence:z.number().finite().min(0).max(1).nullable(),reason:text.trim().min(1),...evidence}).strict();
const occurrence=z.object({eventCardId:id,chapterCardId:id,sceneCardId:nullableId,chapterDocumentId:z.null(),bodyVersionId:z.null(),textAnchorId:z.null(),role:z.enum(["mention","scene","reveal","retell","flashback","flashforward"]),narrativeOrder:z.number().finite().int().min(0).nullable(),sourceKind:z.literal("manual"),note:text}).strict();
const review={proposalId:id,expectedRevision:z.number().int().positive(),action:z.enum(["confirm","reject"]),note:text};
const command=z.discriminatedUnion("operation",[
 z.object({operation:z.literal("time_create"),eventCardId:id,value:time}).strict(),z.object({operation:z.literal("time_edit"),proposalId:id,expectedRevision:z.number().int().positive(),value:time}).strict(),z.object({operation:z.literal("time_review"),...review}).strict(),
 z.object({operation:z.literal("relation_create"),value:relation}).strict(),z.object({operation:z.literal("relation_edit"),proposalId:id,expectedRevision:z.number().int().positive(),value:relation}).strict(),z.object({operation:z.literal("relation_review"),...review}).strict(),
 z.object({operation:z.literal("occurrence_create"),value:occurrence}).strict(),z.object({operation:z.literal("occurrence_edit"),occurrenceId:id,expectedRevision:z.number().int().positive(),value:occurrence}).strict()
]);
export const authorTimelinePreviewSchema=z.object({requestKey:id,expectedSourceHash:z.string().regex(/^[a-f0-9]{64}$/),command,candidateSource:experienceCandidateSourceSchema.optional(),recentCandidateSource:recentBodyExperienceCandidateSourceSchema.optional()}).strict();
export const authorTimelineSaveSchema=authorTimelinePreviewSchema.extend({previewHash:z.string().regex(/^[a-f0-9]{64}$/)}).strict();
export class BookCompositionTimelineWriteError extends NewDesignError {constructor(message:string,status:number,public readonly mutationOutcome:"not_written"|"unknown",issues?:Record<string,string>){super(message,status,issues);}}

async function readSource(client:PoolClient,bookId:string,lock=false):Promise<AuthorTimelineWorkspace>{
 const book=assertFound((await client.query(`SELECT id,space_id,status FROM new_design.books WHERE id=$1 ${lock?"FOR UPDATE":""}`,[bookId])).rows[0],"本书不存在。");if(book.status!=="active")throw new NewDesignError("本书已归档，不能改变事件安排。",409);
 const cards=(await client.query(`SELECT card.id,card.current_version_id,card.title,card.updated_at,type.type_key,type.name AS type_name FROM new_design.cards card JOIN new_design.card_types type ON type.id=card.card_type_id WHERE card.space_id=$1 AND card.status='active' AND NOT type.is_internal AND card.current_version_id IS NOT NULL ORDER BY card.id ${lock?"FOR SHARE OF card":""}`,[book.space_id])).rows;
 const plans=(await client.query(`SELECT id,parent_object_id,card_id,status,revision,current_version_id,adopted_version_id FROM ${planningObjectRows} composition_record WHERE book_id=$1 ORDER BY id ${lock?"FOR SHARE":""}`,[bookId])).rows;
 const documents=(await client.query(`SELECT id,chapter_card_id,status,revision,adopted_version_id FROM new_design.chapter_documents WHERE book_id=$1 ORDER BY id ${lock?"FOR SHARE":""}`,[bookId])).rows;
 const timeRows=await compositionStoryIds(client,'story_time_proposal',bookId,lock),relationRows=await compositionStoryIds(client,'story_relation_proposal',bookId,lock);
 if(lock)await compositionStoryIds(client,'story_event_narrative_occurrence',bookId,true);
 const times=[] as AuthorTimelineWorkspace["times"],relations=[] as AuthorTimelineWorkspace["relations"];
 for(const row of timeRows)times.push(await getStoryTimeProposal(String(row.id),client));for(const row of relationRows)relations.push(await getStoryRelationProposal(String(row.id),client));
 const occurrences=await listAuthorStoryOccurrencesInTransaction(client,bookId),formal=await readAuthorFormalStoryTimelineInTransaction(client,bookId);
 const sourceHash=formHash({book,cards:cards.map(row=>({...row,updated_at:row.updated_at instanceof Date?row.updated_at.toISOString():row.updated_at})),plans,documents,times,relations,occurrences,...formal});
 return {bookId,sourceHash,materials:cards.map(row=>({cardId:String(row.id),cardVersionId:String(row.current_version_id),title:String(row.title),typeKey:String(row.type_key),typeName:String(row.type_name),updatedAt:row.updated_at instanceof Date?row.updated_at.toISOString():String(row.updated_at)})),times,relations,occurrences,...formal};
}
async function read<T>(bookId:string,action:(client:PoolClient)=>Promise<T>):Promise<T>{const client=await(await getNewDesignPool()).connect();try{await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");const value=await action(client);await client.query("COMMIT");return value;}catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}}
export function getBookCompositionTimelineWorkspace(bookId:string):Promise<AuthorTimelineWorkspace>{return read(bookId,client=>readSource(client,bookId));}
const labels:Record<string,string>={planned:"计划发生",occurred:"已发生",cancelled:"已取消",invalidated:"已失效",absolute:"现实时间",custom_calendar:"自定义历法",relative:"相对事件",partial:"部分确定",unknown:"未知时间",known:"已确定",before:"先于",after:"后于",simultaneous:"同时",overlaps:"重叠",contains:"包含",causes:"导致",enables:"促成",blocks:"阻止",depends_on:"依赖",mention:"提及",scene:"现场叙述",reveal:"揭示",retell:"重述",flashback:"回忆",flashforward:"预叙"};
function describe(source:AuthorTimelineWorkspace,value:unknown):string{if(!value||typeof value!=="object")return "尚未建立";const item=value as Record<string,unknown>,title=(key:unknown)=>source.materials.find(card=>card.cardId===key)?.title??"来源待核对",label=(key:unknown)=>labels[String(key)]??"未填写";
 if("currentVersion" in item)return describe(source,item.currentVersion);
 if("timeMode" in item)return [label(item.lifecycle),label(item.timeMode),item.startLabel??item.startInstant??(item.normalizedStart!==null?String(item.normalizedStart):"开始时间未确定"),item.endLabel??item.endInstant??"结束时间未确定",item.relativeToEventCardId?`${label(item.relativeRelation)} ${title(item.relativeToEventCardId)}，偏移 ${item.relativeOffset??"未填写"}`:"",item.reason].filter(Boolean).join("；");
 if("relationType" in item)return `${title(item.sourceEventCardId)} ${label(item.relationType)} ${title(item.targetEventCardId)}；${item.reason??""}`;
 return `${title(item.eventCardId)} → ${title(item.chapterCardId)}${item.sceneCardId?` / ${title(item.sceneCardId)}`:""}；${label(item.role)}；章内顺序 ${item.narrativeOrder??"未指定"}；${item.note??""}`;
}
async function preview(client:PoolClient,bookId:string,input:AuthorTimelinePreviewInput,source:AuthorTimelineWorkspace):Promise<AuthorTimelinePreview>{
 if(input.candidateSource&&input.recentCandidateSource)throw new NewDesignError('小传和采用正文候选须分别核对，不能混用原来源。',422);
 if(input.expectedSourceHash!==source.sourceHash)throw new NewDesignError("事件、目录或正文来源已变化；草稿保留，先只读核对再明确重新准备。",409,{expectedSourceHash:"请核对并采用最新来源。"});
 if(input.candidateSource)await validateExperienceCommandInTransaction(client,bookId,input.candidateSource,input.command);
 const recentProof=input.recentCandidateSource?await validateRecentBodyExperienceCommandInTransaction(client,bookId,input.recentCandidateSource,input.command):null;
 const current=await validateAuthorTimelineCommandInTransaction(client,bookId,input.command),review="action" in input.command;
 const changes=[{label:review?"提案审核决定":input.command.operation.startsWith("time_")?"事件故事时间":input.command.operation.startsWith("relation_")?"事件因果或时间关系":"跨章叙述位置",before:describe(source,current),after:"action" in input.command?(input.command.action==="confirm"?"明确确认为正式安排":"不采用，历史保留"):describe(source,"value" in input.command?input.command.value:null)}];
 if(input.command.operation==="time_review"&&input.command.action==="confirm"&&current&&"eventCardId" in current){changes.push({label:"正式故事时间",before:describe(source,source.timings.find(item=>item.eventCardId===current.eventCardId)),after:describe(source,current)});}
 const events=input.command.operation.startsWith("time_")?current&&"eventCardId" in current?[current.eventCardId]:input.command.operation==="time_create"?[input.command.eventCardId]:[]:"value" in input.command?"sourceEventCardId" in input.command.value?[input.command.value.sourceEventCardId,input.command.value.targetEventCardId]:"eventCardId" in input.command.value?[input.command.value.eventCardId]:[]:current&&"currentVersion" in current&&"sourceEventCardId" in current.currentVersion?[current.currentVersion.sourceEventCardId,current.currentVersion.targetEventCardId]:[];
 if(events.length){const affected=(await client.query(`SELECT DISTINCT object.title FROM ${planningObjectRows} object JOIN ${planningVersionReferenceRows} reference ON reference.planning_object_id=object.id AND reference.planning_version_id IN (object.current_version_id,object.adopted_version_id) WHERE object.book_id=$1 AND object.status='active' AND reference.reference_role='event' AND reference.card_id=ANY($2::uuid[]) ORDER BY object.title`,[bookId,events])).rows;changes.push({label:"当前引用该事件的规划范围",before:affected.map(row=>String(row.title)).join("、")||"暂无已保存的规划引用",after:review?"正式安排改变后请在这些原规划中逐项复核，不自动改计划或正文。":"保存此提案或位置不自动改动上述原规划。"});}
 if(recentProof)changes.push({label:'原采用正文依据',before:'待核对的正文经历候选',after:`${recentProof.actor.title}；第${recentProof.body.logicalOrder}章 ${recentProof.body.title}；${recentProof.candidate.evidenceLabel}`});
 const warnings=["不修改章节正文，不自动采用正文，也不结算对象或关系状态。",review?"确认会改变正式故事时间或事件关系；依赖该安排的后续计划需要作者复核。":"时间与关系先保存提案，必须再明确审核后才生效；叙述位置保存为原事件的新引用。",...(input.recentCandidateSource?['保存此时间提案时绑定原采用正文的精确原文依据；故事时间仍须单独明确审核。']:[]),...(input.command.operation==="occurrence_create"?["这是新叙述位置，已有章节中的第一次出现保持不变。"]:[])];
 return {bookId,input,previewHash:formHash({bookId,input,sourceHash:source.sourceHash,changes,warnings}),changes,warnings};
}
export function previewBookCompositionTimeline(bookId:string,raw:AuthorTimelinePreviewInput):Promise<AuthorTimelinePreview>{const input=authorTimelinePreviewSchema.parse(raw) as AuthorTimelinePreviewInput;return read(bookId,async client=>preview(client,bookId,input,await readSource(client,bookId)));}
async function execute(client:PoolClient,bookId:string,input:AuthorTimelineSaveInput):Promise<AuthorTimelineReceipt["result"]>{const c=input.command;
 if(input.recentCandidateSource)return saveRecentBodyExperienceTimeInTransaction(client,bookId,input.recentCandidateSource,c);
 switch(c.operation){
 case "time_create":return proposeStoryTime({...c.value,evidenceKind:"manual",bookId,eventCardId:c.eventCardId,proposalSource:"manual",editor:input.candidateSource?`user:experience:${input.candidateSource.batchId}:${input.candidateSource.candidateId}`:"user"},client);
 case "time_edit":return editStoryTimeProposal(c.proposalId,{...c.value,evidenceKind:"manual",expectedRevision:c.expectedRevision,actor:"user"},client);
 case "time_review":return reviewStoryTimeProposal(c.proposalId,{action:c.action,note:c.note,expectedRevision:c.expectedRevision,idempotencyKey:input.requestKey,actor:"user"},client);
 case "relation_create":return proposeStoryRelation({...c.value,bookId,proposalSource:"manual",editor:"user"},client);
 case "relation_edit":return editStoryRelationProposal(c.proposalId,{...c.value,expectedRevision:c.expectedRevision,actor:"user"},client);
 case "relation_review":return reviewStoryRelationProposal(c.proposalId,{action:c.action,note:c.note,expectedRevision:c.expectedRevision,idempotencyKey:input.requestKey,actor:"user"},client);
 case "occurrence_create":return saveStoryNarrativeOccurrence({...c.value,bookId},client);
 case "occurrence_edit":return saveStoryNarrativeOccurrence({...c.value,bookId,id:c.occurrenceId,expectedRevision:c.expectedRevision},client);
 }
}
export async function saveBookCompositionTimeline(bookId:string,raw:AuthorTimelineSaveInput):Promise<AuthorTimelineReceipt>{
 const input=authorTimelineSaveSchema.parse(raw) as AuthorTimelineSaveInput,inputHash=formHash(input);let client:PoolClient;
 try{client=await(await getNewDesignPool()).connect();}catch{throw new BookCompositionTimelineWriteError('连接底座失败，本次尚未写入；草稿与影响预览保留。',503,'not_written');}
 let commitStarted=false,locked=false,discardConnection=false;
 try{
  // Acquire the session lock before SERIALIZABLE establishes its snapshot; queued duplicates see the committed original.
  await client.query('SELECT pg_advisory_lock(hashtextextended($1,0))',[`composition-timeline:${bookId}`]);locked=true;
  await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');await lockStoryRecords(client);
  const existing=await readCompositionReceipt(client,'book_composition_timeline_command',bookId,input.requestKey);
  if(existing){if(existing.input_hash!==inputHash)throw new BookCompositionTimelineWriteError('原请求标识已用于不同事件修改，请保留原凭证核对。',409,'unknown');commitStarted=true;await client.query('COMMIT');return{...existing.receipt,repeated:true};}
  const source=await readSource(client,bookId,true),checked=await preview(client,bookId,{requestKey:input.requestKey,expectedSourceHash:input.expectedSourceHash,command:input.command,...(input.candidateSource?{candidateSource:input.candidateSource}:{}),...(input.recentCandidateSource?{recentCandidateSource:input.recentCandidateSource}:{})},source);
  if(checked.previewHash!==input.previewHash)throw new NewDesignError('影响预览已变化，请重新预览后明确确认。',409,{previewHash:'重新预览此修改。'});
  const result=await execute(client,bookId,input),receipt:AuthorTimelineReceipt={bookId,requestKey:input.requestKey,inputHash,operation:input.command.operation,result,repeated:false,...(input.candidateSource?{candidateSource:input.candidateSource}:{}),...(input.recentCandidateSource?{recentCandidateSource:input.recentCandidateSource}:{})};
  if(input.candidateSource)await recordExperienceAdoptionInTransaction(client,bookId,input.candidateSource,receipt,inputHash);
  if(input.recentCandidateSource)await recordRecentBodyExperienceAdoptionInTransaction(client,bookId,input.recentCandidateSource,receipt,inputHash);
  await appendCompositionReceipt(client,'book_composition_timeline_command',bookId,input.requestKey,inputHash,input,receipt,randomUUID());
  commitStarted=true;await client.query('COMMIT');return receipt;
 }catch(error){let rolledBack=false;try{await client.query('ROLLBACK');rolledBack=true;}catch{discardConnection=true;}if(error instanceof BookCompositionTimelineWriteError)throw error;
  throw new BookCompositionTimelineWriteError(error instanceof NewDesignError?error.message:'本次事件修改回执尚未确认；原请求、草稿与已保存来源保留，请只读核对。',error instanceof NewDesignError?error.status:503,!commitStarted&&rolledBack&&!(error instanceof Error&&'mutationOutcome' in error&&error.mutationOutcome==='unknown')?'not_written':'unknown',error instanceof NewDesignError?error.issues:undefined);
 }finally{if(locked)try{await client.query('SELECT pg_advisory_unlock(hashtextextended($1,0))',[`composition-timeline:${bookId}`]);}catch{discardConnection=true;}client.release(discardConnection);}
}

export async function getBookCompositionTimelineReceipt(bookId:string,key:string):Promise<AuthorTimelineReceipt|null>{id.parse(key);const client=await(await getNewDesignPool()).connect();try{await client.query("BEGIN");await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[`composition-timeline:${bookId}`]);assertFound((await client.query("SELECT id FROM new_design.books WHERE id=$1",[bookId])).rows[0],"本书不存在。");const row=await readCompositionReceipt(client,'book_composition_timeline_command',bookId,key);await client.query("COMMIT");return row?row.receipt:null;}catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}}

export async function readBookCompositionTimelineOriginalReceipt(bookId:string,raw:AuthorTimelineSaveInput):Promise<AuthorTimelineReceipt|null>{
 const input=authorTimelineSaveSchema.parse(raw),receipt=await getBookCompositionTimelineReceipt(bookId,input.requestKey);
 if(receipt&&receipt.inputHash!==formHash(input))throw new BookCompositionTimelineWriteError('原事件回执与完整修改或候选来源不同，保留原凭证核对。',409,'unknown');return receipt;
}
