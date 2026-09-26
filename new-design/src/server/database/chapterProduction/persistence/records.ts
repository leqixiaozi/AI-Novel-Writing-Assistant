import {randomUUID} from 'node:crypto';
import type {Pool,PoolClient} from 'pg';
import {NewDesignError,assertFound} from '../../../domain/errors';
import {createRecordCard,listRecordCards,replaceRecordCard,requireRecordCard} from '../../recordCards';
import {guardProductionRecord} from './guards';
import {stableHash} from '../../aiContracts/integrity';

type Values=Record<string,any>;
type Result={rows:Values[];rowCount:number};
function comparable(field:string,value:unknown):unknown{
  if(value===null||value===undefined)return null;
  if(field.endsWith('_at')||field.endsWith('_time'))return new Date(String(value)).toISOString();
  return value;
}

/** Pool callers receive the same atomic append/head update as callers with an open transaction. */
async function atomic<T>(db:Pool|PoolClient,work:(client:PoolClient)=>Promise<T>):Promise<T>{
  if('release' in db)return work(db);
  const client=await db.connect();
  try{await client.query('BEGIN');const result=await work(client);await client.query('COMMIT');return result;}
  catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}

async function owningSpace(client:PoolClient,values:Values):Promise<string>{
  if(values.book_id)return String(assertFound((await client.query('SELECT space_id FROM new_design.books WHERE id=$1',[values.book_id])).rows[0],'书籍不存在。').space_id);
  const parents:Array<[string,string]>=[['issue_id','quality_issue'],['issue_version_id','quality_issue_version'],['candidate_id','quality_fix_candidate'],['report_id','quality_audit_report']];
  for(const [field,type]of parents)if(values[field])return (await requireRecordCard(client,String(values[field]),type,'原质量记录不存在。',{includeArchived:true})).recordSpaceId;
  throw new NewDesignError('记录缺少可核实的本书来源。',422);
}

/** The caller supplies a typed SELECT of values, never a legacy SQL mutation. */
export async function insertProductionRecords(db:Pool|PoolClient,typeKey:string,select:string,parameters:unknown[],uniqueKeys:string[][]):Promise<Result>{
  return atomic(db,async client=>{
    const prepared=(await client.query(select,parameters)).rows,rows:Values[]=[];
    for(const values of prepared){
      await guardProductionRecord(client,typeKey,values);
      for(const key of uniqueKeys){
        if(key.some(field=>values[field]===null||values[field]===undefined))continue;
        const where=Object.fromEntries(key.map(field=>[field,values[field]]));
        await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`production-record:${typeKey}:${JSON.stringify(where)}`]);
        if((await listRecordCards(client,typeKey,{where,includeArchived:true})).length)throw new NewDesignError('原记录键已经存在，请核对原请求。',409);
      }
      const row=await createRecordCard(client,{id:typeof values.id==='string'?values.id:randomUUID(),spaceId:await owningSpace(client,values),typeKey,title:String(values.title??'章节生产记录'),values});
      rows.push(row);
    }
    return{rows,rowCount:rows.length};
  });
}

/** The selector locks the exact matching card records before computing the patch.
 * Logical revisions change only when the business statement explicitly changes them. */
export async function updateProductionRecords(db:Pool|PoolClient,typeKey:string,select:string,parameters:unknown[],identityFields:string[]):Promise<Result>{
  return atomic(db,async client=>{
    const selected=(await client.query(select,parameters)).rows,rows:Values[]=[];
    for(const selection of selected){
      const values=selection.record_values as Values,patch=selection.record_patch as Values;
      const matches=await listRecordCards(client,typeKey,{where:Object.fromEntries(identityFields.map(field=>[field,values[field]])),includeArchived:true,lock:true});
      if(matches.length!==1)throw new NewDesignError('原章节记录身份不唯一或已不可用。',409);
      const current=matches[0];
      // A waiter must not apply a patch computed from a previous head after another transaction wins.
      for(const field of Object.keys(values))if(stableHash(comparable(field,values[field]))!==stableHash(comparable(field,current[field])))throw new NewDesignError('原章节记录在等待期间已更新，请读取原请求后核对。',409);
      await guardProductionRecord(client,typeKey,{...current,...patch},current);
      const row=await replaceRecordCard(client,{id:current.recordCardId,spaceId:current.recordSpaceId,typeKey,values:{...current,...patch}});
      rows.push(row);
    }
    return{rows,rowCount:rows.length};
  });
}
