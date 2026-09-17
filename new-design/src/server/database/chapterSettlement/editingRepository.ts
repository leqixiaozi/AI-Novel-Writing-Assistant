import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import type { ChapterSettlementItem,ChapterSettlementDraft } from "../../../common/contracts";
import type { ChapterSettlementEditingWorkspace, SettlementEditingDraft, SettlementEditingReceipt, SettlementFieldChoice, SettlementItemEditingMetadata } from "../../../common/chapterSettlementEditing";
import { stableHash } from "../aiContracts/integrity";
import { getChapterSettlementWorkspace } from "./store";
import { readEditingCatalog } from "./editingCatalog";
import { readFrozenSupplementCatalog } from "./supplementRead";
import { displaySettlementValue, fail, type EditingRow } from "./editingPolicy";
import { NewDesignError } from "../../domain/errors";

export interface FrozenItemContract {
  editingKind:"contract";
  itemRevision:number;
  draft:SettlementEditingDraft;
  field:SettlementFieldChoice;
  domainHash:string;
  domainRevision:number;
  bodyVersionId:string;
}
export async function lockEditingSession(client:PoolClient,id:string):Promise<EditingRow>{
  const session=(await client.query("SELECT * FROM new_design.chapter_adoption_sessions WHERE id=$1 FOR UPDATE",[id])).rows[0];
  if(!session)fail(null,"章节结果确认会话不存在。",404);
  const document=(await client.query("SELECT * FROM new_design.chapter_documents WHERE id=$1 AND book_id=$2 FOR UPDATE",[session.chapter_document_id,session.book_id])).rows[0];
  if(!document)fail(session,"章节正文档案不存在。",404);
  const book=(await client.query("SELECT status FROM new_design.books WHERE id=$1",[session.book_id])).rows[0];
  if(!book||book.status!=="active"||document.status!=="active")fail(session,"本书或章节已归档，不能覆盖已有结果。",409,"sessionId");
  return{...session,adopted_version_id:document.adopted_version_id,logical_order:document.logical_order,document_revision:document.revision};
}
export function assertEditingSession(session:EditingRow,revision:number):void {
  if(session.adoption_kind==="resource_supplement")fail(session,"本章资源补充暂不可提交；请查看原结算和资源来源。原正文与确认记录保留。",503,"sessionId");
  if(Number(session.revision)!==revision)fail(session,"确认清单已被修改，请重新读取清单后核对当前输入。",409,"expectedSessionRevision");
  if(session.adopted_version_id!==session.body_version_id)fail(session,"本章采用正文已切换，当前清单不能覆盖新正文；请重新进入本章结果确认。",409,"bodyVersionId");
  if(!["adopted_pending_proposals","pending_review","partially_confirmed","failed"].includes(String(session.status)))fail(session,"本章结果已稳定或正在处理，不能覆盖；请重新读取已保存结果。",409,"sessionId");
}
export async function readDomain(client:PoolClient,session:EditingRow,item:EditingRow,lock=false):Promise<{hash:string;revision:number;data:EditingRow;status:string}>{
  const suffix=lock?" FOR UPDATE":"";let data:EditingRow;
  if(item.canonical_fact_id){
    const row=(await client.query("SELECT * FROM new_design.canonical_facts WHERE id=$1"+suffix,[item.canonical_fact_id])).rows[0];
    if(!row||row.book_id!==session.book_id)fail(session,"事实提案不属于本章书籍。",409,"itemId");
    data={fact:row};
  }else if(item.state_proposal_id){
    const row=(await client.query("SELECT * FROM new_design.state_change_proposals WHERE id=$1"+suffix,[item.state_proposal_id])).rows[0];
    if(!row||row.book_id!==session.book_id||row.chapter_document_id!==session.chapter_document_id||row.body_version_id!==session.body_version_id||row.text_anchor_id!==item.evidence_anchor_id)
      fail(session,"状态提案的正文来源与本章确认清单不一致。",409,"itemId");
    data={state:row};
  }else if(item.knowledge_proposal_id){
    const row=(await client.query("SELECT * FROM new_design.knowledge_state_proposals WHERE id=$1"+suffix,[item.knowledge_proposal_id])).rows[0];
    if(!row||row.book_id!==session.book_id)fail(session,"知识提案不属于本章书籍。",409,"itemId");
    const version=(await client.query("SELECT * FROM new_design.knowledge_state_proposal_versions WHERE id=$1 AND proposal_id=$2",[row.current_version_id,row.id])).rows[0];
    const claim=(await client.query("SELECT * FROM new_design.epistemic_claims WHERE id=$1",[row.claim_id])).rows[0];
    if(!version||version.chapter_document_id!==session.chapter_document_id||version.body_version_id!==session.body_version_id||version.text_anchor_id!==item.evidence_anchor_id||!claim||claim.book_id!==session.book_id)
      fail(session,"知识提案的当前版本或正文证据与本章清单不一致。",409,"itemId");
    data={knowledge:row,version,claim};
  }else fail(session,"变化清单缺少正式领域提案。",409,"itemId");
  const anchor=(await client.query("SELECT * FROM new_design.chapter_text_anchors WHERE id=$1",[item.evidence_anchor_id])).rows[0];
  if(!anchor||anchor.book_id!==session.book_id||anchor.chapter_document_id!==session.chapter_document_id||anchor.body_version_id!==session.body_version_id||anchor.status!=="active")
    fail(session,"变化提案的正文证据已失效，请重新选择本章证据。",409,"evidenceStart");
  if(item.canonical_fact_id&&!Boolean((await client.query("SELECT 1 FROM new_design.canonical_fact_evidence WHERE fact_id=$1 AND chapter_text_anchor_id=$2 AND stale_at IS NULL",[item.canonical_fact_id,item.evidence_anchor_id])).rowCount))fail(session,"事实提案缺少本章有效证据。",409,"evidenceStart");
  const record=(data.fact??data.state??data.knowledge) as EditingRow;
  // Date objects are normalized before hashing so persisted JSON and live PG rows agree.
  const normalized=JSON.parse(JSON.stringify({...data,anchor})) as EditingRow;
  return{hash:stableHash(normalized),revision:Number(record.revision),data,status:String(record.status)};
}
export async function frozenItemContract(client:PoolClient,sessionId:string,itemId:string):Promise<FrozenItemContract|null>{
  const row=(await client.query("SELECT detail FROM new_design.chapter_settlement_events WHERE session_id=$1 AND item_id=$2 AND detail->>'editingKind'='contract' ORDER BY (detail->>'itemRevision')::int DESC,created_at DESC LIMIT 1",[sessionId,itemId])).rows[0];
  return row?(row.detail as FrozenItemContract):null;
}
export async function freezeEditingItem(client:PoolClient,session:EditingRow,itemId:string,draft:SettlementEditingDraft,field:SettlementFieldChoice,actor:string):Promise<void>{
  const item=(await client.query("SELECT * FROM new_design.chapter_settlement_items WHERE id=$1 AND session_id=$2 FOR UPDATE",[itemId,session.id])).rows[0];
  if(!item)fail(session,"保存的变化提案不属于当前清单。",409);
  const domain=await readDomain(client,session,item,true);
  const contract:FrozenItemContract={editingKind:"contract",itemRevision:Number(item.revision),draft,field,domainHash:domain.hash,domainRevision:domain.revision,bodyVersionId:String(session.body_version_id)};
  await client.query("INSERT INTO new_design.chapter_settlement_events(id,session_id,event_kind,to_status,item_id,actor,detail) VALUES($1,$2,'proposal_edited',$3,$4,$5,$6::jsonb)",[randomUUID(),session.id,session.status,itemId,actor,JSON.stringify(contract)]);
}
async function itemMetadata(client:PoolClient,session:EditingRow,item:ChapterSettlementItem,catalog:ChapterSettlementEditingWorkspace["catalog"]):Promise<SettlementItemEditingMetadata>{
  const contract=await frozenItemContract(client,String(session.id),item.id),field=catalog.subjects.find(subject=>subject.id===item.subjectId&&subject.subjectKind===item.subjectKind)?.fields.find(field=>field.key===item.stateKey);
  let reason=contract?null:"历史提案没有冻结的正式编辑规格，可拒绝保留记录，不能直接覆盖或确认。";
  let domainRevision:number|null=null;let knowledge:SettlementItemEditingMetadata["knowledge"];
  try{
    const raw=(await client.query("SELECT * FROM new_design.chapter_settlement_items WHERE id=$1",[item.id])).rows[0],domain=await readDomain(client,session,raw);
    domainRevision=domain.revision;
    if(domain.data.knowledge){const row=domain.data.knowledge as EditingRow,version=domain.data.version as EditingRow;knowledge={holderKind:row.holder_kind as "character"|"reader",holderCardId:row.holder_card_id?String(row.holder_card_id):null,holderKey:String(row.holder_key),stance:version.stance as ChapterSettlementDraft["stance"],acquisitionMethod:version.acquisition_method as ChapterSettlementDraft["acquisitionMethod"]};}
    if(contract&&domain.hash!==contract.domainHash)reason="领域提案已在其他页面修改或处理，请重新核对，不能覆盖。";
  }catch(error){if(!(error instanceof NewDesignError))throw error;reason=error.message;}
  if(contract&&field?.specificationHash!==contract.field.specificationHash)reason="正式字段或关系规格已变化，请重新补充提案。";
  if(contract&&field?.baseline.hash!==contract.field.baseline.hash)reason="前值来源已变化，请重新读取并编辑核对。";
  if(item.decision!=="pending")reason="已记录确认决定；编辑前请重新补充待核对提案。";
  if(!["adopted_pending_proposals","pending_review","partially_confirmed","failed"].includes(String(session.status)))reason="本章结果已稳定或正在处理，不能覆盖。";
  const historical=contract?.field??field;
  return{itemId:item.id,editable:!reason,unavailableReason:reason,specificationHash:contract?.field.specificationHash??null,fieldLabel:historical?.label??"历史字段需核对",beforeDisplay:historical?displaySettlementValue(historical.field,item.beforeValue,historical.dictionaryNodes):"历史值需核对",afterDisplay:historical?displaySettlementValue(historical.field,item.afterValue,historical.dictionaryNodes):"历史值需核对",baseline:field?.baseline??null,domainRevision,knowledge};
}
export async function readEditingWorkspace(client:PoolClient,sessionId:string):Promise<ChapterSettlementEditingWorkspace>{
  const base=await getChapterSettlementWorkspace(sessionId),session=(await client.query("SELECT * FROM new_design.chapter_adoption_sessions WHERE id=$1",[sessionId])).rows[0];
  const catalog=session.adoption_kind==="resource_supplement"?await readFrozenSupplementCatalog(client,session,base.candidate.contentHash):await readEditingCatalog(client,session);
  const itemSpecifications:SettlementItemEditingMetadata[]=[];
  for(const item of base.items)itemSpecifications.push(await itemMetadata(client,session,item,catalog));
  if(!base.candidate.isAdopted)for(const metadata of itemSpecifications){metadata.editable=false;metadata.unavailableReason="本章采用正文已切换，旧清单仅供核对；请重新进入当前正文的结果确认。";}
  return{...base,catalog,itemSpecifications,blockedReason:session.adoption_kind==="resource_supplement"?"本章资源补充暂不可提交；请查看原结算和资源来源。原正文与确认记录保留。":session.status==="impact_review_required"?"候选正文需要先核对切换影响；当前会话仅供查看，不能提交变化。":!base.candidate.isAdopted?"本章采用正文已切换，旧清单不能覆盖当前正文；请回到当前正文重新准备结果确认。":null,aiCapability:{configured:false,taskKey:null,taskContractVersionId:null,message:"正文变化提取需专属受控执行能力；正式清单可手工填写并核对。"},aiDisabled:{reason:"正文变化提取尚未接入专属受控执行链。",sourceRoute:"/new-design/structure/models",actionLabel:"打开模型设置"}};
}
export async function receiptByKey(client:PoolClient,sessionId:string,key:string):Promise<{inputHash:string;receipt:SettlementEditingReceipt}|null>{
  const row=(await client.query("SELECT editing_input_hash,editing_receipt FROM new_design.chapter_settlement_events WHERE session_id=$1 AND editing_request_key=$2",[sessionId,key])).rows[0];
  return row?{inputHash:String(row.editing_input_hash),receipt:row.editing_receipt as SettlementEditingReceipt}:null;
}
export async function appendEditingReceipt(client:PoolClient,session:EditingRow,key:string,hash:string,receipt:SettlementEditingReceipt,actor:string):Promise<void>{
  await client.query("INSERT INTO new_design.chapter_settlement_events(id,session_id,event_kind,to_status,actor,detail,editing_request_key,editing_input_hash,editing_receipt) VALUES($1,$2,'decision_recorded',$3,$4,$5::jsonb,$6,$7,$8::jsonb)",[randomUUID(),session.id,receipt.workspace.session.status,actor,JSON.stringify({editingKind:"receipt",operation:receipt.operation}),key,hash,JSON.stringify(receipt)]);
}
