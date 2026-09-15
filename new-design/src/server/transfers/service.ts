import type { TransferOperationKind, TransferProfileKey } from "../../common/contracts";
import { NewDesignError } from "../domain/errors";
import { getTransferRuntimeAvailability, requireTransferRuntime, resolveReadyArtifactFile } from "./privateRuntime";
import { confirmImportRecord, confirmRestoreRecord, createImportDryRunRecord, createTransferOperationRecord, getReadyTransferArtifact, getTransferOperation } from "./store";

export interface TransferIngressArtifact {
  storageLocator:string;
  displayFilename:string;
  mediaType:string;
  checksum:string;
  byteSize:number;
  entryCount:number;
  compressedBytes:number;
  uncompressedBytes:number;
}

export interface TransferIngressAdapter {
  resolveUploadTicket(uploadTicketId:string):Promise<TransferIngressArtifact>;
}

export interface LocalRestoreAuthorization {
  maintenanceModeConfirmed:true;
  localElevationConfirmed:true;
  localConfirmationDigest:string;
}

export const getTransferAvailability=getTransferRuntimeAvailability;

export async function requestTransferExport(input:{operationKind:Extract<TransferOperationKind,"full_backup"|"book_export"|"template_export"|"resource_export">;profileKey:TransferProfileKey;bookId?:string|null;requestedBy:string;idempotencyKey:string}){
  await requireTransferRuntime(input.operationKind);
  return createTransferOperationRecord(input);
}

export async function requestImportDryRun(adapter:TransferIngressAdapter|undefined,input:{operationKind:Extract<TransferOperationKind,"book_import"|"template_import"|"resource_import">;profileKey:TransferProfileKey;uploadTicketId:string;requestedBy:string;idempotencyKey:string}){
  if(!adapter)throw new NewDesignError("受控上传入口尚未配置，不能解析导入票据。",503);
  await requireTransferRuntime(input.operationKind);
  const source=await adapter.resolveUploadTicket(input.uploadTicketId);
  return createImportDryRunRecord({...input,source});
}

export async function confirmTransferImport(dryRunId:string,input:{requestedBy:string;idempotencyKey:string;compatibilityPolicy:"strict"|"explicit_upgrade"}){
  const dryRun=await getTransferOperation(dryRunId);
  if(dryRun.operationKind==="full_restore")throw new NewDesignError("整库恢复没有普通 HTTP 确认入口。",403);
  await requireTransferRuntime(dryRun.operationKind);
  return confirmImportRecord(dryRunId,input);
}

export async function requestLocalRestoreDryRun(adapter:TransferIngressAdapter,input:{uploadTicketId:string;requestedBy:string;idempotencyKey:string;authorization:LocalRestoreAuthorization}){
  assertLocalRestoreAuthorization(input.authorization);
  await requireTransferRuntime("full_restore");
  const source=await adapter.resolveUploadTicket(input.uploadTicketId);
  return createImportDryRunRecord({operationKind:"full_restore",profileKey:"full_system",requestedBy:input.requestedBy,idempotencyKey:input.idempotencyKey,source});
}

export async function confirmLocalRestore(dryRunId:string,input:{requestedBy:string;idempotencyKey:string;authorization:LocalRestoreAuthorization}){
  assertLocalRestoreAuthorization(input.authorization);
  await requireTransferRuntime("full_restore");
  return confirmRestoreRecord(dryRunId,{requestedBy:input.requestedBy,idempotencyKey:input.idempotencyKey,...input.authorization});
}

function assertLocalRestoreAuthorization(value:LocalRestoreAuthorization):void{
  if(value.maintenanceModeConfirmed!==true||value.localElevationConfirmed!==true||!/^[a-f0-9]{64}$/.test(value.localConfirmationDigest))throw new NewDesignError("整库恢复需要本机高权限维护确认。",403);
}

export async function resolveTransferArtifactDownload(id:string):Promise<{path:string;displayFilename:string;mediaType:string}>{
  const artifact=await getReadyTransferArtifact(id),filePath=await resolveReadyArtifactFile(artifact.storageLocator);
  return{path:filePath,displayFilename:artifact.displayFilename,mediaType:artifact.mediaType};
}
