import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type { RuntimePackageManifest } from "../../common/contracts";
import { scrub } from "./command";

export interface RuntimeAuditIdentity {
  installationId:string;
  dataGeneration:string;
  manifest:RuntimePackageManifest;
}
export type RuntimeUpgradeStrategy="same_major_staged"|"cross_major_pg_upgrade"|"cross_major_logical_restore";
export type RuntimeUpgradePlanStatus="planned"|"backed_up"|"staging"|"verifying"|"switched"|"rolled_back"|"failed";

export async function recordRuntimeReady(pool:Pool,identity:RuntimeAuditIdentity):Promise<void>{
  const client=await pool.connect();
  try{
    await client.query("BEGIN");
    const existing=(await client.query("SELECT status FROM new_design.runtime_installations WHERE installation_id=$1 FOR UPDATE",[identity.installationId])).rows[0];
    if(!existing){
      await client.query("INSERT INTO new_design.runtime_installations(installation_id,runtime_id,manifest_sha256,application_version,postgres_version,age_version,pgvector_version,pg_trgm_version,active_data_generation,status,last_started_at,last_health_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'healthy',now(),now())",values(identity));
      await event(client,identity,null,"healthy","install","");
    }else{
      if(["stopped","failed"].includes(String(existing.status))){await client.query("UPDATE new_design.runtime_installations SET status='starting',revision=revision+1,updated_at=now() WHERE installation_id=$1",[identity.installationId]);await event(client,identity,String(existing.status),"starting","start","");}
      await client.query("UPDATE new_design.runtime_installations SET status='healthy',revision=revision+1,last_started_at=now(),last_health_at=now(),updated_at=now() WHERE installation_id=$1",[identity.installationId]);
      await event(client,identity,["stopped","failed"].includes(String(existing.status))?"starting":String(existing.status),"healthy","ready","");
    }
    await client.query("COMMIT");
  }catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
}

export async function recordRuntimeStopRequested(pool:Pool,identity:RuntimeAuditIdentity):Promise<void>{
  const client=await pool.connect();
  try{
    await client.query("BEGIN");
    const existing=(await client.query("SELECT status FROM new_design.runtime_installations WHERE installation_id=$1 FOR UPDATE",[identity.installationId])).rows[0];
    if(existing)await event(client,identity,String(existing.status),"stopped","stop","stop_requested；实际退出结果以 bootstrap 状态为准");
    await client.query("COMMIT");
  }catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
}

export async function recordRuntimeFailure(pool:Pool,identity:RuntimeAuditIdentity,error:unknown):Promise<void>{
  const client=await pool.connect();
  try{await client.query("BEGIN");const existing=(await client.query("SELECT status FROM new_design.runtime_installations WHERE installation_id=$1 FOR UPDATE",[identity.installationId])).rows[0];if(existing){await client.query("UPDATE new_design.runtime_installations SET status='failed',revision=revision+1,updated_at=now() WHERE installation_id=$1",[identity.installationId]);await event(client,identity,String(existing.status),"failed","failure",scrub(error instanceof Error?error.message:String(error)));}await client.query("COMMIT");}catch(caught){await client.query("ROLLBACK");throw caught;}finally{client.release();}
}

export async function createRuntimeUpgradePlan(pool:Pool,input:{identity:RuntimeAuditIdentity;target:RuntimePackageManifest;strategy:RuntimeUpgradeStrategy;backupOperationId:string;compatibilityOperationId:string;targetDataGeneration:string;createdBy:string}):Promise<{id:string;status:"planned";revision:1}>{
  const client=await pool.connect(),id=randomUUID();
  try{await client.query("BEGIN");const current=(await client.query("SELECT status,runtime_id,manifest_sha256 FROM new_design.runtime_installations WHERE installation_id=$1 FOR UPDATE",[input.identity.installationId])).rows[0];if(!current||current.runtime_id!==input.identity.manifest.runtimeId||current.manifest_sha256!==input.identity.manifest.manifestSha256)throw new Error("运行审计指针与 bootstrap 来源不一致。");await client.query("INSERT INTO new_design.runtime_upgrade_plans(id,installation_id,source_runtime_id,target_runtime_id,source_manifest_sha256,target_manifest_sha256,source_postgres_major,target_postgres_major,strategy,backup_operation_id,compatibility_operation_id,source_data_generation,target_data_generation,rollback_data_generation,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$12,$14)",[id,input.identity.installationId,input.identity.manifest.runtimeId,input.target.runtimeId,input.identity.manifest.manifestSha256,input.target.manifestSha256,input.identity.manifest.components.postgresql.major,input.target.components.postgresql.major,input.strategy,input.backupOperationId,input.compatibilityOperationId,input.identity.dataGeneration,input.targetDataGeneration,input.createdBy]);await client.query("UPDATE new_design.runtime_installations SET status='upgrading',revision=revision+1,updated_at=now() WHERE installation_id=$1",[input.identity.installationId]);await event(client,input.identity,String(current.status),"upgrading","upgrade_plan",`plan=${id}`);await client.query("COMMIT");return{id,status:"planned",revision:1};}catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
}

export async function advanceRuntimeUpgradePlan(pool:Pool,input:{id:string;status:Exclude<RuntimeUpgradePlanStatus,"planned">;expectedRevision:number;errorCode?:string;errorSummary?:string}):Promise<{status:RuntimeUpgradePlanStatus;revision:number}>{
  const terminal=["switched","rolled_back","failed"].includes(input.status),row=(await pool.query("UPDATE new_design.runtime_upgrade_plans SET status=$2,revision=revision+1,last_error_code=$3,last_error_summary=$4,completed_at=CASE WHEN $5 THEN now() ELSE NULL END WHERE id=$1 AND revision=$6 RETURNING status,revision",[input.id,input.status,scrub(input.errorCode??""),scrub(input.errorSummary??""),terminal,input.expectedRevision])).rows[0];if(!row)throw new Error("升级计划已变化或不存在。");return{status:String(row.status) as RuntimeUpgradePlanStatus,revision:Number(row.revision)};
}

export async function completeRuntimeUpgrade(pool:Pool,input:{installationId:string;sourceDataGeneration:string;target:RuntimePackageManifest;targetDataGeneration:string}):Promise<void>{
  const client=await pool.connect(),component=input.target.components;
  try{await client.query("BEGIN");const row=(await client.query("UPDATE new_design.runtime_installations SET runtime_id=$2,manifest_sha256=$3,application_version=$4,postgres_version=$5,age_version=$6,pgvector_version=$7,pg_trgm_version=$8,active_data_generation=$9,status='healthy',revision=revision+1,last_health_at=now(),updated_at=now() WHERE installation_id=$1 AND status='upgrading' AND active_data_generation=$10 RETURNING installation_id",[input.installationId,input.target.runtimeId,input.target.manifestSha256,component.application.version,component.postgresql.version,component.age.version,component.pgvector.version,component.pgTrgm.version,input.targetDataGeneration,input.sourceDataGeneration])).rows[0];if(!row)throw new Error("升级完成时来源世代或运行审计指针已变化。");await client.query("INSERT INTO new_design.runtime_lifecycle_events(id,installation_id,event_kind,from_status,to_status,runtime_id,data_generation,detail) VALUES($1,$2,'upgrade_switch','upgrading','healthy',$3,$4,$5)",[randomUUID(),input.installationId,input.target.runtimeId,input.targetDataGeneration,`rollback_generation=${input.sourceDataGeneration}`]);await client.query("COMMIT");}catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
}

function values(identity:RuntimeAuditIdentity):unknown[]{const component=identity.manifest.components;return[identity.installationId,identity.manifest.runtimeId,identity.manifest.manifestSha256,component.application.version,component.postgresql.version,component.age.version,component.pgvector.version,component.pgTrgm.version,identity.dataGeneration];}
async function event(client:PoolClient,identity:RuntimeAuditIdentity,fromStatus:string|null,toStatus:string,kind:string,detail:string):Promise<void>{await client.query("INSERT INTO new_design.runtime_lifecycle_events(id,installation_id,event_kind,from_status,to_status,runtime_id,data_generation,detail) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",[randomUUID(),identity.installationId,kind,fromStatus,toStatus,identity.manifest.runtimeId,identity.dataGeneration,detail]);}
