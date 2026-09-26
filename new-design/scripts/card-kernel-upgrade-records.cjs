'use strict';
// Data adapters for the explicit 131 -> 133 upgrade. Sources are retained as
// immutable card versions; no author content or adoption pointer is inferred.
const {createHash}=require('node:crypto');
const {isDeepStrictEqual}=require('node:util');
const defaultSpace='00000000-0000-4000-8000-000000000001';
const stableUuid=seed=>{const h=createHash('md5').update(seed).digest('hex');return`${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;};
const uuidPattern=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
function timestampMicros(value){
 const text=value instanceof Date?value.toISOString():String(value);
 const match=text.match(/^(.*?)(?:\.(\d{1,6}))?([zZ]|[+-]\d{2}(?::?\d{2})?)$/);
 if(!match)throw new Error('Historical timestamp has no exact timezone representation');
 const zone=/^[+-]\d{2}$/.test(match[3])?`${match[3]}:00`:match[3];
 const seconds=Date.parse(match[1].replace(' ','T')+zone);
 if(!Number.isFinite(seconds))throw new Error('Historical timestamp is invalid');
 return BigInt(seconds)*1000n+BigInt((match[2]??'').padEnd(6,'0'));
}
function normalizedRecord(row,books){
 const values=row.current_values;
 if(!isDeepStrictEqual(values,row.values))throw new Error(`Record head differs from card: ${row.type_key}`);
 const id=values.id??row.id;
 if(!uuidPattern.test(id))throw new Error(`Record identity is not a UUID: ${row.type_key}`);
 const bookSpace=values.book_id?books.get(values.book_id):undefined;
 if(values.book_id&&!bookSpace)throw new Error(`Record refers to an absent book: ${row.type_key}`);
 const spaceId=values.space_id??values.owner_space_id??bookSpace??row.space_id;
 if(bookSpace&&spaceId!==bookSpace)throw new Error(`Record space differs from book: ${row.type_key}`);
 return{values:{...values,id},spaceId};
}
function assertHubMirror(source,native){
 const v=source.current_values,n=native?.current_values;
 let sameTime=false;
 try{sameTime=timestampMicros(native?.created_at)===timestampMicros(v.created_at)
  &&timestampMicros(native?.updated_at)===timestampMicros(v.updated_at);}catch{/* Invalid timestamps cannot prove an exact mirror. */}
 if(!native||native.id!==v.id||native.title!==v.title||native.status!==v.status
  ||Number(n?.thread_revision??native.revision)!==Number(v.revision)
  ||!isDeepStrictEqual(n?.binding,v.binding)
  ||!sameTime)throw new Error('Creative Hub source and native mirror differ');
}
function mergedTopicValues(topic,handler){
 const v=topic.current_values,h=handler.current_values;
 if(v.topic!==h.topic||Number(v.event_version)!==Number(h.event_version)||v.status!==h.status)throw new Error('Outbox topic and handler contract differ');
 for(const key of ['payload_contract','description'])if(Object.hasOwn(h,key)&&!isDeepStrictEqual(h[key],v[key]))throw new Error('Handler already contains a different topic contract');
 return{...h,id:h.id??handler.id,payload_contract:v.payload_contract,description:v.description,topic_created_at:v.created_at};
}
async function appendUpgradeVersion(db,row,values){
 const revision=Number((await db.query('SELECT coalesce(max(revision),0)+1 value FROM new_design.card_versions WHERE card_id=$1',[row.id])).rows[0].value);
 const id=stableUuid(`133:record-head:${row.id}:${revision}`);
 await db.query(`INSERT INTO new_design.card_versions(id,card_id,revision,type_version_id,title,values,source)
  VALUES($1,$2,$3,$4,$5,$6::jsonb,'edit')`,[id,row.id,revision,row.type_version_id,row.title,JSON.stringify(values)]);
 // Keep business revision/timestamps in the payload exactly as saved. The
 // physical revision advances only because a normalization version was added.
 await db.query('UPDATE new_design.cards SET values=$2::jsonb,current_version_id=$3,revision=revision+1 WHERE id=$1',[row.id,JSON.stringify(values),id]);
 row.current_version_id=id;row.current_values=values;row.values=values;
}
async function convertRecords(db,plan){
 const books=new Map((await db.query('SELECT id,space_id FROM new_design.books')).rows.map(row=>[row.id,row.space_id]));
 let appended=0;
 for(const {row,mapping} of plan.filter(item=>item.mapping.kind==='record')){
  const next=normalizedRecord(row,books);
  if(!isDeepStrictEqual(next.values,row.current_values)){await appendUpgradeVersion(db,row,next.values);appended++;}
  if(next.spaceId!==row.space_id)await db.query('UPDATE new_design.cards SET space_id=$2 WHERE id=$1',[row.id,next.spaceId]);
  row.space_id=next.spaceId;
 }
 for(const {row} of plan.filter(item=>item.mapping.kind==='merged')){
  const matches=plan.filter(item=>item.mapping.targetType==='background_job_handler'&&item.row.current_values.topic===row.current_values.topic&&Number(item.row.current_values.event_version)===Number(row.current_values.event_version));
  if(!matches.length)throw new Error('Outbox topic has no retained handler');
  for(const match of matches){await appendUpgradeVersion(db,match.row,mergedTopicValues(row,match.row));appended++;}
 }
 return{appended};
}
module.exports={stableUuid,normalizedRecord,assertHubMirror,mergedTopicValues,appendUpgradeVersion,convertRecords,defaultSpace};
