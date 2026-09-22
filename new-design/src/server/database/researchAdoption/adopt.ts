import {createRecordCard,listRecordCards,requireRecordCard,replaceRecordCard} from '../recordCards';
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import type { BookResearchAdoptionBatch, FieldDefinition } from "../../../common/contracts";
import { NewDesignError, assertFound } from "../../domain/errors";
import { validateCardValues } from "../../domain/validation";
import { getNewDesignPool } from "../runtime";
import { stableHash } from "../aiContracts/integrity";
import { snapshotDictionaryTreeValues, validateDictionaryTreeBindings, validateDictionaryTreeValues } from "../treeResources";
import { getBookResearchAdoptionBatch } from "./store";

type Row = Record<string, unknown>;
const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

async function dictionarySources(client: PoolClient, fields: FieldDefinition[], spaceId: string): Promise<unknown[]> {
  const sources: unknown[] = [];
  for (const field of fields) {
    const source = field.optionSource;
    if (source?.kind !== "dictionary_tree") continue;
    const dictionary = await requireRecordCard(client,source.dictionaryId,'dictionary_definition','选项字典不存在。',{lock:true});
    if (dictionary.status === "archived" || dictionary.owner_space_id && String(dictionary.owner_space_id) !== spaceId) throw new NewDesignError("提案的选项字典不属于本书或公共资源，或已停用。", 422, {[field.key]: "请重新选择本书可用字典。"});
    const nodes:Record<string,any>[]=[];
    for(const item of (await listRecordCards(client,'dictionary_item',{where:{dictionary_id:source.dictionaryId},lock:true})).sort((a,b)=>a.id.localeCompare(b.id))){const version=await requireRecordCard(client,item.current_version_id,'dictionary_item_version','选项版本不存在。');nodes.push({...item,path_labels:version.path_labels});}
    sources.push({fieldKey:field.key,dictionaryId:dictionary.id,dictionaryName:dictionary.name,dictionaryRevision:Number(dictionary.revision),rule:source.rule,
      nodes:nodes.map(node => ({id:node.id,parentId:node.parent_id,status:node.status,revision:Number(node.revision),versionId:node.current_version_id,path:node.path_labels}))});
  }
  return sources;
}

export async function adoptBookResearchBatch(id: string, input: {bookId: string; expectedRevision: number; idempotencyKey: string; actor?: string}): Promise<BookResearchAdoptionBatch> {
  const pool = await getNewDesignPool(), client = await pool.connect();
  const requestHash = stableHash({bookId:input.bookId,expectedRevision:input.expectedRevision,actor:input.actor ?? "user"});
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
    const savedBatch=await requireRecordCard(client,id,'book_research_adoption_batch','研究采用预览不存在。',{lock:true});
    const book=assertFound((await client.query('SELECT space_id,status FROM new_design.books WHERE id=$1 FOR SHARE',[savedBatch.book_id])).rows[0],'书籍不存在。'),batch={...savedBatch,space_id:String(book.space_id),book_status:book.status};
    if(batch.book_id!==input.bookId)throw new NewDesignError('研究采用预览不属于当前书籍。',404);
    const repeated=(await listRecordCards(client,'book_research_adoption_event',{where:{batch_id:id,action:'adopt',idempotency_key:input.idempotencyKey}}))[0];
    if (repeated) {
      const priorHash = object(repeated.detail).requestHash;
      if (priorHash && priorHash !== requestHash) throw new NewDesignError("此请求标识已用于另一份采用请求。",409);
      await client.query("COMMIT");
      return getBookResearchAdoptionBatch(id,input.bookId);
    }
    if (batch.book_status !== "active") throw new NewDesignError("归档书籍不能采用研究提案。",422);
    if (batch.status !== "draft" || Number(batch.revision) !== input.expectedRevision) throw new NewDesignError("研究采用预览已变化，请复核后重试，当前填写内容保留。",409);
    const items:Row[]=[];
    for(const item of (await listRecordCards(client,'book_research_adoption_item',{where:{batch_id:id},lock:true})).sort((a,b)=>Number(a.sort_order)-Number(b.sort_order))){
      const candidate=await requireRecordCard(client,item.source_candidate_id,'research_candidate','原研究提案不存在。'),researchBatch=await requireRecordCard(client,candidate.batch_id,'research_candidate_batch','原研究批次不存在。');
      items.push({...item,candidate_batch_id:candidate.batch_id,candidate_revision:candidate.revision,research_version_id:researchBatch.research_version_id});
    }
    const selected = items.filter(item => item.decision === "adopt");
    if (!selected.length) throw new NewDesignError("请至少选择一条研究提案。",422);
    const adoptedItems: unknown[] = [];
    for (const item of selected) {
      if (item.target_card_id) throw new NewDesignError("此提案已有正式资料，请复核采用状态。",409);
      const type = assertFound((await client.query(`SELECT type.id,type.name,version.id version_id,version.fields FROM new_design.card_types type
        JOIN new_design.card_type_versions version ON version.id=type.current_version_id
        WHERE type.type_key=$1 AND type.status='published' AND (type.space_id=$2 OR type.space_id='00000000-0000-4000-8000-000000000001')
        ORDER BY CASE WHEN type.space_id=$2 THEN 0 ELSE 1 END LIMIT 1 FOR SHARE OF type`, [item.target_type_key,batch.space_id])).rows[0], "本书尚未安装此提案对应的内容类型，请到本书设置选择。");
      const fields = type.fields as FieldDefinition[], validated = validateCardValues(fields,object(item.values));
      if (Object.keys(validated.issues).length) throw new NewDesignError(`“${String(item.title)}”的填写与当前内容表单不兼容。`,422,validated.issues);
      const sources = await dictionarySources(client,fields,String(batch.space_id));
      const bindingIssues = await validateDictionaryTreeBindings(client,fields);
      const treeIssues = await validateDictionaryTreeValues(client,fields,validated.values);
      if (Object.keys(bindingIssues).length || Object.keys(treeIssues).length) throw new NewDesignError("请为研究提案选择允许范围内的启用选项。",422,{...bindingIssues,...treeIssues});
      const cardId=randomUUID(), versionId=randomUUID();
      await client.query(`INSERT INTO new_design.cards(id,space_id,card_type_id,title,status,revision,type_version_id,current_version_id,values)
        VALUES($1,$2,$3,$4,'active',1,$5,NULL,$6::jsonb)`, [cardId,batch.space_id,type.id,item.title,type.version_id,JSON.stringify(validated.values)]);
      await client.query("INSERT INTO new_design.card_versions(id,card_id,revision,type_version_id,title,values,source) VALUES($1,$2,1,$3,$4,$5::jsonb,'create')", [versionId,cardId,type.version_id,item.title,JSON.stringify(validated.values)]);
      await snapshotDictionaryTreeValues(client,fields,validated.values,versionId);
      await client.query("UPDATE new_design.cards SET current_version_id=$2 WHERE id=$1",[cardId,versionId]);
      for (const [key,value] of [["$title",item.title],...Object.entries(validated.values)] as Array<[string,unknown]>) {
        await createRecordCard(client,{spaceId:batch.space_id,typeKey:'card_field_origin',title:key,values:{card_id:cardId,field_key:key,source_kind:'research',source_id:item.research_version_id,confirmation_status:'confirmed',original_value:value,current_value:value}});
      }
      const currentItem=await requireRecordCard(client,String(item.id),'book_research_adoption_item','研究提案不存在。',{lock:true});
      await replaceRecordCard(client,{id:currentItem.id,spaceId:currentItem.recordSpaceId,typeKey:'book_research_adoption_item',values:{...currentItem,target_card_id:cardId,revision:currentItem.revision+1,updated_by:input.actor??'user',updated_at:new Date().toISOString()}});
      const snapshot={adoptionBatchId:id,sourceCandidateId:item.source_candidate_id,sourceCandidateRevision:Number(item.candidate_revision),itemRevision:Number(item.revision),
        researchVersionId:item.research_version_id,cardId,cardVersionId:versionId,typeVersionId:type.version_id,values:validated.values,title:item.title,dictionaries:sources};
      adoptedItems.push(snapshot);
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`research-reference:${batch.book_id}:${item.research_version_id}`]);
      if(!(await listRecordCards(client,'book_research_reference',{where:{book_id:batch.book_id,research_version_id:item.research_version_id}})).length)await createRecordCard(client,{spaceId:batch.space_id,typeKey:'book_research_reference',title:'本书研究采用',values:{book_id:batch.book_id,research_version_id:item.research_version_id,pack_version_id:null,purpose:'book_adoption',compiled_snapshot:snapshot}});
    }
    await replaceRecordCard(client,{id,spaceId:savedBatch.recordSpaceId,typeKey:'book_research_adoption_batch',values:{...savedBatch,status:'adopted',revision:savedBatch.revision+1,updated_at:new Date().toISOString()}});
    await createRecordCard(client,{spaceId:batch.space_id,typeKey:'book_research_adoption_event',title:'采用研究提案',values:{batch_id:id,action:'adopt',detail:{requestHash,adoptedCount:selected.length,rejectedCount:items.filter(item=>item.decision==='reject').length,adoptedItems},idempotency_key:input.idempotencyKey,actor:input.actor??'user'}});
    await client.query("COMMIT");
    return getBookResearchAdoptionBatch(id,input.bookId);
  } catch (error) {
    await client.query("ROLLBACK");
    if (["23505","40001","40P01"].includes(String((error as {code?:string}).code))) throw new NewDesignError("采用来源发生并发变化，请复核后重试，草稿保留。",409);
    throw error;
  } finally {client.release();}
}
