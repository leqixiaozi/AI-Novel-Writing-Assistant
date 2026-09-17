import {createHash} from 'node:crypto';
import type {PoolClient} from 'pg';
import {NewDesignError,assertFound} from '../../domain/errors';
import {stableHash} from '../aiContracts';

export interface ChapterContinuitySource {
  type:'canonical_fact'|'state_change'|'knowledge_state_change'|'card_relation'|'body_version'|'entity_initial_state';
  stableId:string;
  versionId:string;
  hash:string;
  content:Record<string,unknown>;
}
export interface ChapterContinuitySources {sources:ChapterContinuitySource[];notes:string[];}
type Row=Record<string,unknown>;
const CLASS_LIMIT=300;
const TOTAL_LIMIT=1500;
const sha=(text:string)=>createHash('sha256').update(text,'utf8').digest('hex');
function record(value:unknown,label:string):Row {
  if(!value||typeof value!=='object'||Array.isArray(value))throw new NewDesignError(`${label}的精确来源未读取到，请核对原章节与结算记录。`,409);
  return value as Row;
}
function identity(value:unknown,label:string):string {
  if(typeof value!=='string'||!value)throw new NewDesignError(`${label}缺少真实版本标识，不能代用对象标识生成。`,409);
  return value;
}
function bounded(rows:Row[],label:string):Row[] {
  if(rows.length>CLASS_LIMIT)throw new NewDesignError(`${label}超过完整冻结上限 ${CLASS_LIMIT} 项；请先明确连续性适用范围，不能遗漏后生成。`,422);
  return rows;
}

/** Read inside the caller's already-open, repeatable-read transaction. No pool, writes,
 * projection-value fallback, older-chapter fallback, or inferred semantic field keys. */
export async function readChapterContinuitySources(client:PoolClient,bookId:string,chapterCardId:string):Promise<ChapterContinuitySources> {
  const target=assertFound((await client.query<Row>(`SELECT document.id,document.logical_order,book.space_id
    FROM new_design.chapter_documents document JOIN new_design.books book ON book.id=document.book_id AND book.status='active'
    JOIN new_design.cards card ON card.id=document.chapter_card_id AND card.space_id=book.space_id AND card.status='active'
    WHERE document.book_id=$1 AND document.chapter_card_id=$2 AND document.status='active'`,[bookId,chapterCardId])).rows[0],
    '目标章的本书正式档案不可用，请返回章节创作核对。');
  const spaceId=identity(target.space_id,'本书空间'),sources:ChapterContinuitySource[]=[],notes:string[]=[];
  const cards=new Map<string,Row>();
  const bodies=new Map<string,Row>();
  const relations=new Map<string,Row>();
  const add=(type:ChapterContinuitySource['type'],stableId:unknown,versionId:unknown,sourceHash:string,content:Row)=>{
    if(sources.length>=TOTAL_LIMIT)throw new NewDesignError(`连续性真实来源超过完整冻结上限 ${TOTAL_LIMIT} 项；本次未准备模型请求，请先明确适用范围。`,422);
    sources.push({type,stableId:identity(stableId,'连续性对象'),versionId:identity(versionId,'连续性版本'),hash:sourceHash,content:{...content,metadataHash:stableHash(content)}});
  };
  async function sourceHash(type:ChapterContinuitySource['type'],stableId:unknown,versionId:unknown):Promise<string> {
    // Reuse the SAME formal source resolver. In particular, state/knowledge and relation
    // versions use PostgreSQL dependency_content_hash, not a JS serialization hash.
    const kind=type==='body_version'?'chapter_body_version':type;
    const rows=(await client.query<Row>('SELECT * FROM new_design.resolve_dependency_resource($1,$2::uuid,$3::uuid)',[kind,identity(stableId,'正式来源对象'),identity(versionId,'正式来源版本')])).rows;
    if(rows.length!==1||rows[0].resolved_book_id!==bookId||rows[0].resolved_space_id!==spaceId||typeof rows[0].resolved_hash!=='string'||!/^[a-f0-9]{64}$/.test(rows[0].resolved_hash))throw new NewDesignError('连续性精确版本的正式来源哈希或本书范围未核实，请打开运行维护核对版本账本。',409);
    return rows[0].resolved_hash;
  }
  const note=(text:string)=>{if(!notes.includes(text)){if(notes.length>=100)throw new NewDesignError('连续性来源待核对说明超过完整冻结范围，请先处理原来源问题。',422);notes.push(text);}};
  async function card(id:unknown):Promise<Row> {
    const key=identity(id,'资料对象');if(cards.has(key))return cards.get(key)!;
    const row=assertFound((await client.query<Row>(`SELECT card.id,card.title,card.current_version_id,version.title version_title,
      version.values,version.type_version_id,version.revision,type.name type_name
      FROM new_design.cards card JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id
      JOIN new_design.card_types type ON type.id=card.card_type_id AND type.status='published'
      WHERE card.id=$1 AND card.space_id=$2 AND card.status='active'`,[key,spaceId])).rows[0],
      '连续性来源关联的本书正式资料或精确版本不可用，请返回资料维护核对。');
    identity(row.current_version_id,'资料当前版本');cards.set(key,row);return row;
  }
  async function relation(id:unknown):Promise<Row> {
    const key=identity(id,'关系对象');if(relations.has(key))return relations.get(key)!;
    const row=assertFound((await client.query<Row>(`SELECT to_jsonb(relation) relation,to_jsonb(version) version,
      to_jsonb(type) specification FROM new_design.card_relations relation
      JOIN new_design.card_relation_versions version ON version.id=relation.current_version_id AND version.card_relation_id=relation.id
      JOIN new_design.relation_types type ON type.id=relation.relation_type_id AND type.status='published'
        AND (type.owner_space_id IS NULL OR type.owner_space_id=relation.space_id)
      WHERE relation.id=$1 AND relation.space_id=$2 AND relation.status='active' AND version.status='active'`,[key,spaceId])).rows[0],
      '连续性关系缺少正式规格或真实当前版本，请打开本书关系配置明确重绑并核对。');
    const entity=record(row.relation,'关系'),version=record(row.version,'关系版本');
    if(Number(entity.revision)!==Number(version.revision)||stableHash(entity.properties)!==stableHash(version.properties))throw new NewDesignError('关系当前值与不可变版本账本不一致，请打开本书关系配置核对。',409);
    const source=await card(entity.source_card_id),destination=await card(entity.target_card_id);
    for(const [versionId,cardId] of [[version.source_card_version_id,entity.source_card_id],[version.target_card_version_id,entity.target_card_id]]) {
      if(!(await client.query('SELECT id FROM new_design.card_versions WHERE id=$1 AND card_id=$2',[versionId,cardId])).rowCount)throw new NewDesignError('关系端点的精确历史资料版本不匹配，不能以当前资料替代。',409);
    }
    const full={relation:entity,version,specification:row.specification,source,destination};relations.set(key,full);return full;
  }
  async function subject(kind:unknown,id:unknown):Promise<Row> {
    if(kind==='card')return card(id);if(kind==='relation')return relation(id);
    throw new NewDesignError('连续性来源包含不支持的正式对象类型，请核对原结算。',409);
  }
  async function body(id:unknown,documentId:unknown):Promise<Row> {
    const key=identity(id,'采用正文');if(bodies.has(key)){const prior=bodies.get(key)!;if(prior.chapter_document_id!==documentId)throw new NewDesignError('正文来源跨章节不一致。',409);return prior;}
    const row=assertFound((await client.query<Row>(`SELECT body.id,body.chapter_document_id,body.version,body.content,body.content_hash,
      document.logical_order,document.title,document.revision document_revision,checkpoint.id checkpoint_id,
      checkpoint.session_id,checkpoint.settlement_id,checkpoint.dependency_hash,checkpoint.summary confirmed_summary,session.context_manifest_id
      FROM new_design.chapter_body_versions body JOIN new_design.chapter_documents document ON document.id=body.chapter_document_id
        AND document.book_id=$1 AND document.status='active' AND document.adopted_version_id=body.id
      JOIN new_design.chapter_stable_checkpoints checkpoint ON checkpoint.book_id=document.book_id
        AND checkpoint.chapter_document_id=document.id AND checkpoint.body_version_id=body.id AND checkpoint.status='stable'
      JOIN new_design.chapter_adoption_sessions session ON session.id=checkpoint.session_id AND session.book_id=document.book_id
        AND session.chapter_document_id=document.id AND session.body_version_id=body.id AND session.settlement_id=checkpoint.settlement_id AND session.status='stable'
      JOIN new_design.chapter_settlements settlement ON settlement.id=checkpoint.settlement_id AND settlement.book_id=document.book_id
        AND settlement.chapter_document_id=document.id AND settlement.body_version_id=body.id AND settlement.status='committed'
      WHERE body.id=$2 AND body.chapter_document_id=$3 AND body.archived_at IS NULL`,[bookId,key,documentId])).rows[0],
      '连续性来源的原正文未稳定、已切版或结算失效，请回原章节审阅与结算恢复；不会改用旧正文。');
    if(Number(row.logical_order)>=Number(target.logical_order))throw new NewDesignError('当前连续性源来自目标章或后续章节，不能把后章结算当作此前状态；请先核对正文切版和结算影响。',409);
    if(typeof row.content!=='string'||sha(row.content)!==row.content_hash)throw new NewDesignError('连续性原正文哈希与完整内容不一致，请打开运行维护核对原来源。',409);
    bodies.set(key,row);return row;
  }
  async function anchor(id:unknown,expectedBody?:unknown):Promise<Row> {
    const row=assertFound((await client.query<Row>('SELECT * FROM new_design.chapter_text_anchors WHERE id=$1 AND book_id=$2 AND status=\'active\'',[identity(id,'文本证据'),bookId])).rows[0],'连续性文本证据已失效，请回原章节核对。');
    if(expectedBody!==undefined&&row.body_version_id!==expectedBody)throw new NewDesignError('连续性文本证据与结算正文版本不同。',409);
    const original=await body(row.body_version_id,row.chapter_document_id),text=String(original.content),start=Number(row.start_offset),end=Number(row.end_offset);
    if(!Number.isInteger(start)||!Number.isInteger(end)||start<0||end<=start||end>text.length||text.slice(start,end)!==row.excerpt||sha(String(row.excerpt))!==row.fragment_hash)throw new NewDesignError('连续性证据的片段、范围或哈希不一致，请回原章节重新核对证据。',409);
    if(row.subject_card_id)await card(row.subject_card_id);
    return {...row,bodyContentHash:original.content_hash,stableCheckpointId:original.checkpoint_id};
  }

  const facts=bounded((await client.query<Row>('SELECT * FROM new_design.canonical_facts WHERE book_id=$1 AND status=\'confirmed\' ORDER BY id LIMIT 301',[bookId])).rows,'已确认事实');
  for(const fact of facts) {
    const owner=await card(fact.subject_card_id),object=fact.object_card_id?await card(fact.object_card_id):null;
    const evidence=bounded((await client.query<Row>('SELECT * FROM new_design.canonical_fact_evidence WHERE fact_id=$1 ORDER BY id LIMIT 301',[fact.id])).rows,'单条事实证据');
    const verified:Row[]=[];
    for(const entry of evidence) {
      if(entry.stale_at)throw new NewDesignError('已确认事实仍关联失效证据，请回原章节或事实审阅核对后再生成。',409);
      if(entry.chapter_text_anchor_id)verified.push({...entry,source:await anchor(entry.chapter_text_anchor_id)});
      else if(entry.card_version_id) {
        const source=assertFound((await client.query<Row>(`SELECT version.id,version.card_id,version.title,version.values,version.type_version_id
          FROM new_design.card_versions version JOIN new_design.cards card ON card.id=version.card_id AND card.space_id=$2 AND card.status='active'
          WHERE version.id=$1`,[entry.card_version_id,spaceId])).rows[0],'事实的本书精确资料证据不可用。');
        verified.push({...entry,source});
      } else if(entry.research_evidence_id) {
        const source=assertFound((await client.query<Row>(`SELECT evidence.*,version.run_hash,version.source_scope,record.title record_title,
          document.content_hash document_content_hash,document.id document_version_id
          FROM new_design.research_evidence evidence JOIN new_design.research_record_versions version ON version.id=evidence.research_version_id AND version.run_status='completed'
          JOIN new_design.research_records record ON record.id=version.record_id AND record.status='active'
          LEFT JOIN new_design.research_document_versions document ON document.id=evidence.source_document_version_id
          LEFT JOIN new_design.research_documents source_document ON source_document.id=document.document_id
          WHERE evidence.id=$1 AND (evidence.source_document_version_id IS NULL OR source_document.status='active')`,[entry.research_evidence_id])).rows[0],'已确认事实的精确研究证据不可用，请核对原研究来源。');
        verified.push({...entry,source});
      } else throw new NewDesignError('事实证据缺少真实来源标识。',409);
    }
    if(fact.source_method==='ai_extract'&&!verified.some(entry=>record(entry.source,'事实证据').body_version_id))throw new NewDesignError('AI 提取的已确认事实缺少有效原正文证据，不能作为正式连续性依据。',409);
    if(!verified.length)note('部分事实由作者直接确认，未关联正文证据；仍按作者确认来源展示，不冒充章节结算。');
    const conflicts=bounded((await client.query<Row>('SELECT * FROM new_design.canonical_fact_conflicts WHERE book_id=$1 AND status=\'open\' AND (fact_a_id=$2 OR fact_b_id=$2) ORDER BY id LIMIT 301',[bookId,fact.id])).rows,'事实冲突');
    if(conflicts.length)note('已确认事实存在尚未处理的正式冲突；原冲突与双方来源已保留，生成不能当作冲突已解决。');
    add('canonical_fact',fact.id,fact.id,await sourceHash('canonical_fact',fact.id,fact.id),{fact,subject:owner,object,evidence:verified,conflicts});
  }

  // A projection selects the currently effective source only. Its cached value is never
  // exported as a fact, and every selected source is checked against the original ledger.
  const projections=bounded((await client.query<Row>('SELECT * FROM new_design.current_state_projections WHERE book_id=$1 ORDER BY subject_kind,subject_id,state_key LIMIT 301',[bookId])).rows,'当前状态');
  for(const projection of projections) {
    if(projection.is_stale)throw new NewDesignError('当前状态的原来源已失效，请回原章节审阅与结算核对，不能使用缓存状态生成。',409);
    const owner=await subject(projection.subject_kind,projection.subject_id);
    if(projection.source_initial_version_id) {
      const row=assertFound((await client.query<Row>(`SELECT to_jsonb(initial) initial,to_jsonb(version) version FROM new_design.entity_initial_states initial
        JOIN new_design.entity_initial_state_versions version ON version.id=initial.current_version_id AND version.initial_state_id=initial.id
        WHERE initial.book_id=$1 AND initial.subject_kind=$2 AND initial.subject_id=$3 AND initial.state_key=$4 AND version.id=$5`,[bookId,projection.subject_kind,projection.subject_id,projection.state_key,projection.source_initial_version_id])).rows[0],'当前初始状态的精确版本已变化，请核对初始状态来源。');
      const initial=record(row.initial,'初始状态'),version=record(row.version,'初始状态版本');
      if(stableHash(version.value_json)!==stableHash(projection.value_json))throw new NewDesignError('初始状态投影与精确源值不一致，请核对初始状态。',409);
      let sourceFact:Row|null=null;
      if(version.source_fact_id)sourceFact=assertFound((await client.query<Row>('SELECT * FROM new_design.canonical_facts WHERE id=$1 AND book_id=$2 AND status=\'confirmed\'',[version.source_fact_id,bookId])).rows[0],'初始状态关联事实不再正式确认。');
      add('entity_initial_state',initial.id,version.id,await sourceHash('entity_initial_state',initial.id,version.id),{initial,version,subject:owner,sourceFact,projectionRevision:projection.projection_revision,meaning:'作者明确建立的初始状态，不是章节已结算事实'});
    } else {
      const row=assertFound((await client.query<Row>(`SELECT to_jsonb(change) change,to_jsonb(proposal) proposal FROM new_design.state_changes change
        JOIN new_design.state_change_proposals proposal ON proposal.id=change.proposal_id AND proposal.book_id=change.book_id
          AND proposal.status='confirmed' AND proposal.confirmed_state_change_id=change.id
        JOIN new_design.chapter_settlements settlement ON settlement.id=change.settlement_id AND settlement.book_id=change.book_id
          AND settlement.chapter_document_id=change.chapter_document_id AND settlement.body_version_id=change.body_version_id AND settlement.status='committed'
        WHERE change.id=$1 AND change.book_id=$2 AND change.status='active' AND change.subject_kind=$3 AND change.subject_id=$4 AND change.state_key=$5`,[projection.source_state_change_id,bookId,projection.subject_kind,projection.subject_id,projection.state_key])).rows[0],'当前状态的正式确认提案或已提交结算不匹配，请回原章节核对。');
      const change=record(row.change,'状态流水'),proposal=record(row.proposal,'状态提案'),original=await body(change.body_version_id,change.chapter_document_id);
      const confirmation=record(original.confirmed_summary,'稳定章确认清单'),stateIds=record(confirmation.confirmed,'稳定章确认来源').states;
      if(!Array.isArray(stateIds)||!stateIds.includes(change.id)||new Set(stateIds).size!==stateIds.length||stableHash(change.after_json)!==stableHash(projection.value_json)||proposal.chapter_document_id!==change.chapter_document_id||proposal.body_version_id!==change.body_version_id||proposal.subject_kind!==change.subject_kind||proposal.subject_id!==change.subject_id||proposal.state_key!==change.state_key||stableHash(proposal.after_json)!==stableHash(change.after_json))throw new NewDesignError('当前状态与原确认提案、稳定结算或精确源值不一致，请回原章节核对。',409);
      const evidence=change.text_anchor_id?await anchor(change.text_anchor_id,change.body_version_id):null;
      const causeEvent=change.cause_event_card_id?await card(change.cause_event_card_id):null;
      add('state_change',change.id,change.id,await sourceHash('state_change',change.id,change.id),{change,proposal,subject:owner,evidence,causeEvent,bodyContentHash:original.content_hash,stableCheckpointId:original.checkpoint_id,projectionRevision:projection.projection_revision});
    }
  }

  const knowledge=bounded((await client.query<Row>('SELECT * FROM new_design.current_knowledge_state_projections WHERE book_id=$1 ORDER BY holder_kind,holder_key,claim_id LIMIT 301',[bookId])).rows,'当前人物与读者认知');
  for(const projection of knowledge) {
    const row=assertFound((await client.query<Row>(`SELECT to_jsonb(change) change,to_jsonb(proposal) proposal,to_jsonb(version) version,to_jsonb(claim) claim
      FROM new_design.knowledge_state_changes change JOIN new_design.knowledge_state_proposals proposal ON proposal.id=change.proposal_id
        AND proposal.book_id=change.book_id AND proposal.status='confirmed' AND proposal.confirmed_change_id=change.id AND proposal.current_version_id=change.proposal_version_id
      JOIN new_design.knowledge_state_proposal_versions version ON version.id=change.proposal_version_id AND version.proposal_id=proposal.id
      JOIN new_design.epistemic_claims claim ON claim.id=change.claim_id AND claim.book_id=change.book_id
      WHERE change.id=$1 AND change.book_id=$2 AND change.status='active' AND change.claim_id=$3 AND change.holder_kind=$4 AND change.holder_key=$5`,[projection.source_change_id,bookId,projection.claim_id,projection.holder_kind,projection.holder_key])).rows[0],'当前认知的原提案、确认版本或流水已失效，请回原章节认知审阅核对。');
    const change=record(row.change,'认知流水'),proposal=record(row.proposal,'认知提案'),version=record(row.version,'认知版本'),claim=record(row.claim,'认知内容');
    if(change.stance!==projection.stance||change.holder_card_id!==projection.holder_card_id||stableHash(change.confidence)!==stableHash(projection.confidence)||change.stance!==version.stance||stableHash(change.confidence)!==stableHash(version.confidence)||proposal.claim_id!==change.claim_id||proposal.holder_kind!==change.holder_kind||proposal.holder_key!==change.holder_key||proposal.holder_card_id!==change.holder_card_id)throw new NewDesignError('当前认知与真实确认源值不一致，请核对认知来源。',409);
    const holder=change.holder_kind==='character'?await card(change.holder_card_id):null;
    const owner=claim.subject_card_id?await card(claim.subject_card_id):null,object=claim.object_card_id?await card(claim.object_card_id):null;
    const original=version.body_version_id?await body(version.body_version_id,version.chapter_document_id):null;
    const evidence=version.text_anchor_id?await anchor(version.text_anchor_id,version.body_version_id):null;
    if(proposal.source==='ai'&&(!original||!evidence))throw new NewDesignError('AI 认知提案缺少有效原正文与文本证据，请回原章节审阅核对。',409);
    if(!original)note('部分认知由作者人工确认，未关联正文；人物相信或怀疑的内容不因此成为客观事实。');
    const truth=claim.truth_fact_id?(await client.query<Row>('SELECT id,status,value_hash,revision FROM new_design.canonical_facts WHERE id=$1 AND book_id=$2',[claim.truth_fact_id,bookId])).rows[0]??null:null;
    if(claim.truth_fact_id&&!truth)throw new NewDesignError('认知关联的客观事实不属于本书或不可用。',409);
    const sourceCharacter=version.source_character_card_id?await card(version.source_character_card_id):null,sourceEvent=version.source_event_card_id?await card(version.source_event_card_id):null;
    add('knowledge_state_change',proposal.id,change.id,await sourceHash('knowledge_state_change',proposal.id,change.id),{change,proposal,version,claim,holder,subject:owner,object,truth,evidence,sourceCharacter,sourceEvent,bodyContentHash:original?.content_hash??null,stableCheckpointId:original?.checkpoint_id??null,projectionRevision:projection.projection_revision,meaning:'已确认人物／读者认知，不能当作客观真相'});
  }

  const relationRows=bounded((await client.query<Row>('SELECT id FROM new_design.card_relations WHERE space_id=$1 AND status=\'active\' ORDER BY id LIMIT 301',[spaceId])).rows,'本书正式关系');
  for(const entity of relationRows){const full=await relation(entity.id),versionId=record(full.version,'关系版本').id;add('card_relation',entity.id,versionId,await sourceHash('card_relation',entity.id,versionId),full);}

  const prior=(await client.query<Row>('SELECT id,title,adopted_version_id,logical_order FROM new_design.chapter_documents WHERE book_id=$1 AND status=\'active\' AND logical_order<$2 ORDER BY logical_order DESC,id LIMIT 1',[bookId,target.logical_order])).rows[0];
  if(!prior)note('这是本书当前排序的第一章，没有前章正文，不补造前章。');
  else if(!prior.adopted_version_id)note(`紧邻前章「${String(prior.title)}」尚无采用正文；没有改用更早章补齐。`);
  else {
    const stable=(await client.query<Row>(`SELECT checkpoint.id FROM new_design.chapter_stable_checkpoints checkpoint
      WHERE checkpoint.book_id=$1 AND checkpoint.chapter_document_id=$2 AND checkpoint.body_version_id=$3 AND checkpoint.status='stable'`,[bookId,prior.id,prior.adopted_version_id])).rows[0];
    if(!stable)note(`紧邻前章「${String(prior.title)}」尚未稳定结算；没有改用较旧正文或更早章补齐。`);
    else {const original=await body(prior.adopted_version_id,prior.id);add('body_version',prior.id,original.id,await sourceHash('body_version',prior.id,original.id),{...original,meaning:'当前排序紧邻前章的真实稳定采用正文'});}
  }
  return {sources,notes};
}
