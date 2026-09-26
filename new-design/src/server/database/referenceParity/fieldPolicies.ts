import type {PoolClient} from "pg";
import type {FieldDefinition} from "../../../common/contracts";
import {NewDesignError} from "../../domain/errors";
import {randomUUID} from "node:crypto";
import {createRecordCard,listRecordCards} from "../recordCards";
/** Explicit book overrides prevent planning drafts inheriting default tracked policy. */
export async function installNonSettlementFields(client:PoolClient,spaceId:string,typeKey:string,fields:FieldDefinition[]){
  const none=fields.filter(field=>field.stateSettlement==="none");if(!none.length)return;
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[`state-policy:${spaceId}:${typeKey}`]);
  let capability=(await listRecordCards(client,'state_type_capability',{where:{space_id:spaceId,type_key:typeKey},lock:true}))[0];
  if(!capability){
    const source=(await listRecordCards(client,'state_type_capability',{where:{space_id:'00000000-0000-4000-8000-000000000001',type_key:typeKey}}))[0];
    if(!source)return;
    const id=randomUUID();
    capability=await createRecordCard(client,{id,spaceId,typeKey:'state_type_capability',title:typeKey,values:{id,space_id:spaceId,type_key:typeKey,settlement_capability:source.settlement_capability,state_mode:source.state_mode,default_field_policy:source.default_field_policy}});
  }
  for(const field of none){
    const prior=(await listRecordCards(client,'state_field_policy',{where:{space_id:spaceId,type_key:typeKey,field_key:field.key},lock:true}))[0];
    if(prior&&prior.settlement_policy!=="none")throw new NewDesignError(`“${field.name}”已有不同的正式状态策略，请先明确处理，不自动覆盖。`,409);
    if(!prior){const id=randomUUID();await createRecordCard(client,{id,spaceId,typeKey:'state_field_policy',title:field.name,values:{id,space_id:spaceId,type_key:typeKey,field_key:field.key,settlement_policy:'none',state_mode:'absolute'}});}
  }
}
