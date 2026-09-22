import type {PoolClient} from 'pg';
import {NewDesignError,assertFound} from '../../domain/errors';
import {createRecordCard,listRecordCards,requireRecordCard,type RecordCardRow} from '../recordCards';

/** Keep the frozen full text outside the metadata card and never revive a stale snapshot on reuse. */
export async function saveEmbeddingSourceSnapshot(client:PoolClient,input:Record<string,any>):Promise<RecordCardRow&{content_text:string;sourceCreated:boolean}>{
 const {content_text,...values}=input;
 const text=String(content_text);
 const profile=await requireRecordCard(client,String(values.profile_version_id),'embedding_profile_version','嵌入规格不存在。');
 const owner=assertFound((await client.query('SELECT status FROM new_design.embedding_profiles WHERE id=$1 FOR SHARE',[profile.profile_id])).rows[0],'嵌入配置不存在。');
 const resource=assertFound((await client.query('SELECT * FROM new_design.dependency_resources WHERE id=$1 FOR SHARE',[values.dependency_source_resource_id])).rows[0],'原来源依赖不存在。');
 if(!text.length||owner.status!=='active'||!Array.isArray(profile.allowed_source_kinds)||!profile.allowed_source_kinds.includes(values.source_kind)||resource.content_hash!==values.source_hash||resource.book_id!==null&&(resource.book_id!==values.book_id||resource.space_id!==values.space_id))throw new NewDesignError('嵌入来源、范围、哈希或规格不一致。',409);
 const where={book_id:values.book_id,profile_version_id:values.profile_version_id,source_kind:values.source_kind,source_stable_id:values.source_stable_id,source_version_id:values.source_version_id,source_revision:values.source_revision,source_hash:values.source_hash,chunk_recipe_hash:values.chunk_recipe_hash};
 await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[JSON.stringify(where)]);
 const existing=(await listRecordCards(client,'embedding_source_snapshot',{where,includeArchived:true,lock:true}))[0];
 if(existing){const original=assertFound((await client.query("SELECT chunk_text FROM new_design.embedding_chunks WHERE id=$1 AND record_kind='source' AND source_snapshot_id=$1 AND book_id=$2 AND profile_version_id=$3",[existing.id,values.book_id,values.profile_version_id])).rows[0],'原快照正文缺失，禁止用当前正文替代。');if(original.chunk_text!==text)throw new NewDesignError('原来源正文与冻结身份不一致。',409);return{...existing,content_text:original.chunk_text,sourceCreated:false};}
 const row=await createRecordCard(client,{id:String(values.id),spaceId:String(values.space_id),typeKey:'embedding_source_snapshot',title:String(values.title),values});
 await client.query(`INSERT INTO new_design.embedding_chunks(id,record_kind,book_id,source_snapshot_id,profile_version_id,ordinal,anchor_kind,anchor,chunk_text,token_estimate,content_hash,chunker_version,status,created_at,stale_at)
 VALUES($1,'source',$2,$1,$3,0,'whole','{}',$4,0,$5,$6,$7,$8,$9)`,[row.id,values.book_id,values.profile_version_id,text,values.source_hash,values.chunk_recipe_hash,values.status,values.created_at,values.stale_at]);
 return{...row,content_text:text,sourceCreated:true};
}
