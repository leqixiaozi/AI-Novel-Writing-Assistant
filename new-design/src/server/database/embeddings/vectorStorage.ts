import type {PoolClient} from 'pg';
import {NewDesignError,assertFound} from '../../domain/errors';
import {requireRecordCard} from '../recordCards';
import {stableHash} from '../aiContracts/integrity';

/** Model vectors stay in the vector store; card versions contain only immutable receipt metadata. */
export async function saveEmbeddingVector(client:PoolClient,input:{kind:'attempt'|'result';id:string;requestId:string;attemptId:string;chunkId:string;vector:number[]}){
 const request=await requireRecordCard(client,input.requestId,'embedding_request','原嵌入请求不存在。');
 const chunk=assertFound((await client.query("SELECT * FROM new_design.embedding_chunks WHERE id=$1 AND record_kind='chunk'",[input.chunkId])).rows[0],'原分块不存在。');
 const source=await requireRecordCard(client,String(chunk.source_snapshot_id),'embedding_source_snapshot','原来源快照不存在。');
 const profile=await requireRecordCard(client,String(chunk.profile_version_id),'embedding_profile_version','原嵌入规格不存在。');
 const attempt=await requireRecordCard(client,input.attemptId,'embedding_attempt','原嵌入尝试不存在。');
 if(attempt.request_id!==input.requestId)throw new NewDesignError('原尝试不属于此请求。',409);
 if(request.chunk_id!==chunk.id||request.book_id!==chunk.book_id||request.profile_version_id!==chunk.profile_version_id||source.book_id!==chunk.book_id||source.profile_version_id!==chunk.profile_version_id||input.vector.length!==Number(profile.dimensions)||input.vector.some(value=>!Number.isFinite(value)))throw new NewDesignError('原向量不符合冻结分块、书籍或维度。',409);
 if(input.kind==='result'){const result=await requireRecordCard(client,input.id,'embedding_result','原向量结果不存在。');if(result.outcome!=='applied'||result.request_id!==input.requestId||result.attempt_id!==input.attemptId||result.chunk_id!==input.chunkId||result.profile_version_id!==chunk.profile_version_id||result.vector_hash!==stableHash(input.vector)||result.observed_source_hash!==request.expected_source_hash||result.observed_chunk_hash!==request.expected_chunk_hash||request.expected_source_hash!==source.source_hash||request.expected_chunk_hash!==chunk.content_hash||chunk.status!=='current'||source.status!=='current')throw new NewDesignError('原向量结果哈希、来源或分块已变化，不能进入索引。',409);}
 const existing=(await client.query('SELECT record_kind,request_id,attempt_id,chunk_id,response_vector FROM new_design.embedding_vectors WHERE id=$1 FOR UPDATE',[input.id])).rows[0];
 if(existing){if(existing.record_kind!==input.kind||existing.request_id!==input.requestId||existing.attempt_id!==input.attemptId||existing.chunk_id!==input.chunkId||JSON.stringify(existing.response_vector)!==JSON.stringify(input.vector))throw new NewDesignError('已经保留的原向量不同，禁止替换。',409);return;}
 await client.query(`INSERT INTO new_design.embedding_vectors(id,record_kind,request_id,attempt_id,book_id,generation_id,result_id,chunk_id,profile_version_id,source_kind,source_stable_id,source_version_id,source_revision,source_hash,chunk_hash,content_text,embedding,response_vector)
 VALUES($1,$2,$3,$4,$5,NULL,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::vector,$17::double precision[])`,[input.id,input.kind,input.requestId,input.attemptId,chunk.book_id,input.kind==='result'?input.id:null,chunk.id,chunk.profile_version_id,source.source_kind,source.source_stable_id,source.source_version_id,source.source_revision,source.source_hash,chunk.content_hash,chunk.chunk_text,`[${input.vector.join(',')}]`,input.vector]);
}

export function embeddingReplyMetadata<T extends {vector:number[]}>(reply:T,vectorId:string):Omit<T,'vector'>&{vectorId:string}{const {vector,...metadata}=reply;void vector;return{...metadata,vectorId};}
