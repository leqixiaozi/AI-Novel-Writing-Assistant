import {randomUUID} from 'node:crypto';
import type {Pool,PoolClient} from 'pg';
import {NewDesignError} from '../../domain/errors';
import {appendWorkflowVersion,createWorkflowCard,recordWorkflowAction} from '../cardWorkflow';

export type RecordCardDb=Pick<PoolClient,'query'>|Pick<Pool,'query'>;
export type RecordCardRow=Record<string,any>&{
  id:string;
  recordCardId:string;
  recordSpaceId:string;
  recordStatus:'active'|'archived';
  recordRevision:number;
  space_id:string|null;
  status:string;
  revision:number;
  created_at:unknown;
  updated_at:unknown;
};

function recordValues(input:Record<string,unknown>):Record<string,unknown>{
  const {recordCardId,recordSpaceId,recordStatus,recordRevision,...values}=input;
  void recordCardId;void recordSpaceId;void recordStatus;void recordRevision;
  return values;
}

function mapRecordCard(row:Record<string,any>):RecordCardRow{
  const values=row.values??{};
  return{
    ...values,
    id:String(values.id??row.id),
    recordCardId:String(row.id),
    recordSpaceId:String(row.space_id),
    recordStatus:row.status,
    recordRevision:Number(row.revision),
    // card_id is a business reference (for example the mounted card), not this record's identity.
    // A null logical space identifies a public form and must remain null.
    space_id:Object.hasOwn(values,'space_id')?values.space_id:String(row.space_id),
    status:String(values.status??row.status),
    revision:Number(values.revision??row.revision),
    created_at:values.created_at??row.created_at,
    updated_at:values.updated_at??row.updated_at,
  };
}

export async function listRecordCards(
  db:RecordCardDb,
  typeKey:string,
  options:{spaceId?:string;includeArchived?:boolean;lock?:boolean;where?:Record<string,unknown>}={},
):Promise<RecordCardRow[]>{
  const result=await db.query(`SELECT card.id,card.space_id,card.status,card.revision,card.created_at,card.updated_at,version.values
    FROM new_design.cards card
    JOIN new_design.card_types type ON type.id=card.card_type_id AND type.type_key=$1
    JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id
    WHERE ($2::uuid IS NULL OR CASE
      WHEN version.values ? 'space_id' THEN version.values->>'space_id'=$2::text
      WHEN version.values ? 'owner_space_id' THEN version.values->>'owner_space_id'=$2::text
      ELSE card.space_id=$2 END)
      AND ($3::boolean OR card.status='active')
      AND version.values @> $4::jsonb
    ORDER BY card.created_at,card.id${options.lock?' FOR UPDATE OF card':''}`,[
      typeKey,options.spaceId??null,options.includeArchived??false,JSON.stringify(options.where??{}),
    ]);
  return result.rows.map(mapRecordCard);
}

export async function findRecordCard(
  db:RecordCardDb,
  id:string,
  typeKey:string,
  options:{spaceId?:string;includeArchived?:boolean;lock?:boolean}={},
):Promise<RecordCardRow|null>{
  const result=await db.query(`SELECT card.id,card.space_id,card.status,card.revision,card.created_at,card.updated_at,version.values
    FROM new_design.cards card
    JOIN new_design.card_types type ON type.id=card.card_type_id AND type.type_key=$2
    JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id
    WHERE (card.id=$1 OR version.values->>'id'=$1::text)
      AND ($3::uuid IS NULL OR CASE
        WHEN version.values ? 'space_id' THEN version.values->>'space_id'=$3::text
        WHEN version.values ? 'owner_space_id' THEN version.values->>'owner_space_id'=$3::text
        ELSE card.space_id=$3 END)
      AND ($4::boolean OR card.status='active')${options.lock?' FOR UPDATE OF card':''}`,[
      id,typeKey,options.spaceId??null,options.includeArchived??false,
    ]);
  if(result.rows.length>1)throw new NewDesignError('内容对象身份存在冲突，请核对迁移映射。',409);
  return result.rows[0]?mapRecordCard(result.rows[0]):null;
}

export async function findRecordCardByValue(
  db:RecordCardDb,
  typeKey:string,
  field:string,
  value:string,
  options:{spaceId?:string;includeArchived?:boolean;lock?:boolean}={},
):Promise<RecordCardRow|null>{
  if(!/^[a-z][a-z0-9_]*$/.test(field))throw new NewDesignError('内容字段名称无效。',500);
  const result=await db.query(`SELECT card.id,card.space_id,card.status,card.revision,card.created_at,card.updated_at,version.values
    FROM new_design.cards card
    JOIN new_design.card_types type ON type.id=card.card_type_id AND type.type_key=$1
    JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id
    WHERE version.values->>$2=$3 AND ($4::uuid IS NULL OR CASE
      WHEN version.values ? 'space_id' THEN version.values->>'space_id'=$4::text
      WHEN version.values ? 'owner_space_id' THEN version.values->>'owner_space_id'=$4::text
      ELSE card.space_id=$4 END)
      AND ($5::boolean OR card.status='active')
    ORDER BY card.updated_at DESC,card.id
    LIMIT 1${options.lock?' FOR UPDATE OF card':''}`,[
      typeKey,field,value,options.spaceId??null,options.includeArchived??false,
    ]);
  return result.rows[0]?mapRecordCard(result.rows[0]):null;
}

export async function requireRecordCard(
  db:RecordCardDb,
  id:string,
  typeKey:string,
  message:string,
  options:{spaceId?:string;includeArchived?:boolean;lock?:boolean}={},
):Promise<RecordCardRow>{
  const row=await findRecordCard(db,id,typeKey,options);
  if(!row)throw new NewDesignError(message,404);
  return row;
}

export async function createRecordCard(db:RecordCardDb,input:{
  id?:string;
  spaceId:string;
  typeKey:string;
  title:string;
  values:Record<string,unknown>;
  versionId?:string;
  createdAt?:string|Date;
}):Promise<RecordCardRow>{
  const id=input.id??randomUUID(),createdAt=input.createdAt??(input.values.created_at as string|Date|undefined)??new Date().toISOString();
  // Persist logical identity/defaults as well as the physical card identity, so
  // direct JSON projections and the record reader see the same newly created row.
  const values={id,...(!Object.hasOwn(input.values,'owner_space_id')?{space_id:input.spaceId}:{}),status:'active',revision:1,created_at:createdAt,updated_at:createdAt,...recordValues(input.values)};
  const created=await createWorkflowCard(db,{...input,id,createdAt,values});
  return requireRecordCard(db,created.cardId,input.typeKey,'内容对象创建后未能读回。');
}

export async function replaceRecordCard(db:RecordCardDb,input:{
  id:string;
  spaceId:string;
  typeKey:string;
  title?:string;
  values:Record<string,unknown>;
}):Promise<RecordCardRow>{
  const current=await requireRecordCard(db,input.id,input.typeKey,'内容对象不存在。',{lock:true});
  if(current.recordSpaceId!==input.spaceId&&current.space_id!==input.spaceId&&current.owner_space_id!==input.spaceId)throw new NewDesignError('内容对象不属于当前空间。',404);
  const values=recordValues(input.values);
  await appendWorkflowVersion(db,{cardId:current.recordCardId,typeKey:input.typeKey,title:input.title,values});
  return requireRecordCard(db,current.recordCardId,input.typeKey,'内容对象更新后未能读回。');
}

export async function archiveRecordCard(db:RecordCardDb,input:{
  id:string;
  spaceId:string;
  typeKey:string;
  requestKey?:string;
  inputHash?:string;
  payload?:Record<string,unknown>;
}):Promise<void>{
  const row=await requireRecordCard(db,input.id,input.typeKey,'内容对象不存在。',{spaceId:input.spaceId,lock:true});
  const version=await appendWorkflowVersion(db,{cardId:row.recordCardId,typeKey:input.typeKey,values:recordValues(row),source:'archive'});
  await db.query("UPDATE new_design.cards SET status='archived',archived_at=now() WHERE id=$1",[row.recordCardId]);
  await recordWorkflowAction(db,{cardId:row.recordCardId,cardVersionId:String(version.id),actionKey:`${input.typeKey}.archive`,requestKey:input.requestKey,inputHash:input.inputHash,payload:{...input.payload,previousRevision:row.revision}});
}
