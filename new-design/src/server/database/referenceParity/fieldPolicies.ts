import type {PoolClient} from "pg";
import type {FieldDefinition} from "../../../common/contracts";
import {NewDesignError} from "../../domain/errors";
/** Explicit book overrides prevent planning drafts inheriting default tracked policy. */
export async function installNonSettlementFields(client:PoolClient,spaceId:string,typeKey:string,fields:FieldDefinition[]){
  const none=fields.filter(field=>field.stateSettlement==="none");if(!none.length)return;
  await client.query(`INSERT INTO new_design.state_type_capabilities(space_id,type_key,settlement_capability,state_mode,default_field_policy)
    SELECT $1,type_key,settlement_capability,state_mode,default_field_policy FROM new_design.state_type_capabilities WHERE space_id='00000000-0000-4000-8000-000000000001' AND type_key=$2 ON CONFLICT DO NOTHING`,[spaceId,typeKey]);
  for(const field of none){
    const prior=(await client.query("SELECT settlement_policy FROM new_design.state_field_policies WHERE space_id=$1 AND type_key=$2 AND field_key=$3 FOR UPDATE",[spaceId,typeKey,field.key])).rows[0];
    if(prior&&prior.settlement_policy!=="none")throw new NewDesignError(`“${field.name}”已有不同的正式状态策略，请先明确处理，不自动覆盖。`,409);
    await client.query(`INSERT INTO new_design.state_field_policies(space_id,type_key,field_key,settlement_policy,state_mode) SELECT space_id,type_key,$3,'none','absolute' FROM new_design.state_type_capabilities WHERE space_id=$1 AND type_key=$2 ON CONFLICT DO NOTHING`,[spaceId,typeKey,field.key]);
  }
}
