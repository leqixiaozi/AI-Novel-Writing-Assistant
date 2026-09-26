import {randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import {NewDesignError} from '../../domain/errors';
import {validateCardValues} from '../../domain/validation';
import {getNewDesignPool} from '../runtime';
import {createCardInTransaction} from '../store';
import {createRecordCard,findRecordCard,listRecordCards,replaceRecordCard} from '../recordCards';

async function mutate<T>(work:(client:PoolClient)=>Promise<T>):Promise<T>{const client=await(await getNewDesignPool()).connect();try{await client.query('BEGIN');const result=await work(client);await client.query('COMMIT');return result}catch(error){await client.query('ROLLBACK');throw error}finally{client.release()}}

async function assertRelationCapacity(client:PoolClient,typeId:string,rule:{source_max:number|null;target_max:number|null;direction:string},sourceId:string,targetId:string){
  const undirected=rule.direction==='undirected';
  if(rule.source_max!==null){const count=Number((await client.query("SELECT count(*) FROM new_design.card_relations WHERE relation_type_id=$1 AND status='active' AND (source_card_id=$2 OR ($3 AND target_card_id=$2))",[typeId,sourceId,undirected])).rows[0].count);if(count>=rule.source_max)throw new NewDesignError('起点卡片已达到这种关系的数量上限。',422)}
  if(rule.target_max!==null){const count=Number((await client.query("SELECT count(*) FROM new_design.card_relations WHERE relation_type_id=$1 AND status='active' AND (target_card_id=$2 OR ($3 AND source_card_id=$2))",[typeId,targetId,undirected])).rows[0].count);if(count>=rule.target_max)throw new NewDesignError('终点卡片已达到这种关系的数量上限。',422)}
}

export async function fillBookTemplateSlot(input:{bookId:string;slotId:string;expectedRevision:number;title:string;values:Record<string,unknown>}){return mutate(async client=>{
  const book=(await client.query('SELECT space_id,installed_payload FROM new_design.books WHERE id=$1 FOR UPDATE',[input.bookId])).rows[0];
  if(!book)throw new NewDesignError('书籍不存在。',404);
  const spaceId=String(book.space_id),slot=await findRecordCard(client,input.slotId,'book_template_slot',{spaceId,lock:true});
  if(!slot||slot.book_id!==input.bookId)throw new NewDesignError('待填槽位不属于本书。',404);
  if(slot.status!=='pending'||slot.card_id)throw new NewDesignError('槽位已经填写；请读取已生成的卡片，不要重复创建。',409);
  if(Number(slot.revision)!==input.expectedRevision)throw new NewDesignError('槽位已变化，请刷新后重试。',409);
  const meta=await findRecordCard(client,String(slot.meta_version_id),'meta_card_version',{includeArchived:true});
  if(!meta)throw new NewDesignError('槽位的冻结元卡片版本不存在。',422);
  const payload=book.installed_payload as {cardTypes:Array<{key:string;sourceVersionId:string}>};
  const typeSource=payload.cardTypes.find(type=>type.sourceVersionId===meta.card_type_version_id);
  if(!typeSource)throw new NewDesignError('槽位的资料类型未安装到本书。',422);
  const type=(await client.query('SELECT id FROM new_design.card_types WHERE space_id=$1 AND type_key=$2',[spaceId,typeSource.key])).rows[0];
  if(!type)throw new NewDesignError('本书资料类型不存在。',422);
  const card=await createCardInTransaction(client,{spaceId,cardTypeId:String(type.id),title:input.title,values:input.values});
  if(slot.module_instance_id){
    const instance=await findRecordCard(client,String(slot.module_instance_id),'book_template_module_instance',{spaceId,lock:true});
    const group=instance?.group_id?await findRecordCard(client,String(instance.group_id),'material_group',{spaceId,lock:true}):null;
    if(!group||group.status!=='active')throw new NewDesignError('本书卡片组不可用，请先核对分组。',409);
    const membershipId=randomUUID(),versionId=randomUUID();
    const cardVersionId=(await client.query('SELECT current_version_id FROM new_design.cards WHERE id=$1',[card.id])).rows[0]?.current_version_id;
    await createRecordCard(client,{id:membershipId,spaceId,typeKey:'material_group_membership',title:'卡片组成员',values:{id:membershipId,space_id:spaceId,group_id:group.id,card_id:card.id,is_primary:false,sort_order:1000,revision:1,current_version_id:versionId,status:'active',created_by:'user'}});
    await createRecordCard(client,{id:versionId,spaceId,typeKey:'material_group_membership_version',title:'卡片组成员版本',values:{id:versionId,membership_id:membershipId,revision:1,group_version_id:group.current_version_id,card_version_id:cardVersionId,sort_order:1000,status:'active',created_by:'user'}});
  }
  const updated=await replaceRecordCard(client,{id:slot.id,spaceId,typeKey:'book_template_slot',values:{...slot,card_id:card.id,status:'filled',revision:slot.revision+1,updated_at:new Date().toISOString()}});
  const slotVersion=(await client.query('SELECT current_version_id FROM new_design.cards WHERE id=$1',[updated.recordCardId])).rows[0]?.current_version_id;
  await client.query('UPDATE new_design.card_versions SET book_slot_spec_version_id=$2 WHERE card_id=$1 AND revision=1',[card.id,slotVersion]);
  return{slot:updated,card};
})}

export async function confirmBookTemplateRelation(input:{bookId:string;pendingRelationId:string;expectedRevision:number;properties:Record<string,unknown>}){return mutate(async client=>{
  const book=(await client.query('SELECT space_id,root_card_id,root_node_id FROM new_design.books WHERE id=$1 FOR UPDATE',[input.bookId])).rows[0];
  if(!book)throw new NewDesignError('书籍不存在。',404);
  const spaceId=String(book.space_id),pending=await findRecordCard(client,input.pendingRelationId,'book_template_pending_relation',{spaceId,lock:true});
  if(!pending||pending.book_id!==input.bookId)throw new NewDesignError('待绑定关系不属于本书。',404);
  if(pending.status!=='pending'||pending.relation_id)throw new NewDesignError('这条关系已确认，请读取正式关系。',409);
  if(Number(pending.revision)!==input.expectedRevision)throw new NewDesignError('待绑定关系已变化，请重新读取。',409);
  const slots=await listRecordCards(client,'book_template_slot',{spaceId,where:{book_id:input.bookId}});
  const cardOf=(nodeId:string)=>nodeId===String(book.root_node_id)?String(book.root_card_id):String(slots.find(slot=>slot.node_id===nodeId)?.card_id??'');
  const sourceId=cardOf(String(pending.from_node_id)),targetId=cardOf(String(pending.to_node_id));
  if(!sourceId||!targetId)throw new NewDesignError('关系两端尚有待填槽位，不能建立正式关系。',422);
  const version=(await client.query('SELECT * FROM new_design.relation_type_versions WHERE id=$1 AND status=$2',[pending.relation_type_version_id,'published'])).rows[0];
  if(!version)throw new NewDesignError('关系类型的冻结版本不存在。',422);
  const type=(await client.query('SELECT * FROM new_design.relation_types WHERE owner_space_id=$1 AND source_relation_type_id=$2 AND status=$3',[spaceId,version.relation_type_id,'published'])).rows[0];
  if(!type)throw new NewDesignError('本书未安装该关系类型。',422);
  const installedVersion=(await client.query('SELECT id FROM new_design.relation_type_versions WHERE relation_type_id=$1 AND source_version_id=$2 AND status=$3',[type.id,version.id,'published'])).rows[0];
  if(!installedVersion)throw new NewDesignError('本书关系类型缺少对应的冻结版本。',422);
  const endpoints=(await client.query(`SELECT card.id,type.type_key,card.current_version_id FROM new_design.cards card JOIN new_design.card_types type ON type.id=card.card_type_id WHERE card.id=ANY($1::uuid[]) AND card.space_id=$2 AND card.status='active'`,[[sourceId,targetId],spaceId])).rows;
  const from=endpoints.find(row=>String(row.id)===sourceId),to=endpoints.find(row=>String(row.id)===targetId);
  if(!from||!to)throw new NewDesignError('关系端点不是本书有效资料卡。',422);
  const fits=(left:string,right:string)=>(!version.source_type_keys.length||version.source_type_keys.includes(left))&&(!version.target_type_keys.length||version.target_type_keys.includes(right));
  if(!fits(from.type_key,to.type_key)&&!(version.direction==='undirected'&&fits(to.type_key,from.type_key)))throw new NewDesignError('关系类型不允许连接这两种资料卡。',422);
  const validated=validateCardValues(version.properties_schema,input.properties);
  if(Object.keys(validated.issues).length)throw new NewDesignError('请修正关系属性。',422,validated.issues);
  const existing=(await client.query("SELECT 1 FROM new_design.card_relations WHERE space_id=$1 AND relation_type_id=$2 AND status='active' AND ((source_card_id=$3 AND target_card_id=$4) OR ($5 AND source_card_id=$4 AND target_card_id=$3))",[spaceId,type.id,sourceId,targetId,version.direction==='undirected'])).rowCount;
  if(existing)throw new NewDesignError('两张资料卡之间已有相同的正式关系。',409);
  await assertRelationCapacity(client,String(type.id),version,sourceId,targetId);
  const relationId=randomUUID(),relationVersionId=randomUUID();
  await client.query(`INSERT INTO new_design.card_relations(id,space_id,relation_type_id,relation_type_version_id,source_card_id,target_card_id,properties,status,revision,created_by)
    VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,'active',1,'user')`,[relationId,spaceId,type.id,installedVersion.id,sourceId,targetId,JSON.stringify(validated.values)]);
  await client.query(`INSERT INTO new_design.card_relation_versions(id,card_relation_id,revision,source_card_version_id,target_card_version_id,status,properties,created_by)
    VALUES($1,$2,1,$3,$4,'active',$5::jsonb,'user')`,[relationVersionId,relationId,from.current_version_id,to.current_version_id,JSON.stringify(validated.values)]);
  await client.query('UPDATE new_design.card_relations SET current_version_id=$2 WHERE id=$1',[relationId,relationVersionId]);
  const updated=await replaceRecordCard(client,{id:pending.id,spaceId,typeKey:'book_template_pending_relation',values:{...pending,status:'confirmed',relation_id:relationId,revision:pending.revision+1,updated_at:new Date().toISOString()}});
  return{pendingRelation:updated,relationId,relationVersionId};
})}

export async function createBookInstanceRelation(input:{bookId:string;fromSlotId:string;toSlotId:string;relationTypeVersionId:string;properties:Record<string,unknown>}){return mutate(async client=>{
  const book=(await client.query('SELECT space_id,root_card_id FROM new_design.books WHERE id=$1 FOR UPDATE',[input.bookId])).rows[0];
  if(!book?.root_card_id)throw new NewDesignError('本书卡片结构不存在。',404);
  if(input.fromSlotId===input.toSlotId)throw new NewDesignError('请选择两张不同的资料卡。',422);
  const spaceId=String(book.space_id);
  const slots=await listRecordCards(client,'book_template_slot',{spaceId,where:{book_id:input.bookId},lock:true});
  const fromSlot=slots.find(row=>row.id===input.fromSlotId),toSlot=slots.find(row=>row.id===input.toSlotId);
  if(!fromSlot?.card_id||!toSlot?.card_id||fromSlot.status!=='filled'||toSlot.status!=='filled')throw new NewDesignError('关系两端必须是本书已填写的卡片。',422);
  const version=(await client.query(`SELECT version.*,type.id relation_type_id,type.direction
    FROM new_design.relation_type_versions version JOIN new_design.relation_types type ON type.id=version.relation_type_id
    WHERE version.id=$1 AND version.status='published' AND type.status='published' AND type.owner_space_id=$2
      AND version.source_version_id IS NOT NULL`,[input.relationTypeVersionId,spaceId])).rows[0];
  if(!version)throw new NewDesignError('请选择本书已安装的关系类型。',422);
  const sourceId=String(fromSlot.card_id),targetId=String(toSlot.card_id);
  const endpoints=(await client.query(`SELECT card.id,card.current_version_id,type.type_key FROM new_design.cards card
    JOIN new_design.card_types type ON type.id=card.card_type_id
    WHERE card.id=ANY($1::uuid[]) AND card.space_id=$2 AND card.status='active'`,[[sourceId,targetId],spaceId])).rows;
  const from=endpoints.find(row=>String(row.id)===sourceId),to=endpoints.find(row=>String(row.id)===targetId);
  if(!from||!to)throw new NewDesignError('关系端点已失效，请刷新卡片。',409);
  const fits=(left:string,right:string)=>(!version.source_type_keys.length||version.source_type_keys.includes(left))&&(!version.target_type_keys.length||version.target_type_keys.includes(right));
  if(!fits(from.type_key,to.type_key)&&!(version.direction==='undirected'&&fits(to.type_key,from.type_key)))throw new NewDesignError('该关系类型不能连接所选卡片。',422);
  const validated=validateCardValues(version.properties_schema,input.properties);
  if(Object.keys(validated.issues).length)throw new NewDesignError('请修正关系属性。',422,validated.issues);
  const existing=(await client.query(`SELECT id FROM new_design.card_relations WHERE space_id=$1 AND relation_type_id=$2
    AND status='active' AND ((source_card_id=$3 AND target_card_id=$4) OR ($5 AND source_card_id=$4 AND target_card_id=$3))`,
    [spaceId,version.relation_type_id,sourceId,targetId,version.direction==='undirected'])).rows[0];
  if(existing)throw new NewDesignError('这两张资料卡之间已有相同的关系。',409);
  await assertRelationCapacity(client,String(version.relation_type_id),version,sourceId,targetId);
  const relationId=randomUUID(),relationVersionId=randomUUID();
  await client.query(`INSERT INTO new_design.card_relations(id,space_id,relation_type_id,relation_type_version_id,source_card_id,target_card_id,properties,status,revision,created_by)
    VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,'active',1,'user')`,[relationId,spaceId,version.relation_type_id,version.id,sourceId,targetId,JSON.stringify(validated.values)]);
  await client.query(`INSERT INTO new_design.card_relation_versions(id,card_relation_id,revision,source_card_version_id,target_card_version_id,status,properties,created_by)
    VALUES($1,$2,1,$3,$4,'active',$5::jsonb,'user')`,[relationVersionId,relationId,from.current_version_id,to.current_version_id,JSON.stringify(validated.values)]);
  await client.query('UPDATE new_design.card_relations SET current_version_id=$2 WHERE id=$1',[relationId,relationVersionId]);
  return{relationId,relationVersionId};
})}
