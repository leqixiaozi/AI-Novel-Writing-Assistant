import type {AiRunPreview} from "./contracts";
import {runInputRecord} from "./contextRunInput";

function canonical(value:unknown):unknown {if(Array.isArray(value))return value.map(canonical);if(runInputRecord(value))return Object.fromEntries(Object.entries(value).filter(([,item])=>item!==undefined).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>[key,canonical(item)]));return value;}
export function sameRunReceiptValue(a:unknown,b:unknown):boolean{return JSON.stringify(canonical(a))===JSON.stringify(canonical(b));}
export interface FrozenRunIdentity {
 id:string;bookId:string;taskContractVersionId:string;promptRecipeVersionId:string;taskNodeKey:string;sourceRoute:string;sourceKind:string;sourceId:string|null;
 contextManifestId:string;modelRouteSnapshotId:string;inputSnapshot:Record<string,unknown>;safeCheckpoint:Record<string,unknown>;inputHash:string;previewHash:string;
}
export function frozenRunIdentity(run:AiRunPreview):FrozenRunIdentity{return{id:run.id,bookId:run.bookId,taskContractVersionId:run.taskContractVersionId,promptRecipeVersionId:run.promptRecipeVersionId,taskNodeKey:run.taskNodeKey,sourceRoute:run.sourceRoute,sourceKind:run.sourceKind,sourceId:run.sourceId,contextManifestId:run.contextManifestId,modelRouteSnapshotId:run.modelRouteSnapshotId,inputSnapshot:run.inputSnapshot,safeCheckpoint:run.safeCheckpoint,inputHash:run.inputHash,previewHash:run.previewHash};}
export function isFrozenRunIdentity(value:unknown):value is FrozenRunIdentity {
 return runInputRecord(value)&&['id','bookId','taskContractVersionId','promptRecipeVersionId','taskNodeKey','sourceRoute','sourceKind','contextManifestId','modelRouteSnapshotId','inputHash','previewHash'].every(key=>typeof value[key]==='string'&&!!value[key])&&(value.sourceId===null||typeof value.sourceId==='string')&&runInputRecord(value.inputSnapshot)&&runInputRecord(value.safeCheckpoint);
}
export function matchesCreatedRun(run:AiRunPreview,input:{bookId:string;taskContractVersionId:string;taskNodeKey:string;sourceRoute:string;sourceKind:string;sourceId?:string|null;inputSnapshot:Record<string,unknown>;safeCheckpoint:Record<string,unknown>;totalBudget:number}):boolean {
 return !!run.id&&run.bookId===input.bookId&&run.taskContractVersionId===input.taskContractVersionId&&run.taskNodeKey===input.taskNodeKey&&run.sourceRoute===input.sourceRoute&&run.sourceKind===input.sourceKind&&run.sourceId===(input.sourceId??null)&&sameRunReceiptValue(run.inputSnapshot,input.inputSnapshot)&&sameRunReceiptValue(run.safeCheckpoint,input.safeCheckpoint)&&run.budgetSnapshot.total===input.totalBudget&&!!run.inputSchema;
}
export function matchesSubmittedRun(run:AiRunPreview,original:FrozenRunIdentity,expectedRevision:number):boolean {
 return run.status==='submitted'&&!!run.aiTaskId&&run.revision===expectedRevision+1&&sameRunReceiptValue(frozenRunIdentity(run),original);
}
