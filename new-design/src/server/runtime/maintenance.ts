import { createHash } from "node:crypto";
import path from "node:path";
import type { RuntimePackageManifest } from "../../common/contracts";
import { NewDesignError } from "../domain/errors";
import { resolvePrivateRuntimeLayout } from "./layout";
import { verifyRuntimePackage } from "./manifest";
import { readBootstrapState } from "./state";

export interface RuntimeUpgradeReadiness {
  available:boolean;
  code:"ready"|"current_runtime_unavailable"|"candidate_runtime_unavailable"|"confirmation_required"|"executor_unavailable";
  sourceRuntimeId:string|null;
  targetRuntimeId:string|null;
  strategy:"same_major_staged"|"cross_major_pg_upgrade"|"cross_major_logical_restore"|null;
  confirmationDigest:string|null;
  detail:string;
}

export interface RuntimeMaintenanceStageContext {source:RuntimePackageManifest;target:RuntimePackageManifest;sourceDataGeneration:string;targetDataGeneration:string;}
export interface RuntimeMaintenanceAdapter {
  stageUpgrade(context:RuntimeMaintenanceStageContext):Promise<void>;
  verifyStaging(context:RuntimeMaintenanceStageContext):Promise<void>;
  switchAndStart(context:RuntimeMaintenanceStageContext):Promise<void>;
  rollbackAndStartSource(context:RuntimeMaintenanceStageContext):Promise<void>;
}

export interface RuntimeRestoreAdapter {
  stopWritesAndWorkers():Promise<void>;
  restoreDatabaseAndAttachmentsToStaging(operationId:string):Promise<{targetDataGeneration:string}>;
  verifyManifestSchemaAndRebuildDerived(operationId:string,targetDataGeneration:string):Promise<void>;
  switchAndStart(operationId:string,targetDataGeneration:string):Promise<void>;
  rollbackAndStartSource(operationId:string):Promise<void>;
}

export async function inspectRuntimeUpgradeCandidate():Promise<RuntimeUpgradeReadiness>{
  const layout=resolvePrivateRuntimeLayout(),candidateRoot=path.resolve(layout.packageRoot,"..","runtime-package.next");
  let source:RuntimePackageManifest;try{source=await verifyRuntimePackage(layout.packageRoot);}catch(error){return{available:false,code:"current_runtime_unavailable",sourceRuntimeId:null,targetRuntimeId:null,strategy:null,confirmationDigest:null,detail:message(error)};}
  let target:RuntimePackageManifest;try{target=await verifyRuntimePackage(candidateRoot);}catch(error){return{available:false,code:"candidate_runtime_unavailable",sourceRuntimeId:source.runtimeId,targetRuntimeId:null,strategy:null,confirmationDigest:null,detail:message(error)};}
  const state=await readBootstrapState(layout);if(!state)return{available:false,code:"current_runtime_unavailable",sourceRuntimeId:source.runtimeId,targetRuntimeId:target.runtimeId,strategy:null,confirmationDigest:null,detail:"尚无可升级的本机安装状态。"};
  const strategy=source.components.postgresql.major===target.components.postgresql.major?"same_major_staged":"cross_major_pg_upgrade",confirmationDigest=createHash("sha256").update(`upgrade:${state.installationId}:${source.runtimeId}:${target.runtimeId}:${target.manifestSha256}`,"utf8").digest("hex");
  return{available:false,code:"executor_unavailable",sourceRuntimeId:source.runtimeId,targetRuntimeId:target.runtimeId,strategy,confirmationDigest,detail:"候选包可校验；仍须 031 完整备份、full_restore dry-run 与宿主维护执行器，当前不会切换数据。"};
}

export async function requireRuntimeUpgradeExecutor(readiness:RuntimeUpgradeReadiness,confirmationDigest:string|undefined,adapter:RuntimeMaintenanceAdapter|undefined):Promise<RuntimeMaintenanceAdapter>{
  if(!readiness.confirmationDigest||confirmationDigest!==readiness.confirmationDigest)throw new NewDesignError("升级确认摘要缺失或不匹配。",403);
  if(!adapter)throw new NewDesignError("升级 staging/校验/切换/回滚执行器尚未接入；已保留旧程序和旧数据。",503);
  return adapter;
}

export async function executeLocalRestoreStages(operationId:string,adapter:RuntimeRestoreAdapter|undefined):Promise<void>{
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(operationId)||!adapter)throw new NewDesignError("恢复必须由本机维护入口和已注册执行器发起。",503);
  await adapter.stopWritesAndWorkers();
  try{const staged=await adapter.restoreDatabaseAndAttachmentsToStaging(operationId);await adapter.verifyManifestSchemaAndRebuildDerived(operationId,staged.targetDataGeneration);await adapter.switchAndStart(operationId,staged.targetDataGeneration);}catch(error){await adapter.rollbackAndStartSource(operationId).catch(()=>undefined);throw error;}
}

function message(error:unknown):string{return error instanceof Error?error.message:String(error);}
