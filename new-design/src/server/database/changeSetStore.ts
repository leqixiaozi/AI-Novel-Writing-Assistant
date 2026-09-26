import { randomUUID } from "node:crypto";
import type { BookChangeImpact, BookChangeOperationKey, BookChangeSet, BookViewCard, BookViewWorkspace } from "../../common/contracts";
import { NewDesignError, assertFound } from "../domain/errors";
import {
  applyCharacterRelation,
  applyClueLifecycle,
  applyNarrativePlacement,
  applyStoryTimePosition,
  getBookViewWorkspace,
  type CharacterRelationInput,
  type ClueLifecycleInput,
  type NarrativePlacementInput,
  type StoryTimeInput,
} from "./bookViewStore";
import { getNewDesignPool } from "./runtime";
import {createRecordCard,replaceRecordCard,requireRecordCard} from "./recordCards";

export type BookChangeInput =
  | { operationKey:"story_time";input:StoryTimeInput }
  | { operationKey:"narrative_placement";input:NarrativePlacementInput }
  | { operationKey:"character_relation";input:CharacterRelationInput }
  | { operationKey:"clue_lifecycle";input:ClueLifecycleInput };

function asDate(value:unknown):string{return value instanceof Date?value.toISOString():new Date(String(value)).toISOString();}
function mapChangeSet(row:Record<string,unknown>):BookChangeSet{return{id:String(row.id),bookId:String(row.book_id),operationKey:row.operation_key as BookChangeOperationKey,input:row.input as Record<string,unknown>,impacts:row.impacts as BookChangeImpact[],status:row.status as BookChangeSet["status"],createdAt:asDate(row.created_at),appliedAt:row.applied_at?asDate(row.applied_at):null};}
function card(workspace:BookViewWorkspace,id:string,label:string):BookViewCard{return assertFound(workspace.cards.find((item)=>item.id===id),`${label}不存在、已归档或不属于当前书籍。`);}
function timeLabel(startOrder:number|null,endOrder:number|null,startLabel:string,endLabel:string):string{const order=startOrder===null?"未排序":endOrder!==null&&endOrder!==startOrder?`顺序 ${startOrder}–${endOrder}`:`顺序 ${startOrder}`;const label=[startLabel,endLabel&&endLabel!==startLabel?endLabel:""].filter(Boolean).join(" 至 ");return label?`${order}（${label}）`:order;}

function previewImpacts(workspace:BookViewWorkspace,change:BookChangeInput):{impacts:BookChangeImpact[];baseRevisions:Record<string,number>}{
  if(change.operationKey==="story_time"){
    const target=card(workspace,change.input.cardId,"事件");if(target.typeKey!=="event")throw new NewDesignError("只有事件资料可以设置故事时间。",422);
    const current=workspace.storyTimePositions.find((item)=>item.cardId===target.id);if(current&&current.revision!==change.input.revision)throw new NewDesignError("故事时间已变化，请刷新后重新预览。",409);
    return{impacts:[{label:`调整“${target.title}”的故事时间`,before:current?timeLabel(current.startOrder,current.endOrder,current.startLabel,current.endLabel):"尚未设置",after:timeLabel(change.input.startOrder,change.input.endOrder,change.input.startLabel,change.input.endLabel),unchanged:"正文所在章节与事件内容保持不变"}],baseRevisions:{storyTime:current?.revision??0}};
  }
  if(change.operationKey==="narrative_placement"){
    const subject=card(workspace,change.input.subjectCardId,"叙事对象");const chapter=card(workspace,change.input.chapterCardId,"目标章节");if(chapter.typeKey!=="chapter")throw new NewDesignError("叙事位置必须指向章节资料。",422);if(change.input.sceneCardId&&card(workspace,change.input.sceneCardId,"目标场景").typeKey!=="scene")throw new NewDesignError("场景位置必须指向场景资料。",422);
    const current=workspace.narrativePlacements.find((item)=>item.subjectCardId===subject.id&&item.role===change.input.role);if(current&&current.revision!==change.input.revision)throw new NewDesignError("叙事位置已变化，请刷新后重新预览。",409);
    return{impacts:[{label:`移动“${subject.title}”的叙事位置`,before:current?card(workspace,current.chapterCardId,"原章节").title:"尚未安排",after:chapter.title,unchanged:"故事发生时间与资料内容保持不变"}],baseRevisions:{narrativePlacement:current?.revision??0}};
  }
  if(change.operationKey==="character_relation"){
    const source=card(workspace,change.input.sourceCardId,"起点人物"),target=card(workspace,change.input.targetCardId,"关联人物");if(source.typeKey!=="character"||target.typeKey!=="character")throw new NewDesignError("人物关系的两端都必须是人物资料。",422);
    const current=workspace.characterRelations.find((item)=>(item.sourceCardId===source.id&&item.targetCardId===target.id)||(item.sourceCardId===target.id&&item.targetCardId===source.id));if(current&&current.revision!==change.input.revision)throw new NewDesignError("人物关系已变化，请刷新后重新预览。",409);
    const before=current?`${current.sourceLabel}／${current.inverseLabel}`:"尚未建立";
    return{impacts:[{label:`调整“${source.title}”与“${target.title}”的关系`,before,after:`${change.input.sourceLabel}／${change.input.inverseLabel}`,unchanged:"两个人物资料保持不变，数据库仍只有一条关系"}],baseRevisions:{characterRelation:current?.revision??0}};
  }
  const clue=card(workspace,change.input.clueCardId,"线索或伏笔");if(!["clue_evidence","foreshadow"].includes(clue.typeKey))throw new NewDesignError("只有线索或伏笔资料可以设置埋设与揭示。",422);const plant=card(workspace,change.input.plantChapterId,"埋设章节"),reveal=card(workspace,change.input.revealChapterId,"揭示章节");if(plant.typeKey!=="chapter"||reveal.typeKey!=="chapter")throw new NewDesignError("埋设与揭示位置必须指向章节资料。",422);
  const plantPlacement=workspace.narrativePlacements.find((item)=>item.subjectCardId===clue.id&&item.role==="plant"),revealPlacement=workspace.narrativePlacements.find((item)=>item.subjectCardId===clue.id&&item.role==="reveal"),plantAnchor=workspace.textAnchors.find((item)=>item.subjectCardId===clue.id&&item.role==="plant"),revealAnchor=workspace.textAnchors.find((item)=>item.subjectCardId===clue.id&&item.role==="reveal");
  for(const [actual,expected,label] of [[plantPlacement?.revision,change.input.plantPlacementRevision,"埋设位置"],[revealPlacement?.revision,change.input.revealPlacementRevision,"揭示位置"],[plantAnchor?.revision,change.input.plantAnchorRevision,"埋设锚点"],[revealAnchor?.revision,change.input.revealAnchorRevision,"揭示锚点"]] as const)if(actual!==undefined&&actual!==expected)throw new NewDesignError(`${label}已变化，请刷新后重新预览。`,409);
  return{impacts:[{label:`调整“${clue.title}”的埋设与揭示`,before:`${plantPlacement?card(workspace,plantPlacement.chapterCardId,"原埋设章节").title:"未埋设"} → ${revealPlacement?card(workspace,revealPlacement.chapterCardId,"原揭示章节").title:"未揭示"}`,after:`${plant.title} → ${reveal.title}`,unchanged:"线索、章节和正文都不会被复制"},{label:"更新正文锚点",before:`${plantAnchor?.anchorLabel||"未设置"}／${revealAnchor?.anchorLabel||"未设置"}`,after:`${change.input.plantAnchor||"未设置"}／${change.input.revealAnchor||"未设置"}`}],baseRevisions:{plantPlacement:plantPlacement?.revision??0,revealPlacement:revealPlacement?.revision??0,plantAnchor:plantAnchor?.revision??0,revealAnchor:revealAnchor?.revision??0}};
}

export async function previewBookChangeSet(bookId:string,change:BookChangeInput):Promise<BookChangeSet>{
  const workspace=await getBookViewWorkspace(bookId),preview=previewImpacts(workspace,change),client=await(await getNewDesignPool()).connect();
  try{await client.query('BEGIN');const result=await createRecordCard(client,{id:randomUUID(),spaceId:workspace.spaceId,typeKey:'book_change_set',title:'书内变更预览',values:{book_id:bookId,operation_key:change.operationKey,input:change.input,impacts:preview.impacts,base_revisions:preview.baseRevisions,status:'previewed',applied_at:null}});await client.query('COMMIT');return mapChangeSet(result);}
  catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}

export async function applyBookChangeSet(id:string):Promise<BookChangeSet>{
  const pool=await getNewDesignPool();const client=await pool.connect();
  try{await client.query("BEGIN");const row=await requireRecordCard(client,id,'book_change_set',"影响预览不存在。",{lock:true});if(row.status!=="previewed")throw new NewDesignError("这份影响预览已经处理，不能重复应用。",409);const bookId=String(row.book_id);const input=row.input as Record<string,unknown>;
    if(row.operation_key==="story_time")await applyStoryTimePosition(client,bookId,input as unknown as StoryTimeInput);
    else if(row.operation_key==="narrative_placement")await applyNarrativePlacement(client,bookId,input as unknown as NarrativePlacementInput);
    else if(row.operation_key==="character_relation")await applyCharacterRelation(client,bookId,input as unknown as CharacterRelationInput);
    else if(row.operation_key==="clue_lifecycle")await applyClueLifecycle(client,bookId,input as unknown as ClueLifecycleInput);
    else throw new NewDesignError("这份影响预览包含未知操作。",422);
    const applied=await replaceRecordCard(client,{id:row.recordCardId,spaceId:row.recordSpaceId,typeKey:'book_change_set',values:{...row,status:'applied',applied_at:new Date().toISOString()}});await client.query("COMMIT");return mapChangeSet(applied);
  }catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
}
