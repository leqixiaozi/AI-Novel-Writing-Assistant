import {createHash,randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import {persistKnowledgeBytes,readKnowledgeBytes} from '../../application/knowledgeReference/files';
import {NewDesignError,assertFound} from '../../domain/errors';

export interface ManagedJsonReference {
 kind:'managed_json_v1';checksum:string;byteSize:number;
 parts:Array<{contentObjectId:string;checksum:string;byteSize:number}>;
}
const sha=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex');

/** Reuses the existing bounded UTF-8 managed-file policy; no new filesystem root. */
export async function freezeManagedJson(client:PoolClient,value:unknown):Promise<ManagedJsonReference>{
 const serialized=JSON.stringify(value);if(serialized===undefined)throw new NewDesignError('冻结内容不是完整JSON值。',422);
 const reference:ManagedJsonReference={kind:'managed_json_v1',checksum:sha(serialized),byteSize:Buffer.byteLength(serialized,'utf8'),parts:[]};
 // JSON-string parts keep arbitrary whitespace and split surrogate pairs lossless,
 // while each UTF-8 file remains below the existing 2 MiB managed-file limit.
 for(let start=0;start<serialized.length;start+=200000){
  const file=await persistKnowledgeBytes(Buffer.from(JSON.stringify(serialized.slice(start,start+200000)),'utf8'),'application/json');
  const content=(await client.query("INSERT INTO new_design.asset_content_objects(id,checksum,byte_size,mime_type,storage_kind,storage_provider,storage_locator,integrity_state,last_verified_at,created_by) VALUES($1,$2,$3,'application/json','managed_file','local',$4,'verified',now(),'frozen_json') ON CONFLICT(checksum_algorithm,checksum,byte_size) DO NOTHING RETURNING *",[randomUUID(),file.checksum,file.byteSize,file.locator])).rows[0]??assertFound((await client.query('SELECT * FROM new_design.asset_content_objects WHERE checksum=$1 AND byte_size=$2',[file.checksum,file.byteSize])).rows[0],'冻结内容引用未保存。');
  if(content.storage_kind!=='managed_file'||content.storage_provider!=='local'||content.storage_locator!==file.locator||content.mime_type!=='application/json')throw new NewDesignError('相同冻结内容已有不同受控引用，未覆盖。',409);
  reference.parts.push({contentObjectId:String(content.id),checksum:file.checksum,byteSize:file.byteSize});
 }
 return reference;
}

export async function readManagedJson<T=unknown>(client:PoolClient,reference:ManagedJsonReference):Promise<T>{
 if(reference?.kind!=='managed_json_v1'||!Array.isArray(reference.parts)||!reference.parts.length||!/^[a-f0-9]{64}$/.test(reference.checksum)||!Number.isSafeInteger(reference.byteSize)||reference.byteSize<=0)throw new NewDesignError('冻结内容引用不完整。',409);
 const pieces:string[]=[];
 for(const part of reference.parts){
  const content=assertFound((await client.query("SELECT * FROM new_design.asset_content_objects WHERE id=$1 AND storage_kind='managed_file' AND storage_provider='local' AND mime_type='application/json'",[part.contentObjectId])).rows[0],'冻结内容对象不存在。');
  if(content.checksum!==part.checksum||Number(content.byte_size)!==part.byteSize)throw new NewDesignError('冻结内容对象的精确校验不一致。',409);
  const bytes=await readKnowledgeBytes(String(content.storage_locator),part.checksum,part.byteSize);let piece:unknown;
  try{piece=JSON.parse(bytes.toString('utf8'));}catch{throw new NewDesignError('冻结内容片段损坏，不能使用其他来源替代。',409);}
  if(typeof piece!=='string')throw new NewDesignError('冻结内容片段格式不匹配。',409);pieces.push(piece);
 }
 const serialized=pieces.join('');if(Buffer.byteLength(serialized,'utf8')!==reference.byteSize||sha(serialized)!==reference.checksum)throw new NewDesignError('冻结内容完整长度或SHA-256不一致。',409);
 try{return JSON.parse(serialized) as T;}catch{throw new NewDesignError('冻结内容不是完整JSON，原引用保留。',409);}
}

export async function restoreCreativePayload(client:PoolClient,row:Record<string,any>){
 const result={...row};for(const key of ['original_input','input_payload','frozen_plan','run_input','output_payload'])if(result[key]!==null&&result[key]!==undefined)result[key]=await readManagedJson(client,result[key]);return result;
}
