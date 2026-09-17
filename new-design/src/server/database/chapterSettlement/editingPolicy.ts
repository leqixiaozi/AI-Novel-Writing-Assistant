import type { PoolClient } from "pg";
import type { FieldDefinition, ChapterSettlementDraft } from "../../../common/contracts";
import type { SettlementBaseline, SettlementEditingDraft, SettlementFieldChoice, SettlementSubjectChoice } from "../../../common/chapterSettlementEditing";
import { NewDesignError } from "../../domain/errors";
import { validateFieldValue } from "../../domain/validation";
import { validateDictionaryTreeBindings, validateDictionaryTreeValues } from "../treeResources";
import { stableHash } from "../aiContracts/integrity";
import {resourceSupplementChangeAlreadyConfirmed} from "../../../common/resourceSupplements";
import {readFrozenSupplementSource} from "./supplementRead";

export type EditingRow = Record<string, unknown>;
export class SettlementEditingError extends NewDesignError {
  readonly recovery:{failedStep:string;summary:string;savedResult:string;actionLabel:string;sourceRoute:string;mutationOutcome:"not_written"|"unknown"|"committed"};
  constructor(message:string,status:number,session:EditingRow|null,issues?:Record<string,string>,step="核对结算清单") {
    super(message,status,issues);
    this.recovery={failedStep:step,summary:message,savedResult:"已保存的正文、清单和正式事实保留；请先核对原请求结果。",actionLabel:session?"返回章节结算":"打开运行维护",sourceRoute:session?`/new-design/books/${session.book_id}/writing?chapterDocument=${session.chapter_document_id}&session=${session.id}`:"/new-design/structure/maintenance",mutationOutcome:"unknown"};
  }
}
export function fail(session:EditingRow|null,message:string,status=422,field?:string,step?:string):never {
  throw new SettlementEditingError(message,status,session,field?{[field]:message}:undefined,step);
}
export function displaySettlementValue(field:FieldDefinition,value:unknown,nodes:SettlementFieldChoice["dictionaryNodes"]):string {
  if(value===null||value===undefined)return "未设置";
  const one=(item:unknown):string=>{
    const node=nodes.find(node=>node.id===item);if(node)return node.path.join(" / ")||node.label;
    if(field.optionSource?.kind==="dictionary_tree")return "历史选项需核对";
    const option=field.options.find(option=>option.value===item);if(option)return option.label;
    if(typeof item==="boolean")return item?"是":"否";
    if(field.type==="select"||field.type==="multi_select")return "历史选项需核对";
    if(typeof item==="object")return "历史值需核对";
    return typeof item==="string"?item:String(item);
  };
  return Array.isArray(value)?value.map(one).join("、"):one(value);
}
export async function readBaseline(client:PoolClient,session:EditingRow,kind:"card"|"relation",id:string,key:string,field:FieldDefinition,nodes:SettlementFieldChoice["dictionaryNodes"],lock=false):Promise<SettlementBaseline>{
  let row=(await client.query("SELECT * FROM new_design.current_state_projections WHERE book_id=$1 AND subject_kind=$2 AND subject_id=$3 AND state_key=$4",[session.book_id,kind,id,key])).rows[0];
  const sourceKind=row?.source_state_change_id?"state_change":row?.source_initial_version_id?"initial_state":"unknown";
  let validSource=false;
  // Source facts are locked before their cache row, matching initial-state and
  // revert writers. Locking the projection first would permit a stale source or
  // deadlock with a source update waiting to rebuild that same projection.
  if(sourceKind==="state_change"){
    if(lock)await client.query(`SELECT document.id FROM new_design.state_changes change JOIN new_design.chapter_settlements settlement ON settlement.id=change.settlement_id JOIN new_design.chapter_documents document ON document.id=settlement.chapter_document_id WHERE change.id=$1 FOR SHARE OF document`,[row.source_state_change_id]);
    validSource=Boolean((await client.query(`SELECT change.id FROM new_design.state_changes change JOIN new_design.chapter_settlements settlement ON settlement.id=change.settlement_id AND settlement.status='committed'
      JOIN new_design.chapter_documents document ON document.id=settlement.chapter_document_id AND document.book_id=settlement.book_id AND document.status='active' AND document.adopted_version_id=settlement.body_version_id
      JOIN new_design.chapter_body_versions body ON body.id=settlement.body_version_id AND body.chapter_document_id=document.id AND body.archived_at IS NULL
      WHERE change.id=$1 AND change.book_id=$2 AND change.subject_kind=$3 AND change.subject_id=$4 AND change.state_key=$5 AND change.status='active' AND change.after_json=$6::jsonb ${lock?"FOR SHARE OF change,settlement":""}`,[row.source_state_change_id,session.book_id,kind,id,key,JSON.stringify(row.value_json)])).rowCount);
  }
  if(sourceKind==="initial_state")validSource=Boolean((await client.query(`SELECT state.id FROM new_design.entity_initial_states state JOIN new_design.entity_initial_state_versions version ON version.id=state.current_version_id WHERE version.id=$1 AND state.book_id=$2 AND state.subject_kind=$3 AND state.subject_id=$4 AND state.state_key=$5 AND version.value_json=$6::jsonb ${lock?"FOR SHARE OF state":""}`,[row.source_initial_version_id,session.book_id,kind,id,key,JSON.stringify(row.value_json)])).rowCount);
  if(lock){
    const current=(await client.query("SELECT * FROM new_design.current_state_projections WHERE book_id=$1 AND subject_kind=$2 AND subject_id=$3 AND state_key=$4 FOR UPDATE",[session.book_id,kind,id,key])).rows[0];
    if(stableHash(row?JSON.parse(JSON.stringify(row)):null)!==stableHash(current?JSON.parse(JSON.stringify(current)):null))validSource=false;
    row=current;
  }
  const baseline={known:Boolean(row)&&sourceKind!=="unknown",value:row?row.value_json:null,display:row?displaySettlementValue(field,row.value_json,nodes):"尚未建立前值",revision:row?Number(row.projection_revision):null,sourceKind,sourceId:row?.source_state_change_id?String(row.source_state_change_id):row?.source_initial_version_id?String(row.source_initial_version_id):null,stale:Boolean(row?.is_stale)||Boolean(row)&&!validSource} as Omit<SettlementBaseline,"hash">;
  return{...baseline,hash:stableHash({bookId:session.book_id,subjectKind:kind,subjectId:id,stateKey:key,...baseline})};
}
export function isStateCategory(category:ChapterSettlementDraft["category"]):boolean{return category!=="fact"&&category!=="knowledge";}
export async function validateEditingDraft(client:PoolClient,session:EditingRow,draft:SettlementEditingDraft,subjects:SettlementSubjectChoice[]):Promise<{draft:SettlementEditingDraft;subject:SettlementSubjectChoice;field:SettlementFieldChoice}> {
  if(session.adoption_kind==="resource_supplement"){
    const body=(await client.query("SELECT content_hash FROM new_design.chapter_body_versions WHERE id=$1",[session.body_version_id])).rows[0];
    const source=await readFrozenSupplementSource(client,session,String(body?.content_hash??""));
    const states=(source.basis.original.confirmedSources as {states:Record<string,unknown>[]}).states;
    if(source.contract==='stable_resource_correction_preview_v1'){
      const bound=source.correction;
      if(draft.subjectKind!==bound.subjectKind||draft.subjectId!==bound.subjectId||draft.stateKey!==bound.stateKey)
        fail(session,'本次修正只能核对原冲突字段，不能增加其他资源变化。',409,'draft.stateKey');
      // A source correction may legitimately have the same before/after value.
      // This exception belongs only to its real issue-owned field and evidence.
    }else if(resourceSupplementChangeAlreadyConfirmed(states,draft))fail(session,"已有确认变化或无变化不能再次纳入补充清单。",409,"draft.afterValue");
  }
  const kind=draft.subjectKind??"card",id=draft.subjectId??draft.subjectCardId;
  const subject=subjects.find(subject=>subject.id===id&&subject.subjectKind===kind);
  if(!subject)fail(session,"所选变化对象不属于本书，或已停用。",422,"draft.subjectId");
  if(draft.subjectCardId&&draft.subjectCardId!==subject.id)fail(session,"变化对象与资料引用不一致，不能替换实际对象。",422,"draft.subjectCardId");
  if(subject.unavailableReason)fail(session,`${subject.label}：${subject.unavailableReason}`,422,"draft.subjectId");
  if(!subject.categories.includes(draft.category))fail(session,`${subject.label}不允许该类变化。`,422,"draft.category");
  const field=subject.fields.find(field=>field.key===draft.stateKey);
  if(!field)fail(session,`${subject.label}的所选字段没有正式可结算规格，请重新选择中文字段。`,422,"draft.stateKey");
  if(draft.specificationHash!==field.specificationHash)fail(session,`${subject.label} · ${field.label}的正式规格已变化，请重新读取清单。`,409,"draft.specificationHash");
  if(!Object.hasOwn(draft,"beforeValue")||!Object.hasOwn(draft,"afterValue"))fail(session,"变化清单必须包含核对前值和填写后值。",422,"draft.afterValue");
  if(draft.baselineHash!==field.baseline.hash||stableHash(draft.beforeValue)!==stableHash(field.baseline.value))fail(session,`${subject.label} · ${field.label}的前值已变化，请重新读取清单；前值不能手工修改。`,409,"draft.beforeValue");
  if(isStateCategory(draft.category)&&(!field.baseline.known||field.baseline.stale))fail(session,`${subject.label} · ${field.label}没有可用的正式前值，请先建立或核对初始状态。`,409,"draft.beforeValue");
  const issue=validateFieldValue(field.field,draft.afterValue);
  if(issue)fail(session,`${subject.label} · ${field.label}：${issue}`,422,"draft.afterValue");
  const bindings=await validateDictionaryTreeBindings(client,[field.field]);
  const values=await validateDictionaryTreeValues(client,[field.field],{[field.key]:draft.afterValue});
  const treeIssue=bindings[field.key]??values[field.key];if(treeIssue)fail(session,`${subject.label} · ${field.label}：${treeIssue}`,422,"draft.afterValue");
  if(field.mode==="delta"){
    if(typeof field.baseline.value!=="number"||typeof draft.afterValue!=="number"||typeof draft.changeValue!=="number"||!Number.isFinite(draft.changeValue)||field.baseline.value+draft.changeValue!==draft.afterValue)
      fail(session,`${subject.label} · ${field.label}的变化量必须满足“前值 + 变化量 = 后值”。`,422,"draft.changeValue");
  }else if(draft.changeValue!==undefined&&draft.changeValue!==null)fail(session,`${field.label}采用直接填写后值，不接受变化量。`,422,"draft.changeValue");
  const expectedKind=field.field.type==="number"?"number":field.field.type==="boolean"?"boolean":field.field.type==="multi_select"?"json":"text";
  if(!isStateCategory(draft.category)&&draft.valueKind&&draft.valueKind!==expectedKind)fail(session,`${field.label}的值类型与正式字段不一致。`,422,"draft.valueKind");
  if(draft.objectCardId)fail(session,"该正式字段不是对象引用字段，请清除引用对象。",422,"draft.objectCardId");
  if(draft.category==="knowledge"){
    if(draft.holderKind==="character"){
      const holder=subjects.find(subject=>subject.id===draft.holderCardId&&subject.typeKey==="character"&&subject.subjectKind==="card");
      const published=holder?await client.query("SELECT 1 FROM new_design.cards card JOIN new_design.card_types type ON type.id=card.card_type_id WHERE card.id=$1 AND card.status='active' AND card.current_version_id IS NOT NULL AND type.status='published'",[holder.id]):null;
      if(!holder||!published?.rowCount)fail(session,"知识持有者必须是本书正式可用人物。",422,"draft.holderCardId");
    }else if(draft.holderCardId)fail(session,"读者知识不能指定人物持有者。",422,"draft.holderCardId");
  }
  const content=String((await client.query("SELECT content FROM new_design.chapter_body_versions WHERE id=$1 AND chapter_document_id=$2",[session.body_version_id,session.chapter_document_id])).rows[0]?.content??"");
  if(!Number.isInteger(draft.evidenceStart)||!Number.isInteger(draft.evidenceEnd)||draft.evidenceStart<0||draft.evidenceEnd<=draft.evidenceStart||draft.evidenceEnd>content.length||!content.slice(draft.evidenceStart,draft.evidenceEnd).trim())
    fail(session,`${subject.label} · ${field.label}的正文证据位置无效或仅包含空白。`,422,"draft.evidenceStart");
  const normalized={...draft,subjectId:subject.id,subjectKind:kind,beforeValue:field.baseline.value,valueKind:expectedKind as ChapterSettlementDraft["valueKind"],holderKey:draft.category==="knowledge"?(draft.holderKind==="character"?draft.holderCardId??undefined:"default"):draft.holderKey};
  return{draft:normalized,subject,field};
}
