import {randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import type {FieldDefinition} from '../../../common/contracts';
import {createAuthorMaterialInTransaction} from '../authorMaterials';
import {getNewDesignPool} from '../runtime';
import {NewDesignError,assertFound} from '../../domain/errors';
import {z} from 'zod';

/** Core book material, separate from the immutable installed template payload. */
export async function initializeProjectRuleInTransaction(client:PoolClient,bookId:string,requestKey:string){
 const book=assertFound((await client.query("SELECT space_id FROM new_design.books WHERE id=$1 AND status='active' FOR UPDATE",[bookId])).rows[0],'本书不存在或已归档。');
 const cards=(await client.query("SELECT card.id FROM new_design.cards card JOIN new_design.card_types type ON type.id=card.card_type_id WHERE card.space_id=$1 AND type.type_key='project_rule' AND card.status='active' ORDER BY card.id",[book.space_id])).rows;
 if(cards.length>1)throw new NewDesignError('本书有多份作品约定，请先核对原来源。',409);
 if(cards.length===1)return cards[0].id as string;
 let type=(await client.query("SELECT id,status,current_version_id FROM new_design.card_types WHERE space_id=$1 AND type_key='project_rule' FOR UPDATE",[book.space_id])).rows[0];
 if(!type){
  // Only the original built-in published definition is copied; its archived catalog state is preserved.
  const source=assertFound((await client.query("SELECT type.*,version.fields,version.id source_version_id FROM new_design.card_types type JOIN new_design.card_type_versions version ON version.id=type.current_version_id AND version.card_type_id=type.id WHERE type.id='10000000-0000-4000-8000-000000000001' AND type.space_id='00000000-0000-4000-8000-000000000001' AND type.type_key='project_rule'")).rows[0],'原作品约定正式定义缺失，未建立替代规格。');
  const fields=source.fields as FieldDefinition[];
  if(fields.some(field=>field.optionSource))throw new NewDesignError('原作品约定包含外部选项来源，需要先核对正式来源映射。',409);
  const id=randomUUID(),versionId=randomUUID();
  await client.query("INSERT INTO new_design.card_types(id,space_id,type_key,name,description,status,revision,draft_fields,is_system,sort_order,semantic_capabilities,source_card_type_id,source_type_version_id,category_id) VALUES($1,$2,'project_rule',$3,$4,'published',1,$5::jsonb,false,$6,$7::jsonb,$8,$9,$10)",[id,book.space_id,source.name,source.description,JSON.stringify(fields),source.sort_order,JSON.stringify(source.semantic_capabilities),source.id,source.source_version_id,source.category_id]);
  await client.query('INSERT INTO new_design.card_type_versions(id,card_type_id,version,fields) VALUES($1,$2,1,$3::jsonb)',[versionId,id,JSON.stringify(fields)]);
  await client.query('UPDATE new_design.card_types SET current_version_id=$2 WHERE id=$1',[id,versionId]);
  type={id,status:'published',current_version_id:versionId};
 }
 if(type.status!=='published'||!type.current_version_id)throw new NewDesignError('本书已有未发布或归档的作品约定类型，请先核对原规格；未覆盖。',409);
 const fields=(await client.query('SELECT fields FROM new_design.card_type_versions WHERE id=$1 AND card_type_id=$2',[type.current_version_id,type.id])).rows[0]?.fields as FieldDefinition[]|undefined;
 if(!fields)throw new NewDesignError('本书作品约定正式版本缺失。',409);
 const values=Object.fromEntries(fields.filter(field=>field.defaultValue!==null&&field.defaultValue!==undefined).map(field=>[field.key,field.defaultValue]));
 const receipt=await createAuthorMaterialInTransaction(client,bookId,{requestKey,cardTypeId:type.id,title:'本书作品约定',values,formVersionId:null,formResolutionKind:'type_schema'});
 return receipt.card.id;
}

export async function initializeProjectRule(bookId:string,raw:unknown){
 const {requestKey}=z.object({requestKey:z.string().uuid()}).strict().parse(raw),client=await(await getNewDesignPool()).connect();let committing=false;
 try{await client.query('BEGIN');const cardId=await initializeProjectRuleInTransaction(client,bookId,requestKey);committing=true;await client.query('COMMIT');return{bookId,cardId};}
 catch(error){let rolledBack=false;try{await client.query('ROLLBACK');rolledBack=true;}catch{}const message=error instanceof NewDesignError?error.message:'作品约定建立结果未确认，请只读核对原来源。',result=new NewDesignError(message,error instanceof NewDesignError?error.status:503);Object.assign(result,{recovery:{mutationOutcome:!committing&&rolledBack?'not_written':'unknown',summary:message,sourceRoute:`/new-design/books/${bookId}/setting`,actionLabel:'返回项目设定',savedResult:'原领取保留；读取原作品约定，不重复建立。'}});throw result;}
 finally{client.release();}
}
