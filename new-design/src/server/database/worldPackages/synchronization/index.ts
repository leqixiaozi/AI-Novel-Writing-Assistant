import {randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import {worldSyncInputSchema,worldSyncCommitSchema,type WorldSyncInput,type WorldSyncCommit,type WorldSyncReceipt,type WorldPushCandidate} from '../../../../common/worldPackages';
import {NewDesignError} from '../../../domain/errors';
import {getNewDesignPool} from '../../runtime';
import {formHash} from '../../formAssist';
import {createAuthorMaterialInTransaction,updateAuthorMaterialInTransaction} from '../../authorMaterials';
import {readWorldOriginal,writeWorldOriginal} from '../receipts';
import {syncPreview} from './preview';
import {pullRelations,publishCandidate} from './writes';
import {saveSyncBaselines} from './baselines';

async function unusedAuthorKey(db:PoolClient,bookId:string,key:string){if((await db.query('SELECT 1 FROM new_design.card_versions WHERE author_book_id=$1 AND author_request_key=$2',[bookId,key])).rowCount)throw new NewDesignError('资料保存原键已被其他命令使用，请保留原结果重新准备预览。',409);}
export async function previewWorldSync(bookId:string,input:WorldSyncInput){const parsed=worldSyncInputSchema.parse(input),db=await(await getNewDesignPool()).connect();try{await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');const result=await syncPreview(db,bookId,parsed);await db.query('COMMIT');return result;}catch(error){await db.query('ROLLBACK');throw error;}finally{db.release();}}
export function readWorldSyncOriginal(bookId:string,input:WorldSyncCommit){return readWorldOriginal<WorldSyncReceipt>(bookId,worldSyncCommitSchema.parse(input));}

export function saveWorldSync(bookId:string,input:WorldSyncCommit):Promise<WorldSyncReceipt>{const parsed=worldSyncCommitSchema.parse(input);return writeWorldOriginal(bookId,parsed,async db=>{
 const {previewHash,...raw}=parsed,current=await syncPreview(db,bookId,raw,true);
 if(current.previewHash!==previewHash)throw new NewDesignError('本书、公共来源或完整选择已变化，请保留填写重新预览。',409);
 const id=randomUUID(),sequence=Number((await db.query('SELECT coalesce(max(sequence),0)+1 next FROM new_design.world_package_sync_commands WHERE installation_id=$1',[raw.installationId])).rows[0].next),cardVersions:WorldSyncReceipt['cardVersions']=[],addedCards:WorldSyncReceipt['addedCards']=[];
 let candidateId:string|null=null,publishedPackageId:string|null=null,relationVersions:WorldSyncReceipt['relationVersions']=[],baselineInput:WorldSyncInput=raw,baselinePackage=current.workspace.upstream;
 if(raw.operation==='pull'){
  for(const change of current.changes){
   const object=current.workspace.objects.find(object=>object.targetCardId===change.cardId)!,localSet=new Set(object.localFieldKeys),values=Object.fromEntries(Object.entries(change.values).filter(([key])=>!localSet.has(key))),localValues=Object.fromEntries(Object.entries(change.values).filter(([key])=>localSet.has(key)));
   await unusedAuthorKey(db,bookId,raw.cardRequestKeys[object.targetCardId]);
   const saved=await updateAuthorMaterialInTransaction(db,bookId,object.targetCardId,{requestKey:raw.cardRequestKeys[object.targetCardId],cardTypeId:object.targetTypeId,title:object.title,revision:object.targetRevision,values,localValues,formVersionId:object.formVersionId,formResolutionKind:object.formResolutionKind as 'installed_form'|'type_schema'});
   cardVersions.push({cardId:object.targetCardId,versionId:saved.cardVersionId});
  }
  for(const item of raw.newCards??[]){
   await unusedAuthorKey(db,bookId,item.requestKey);
   const target=current.newTargets.find(target=>target.sourceCardId===item.sourceCardId)!,source=current.workspace.newObjects.find(source=>source.cardId===item.sourceCardId)!;
   const saved=await createAuthorMaterialInTransaction(db,bookId,{requestKey:item.requestKey,cardTypeId:target.cardTypeId,title:item.title,values:target.values,formVersionId:target.formVersionId,formResolutionKind:target.formResolutionKind});
   addedCards.push({sourceCardId:source.cardId,sourceVersionId:source.versionId,targetCardId:saved.card.id,targetVersionId:saved.cardVersionId,targetTypeVersionId:saved.card.typeVersionId,mapping:item.mapping});
   cardVersions.push({cardId:saved.card.id,versionId:saved.cardVersionId});
  }
  relationVersions=await pullRelations(db,bookId,raw,current.workspace,addedCards);
 }
 if(raw.operation==='push')candidateId=randomUUID();
 if(raw.operation==='publish'){
  candidateId=raw.candidateId;
  const published=await publishCandidate(db,bookId,raw,current.workspace);publishedPackageId=published.package.id;baselineInput=published.candidate.input;baselinePackage=published.package;
 }
 const createdAt=new Date().toISOString(),inputHash=formHash({scope:bookId,input:parsed}),receipt:WorldSyncReceipt={id,bookId,installationId:raw.installationId,requestKey:raw.requestKey,operation:raw.operation,inputHash,input:parsed,sequence,candidateId,publishedPackageId,cardVersions,addedCards,relationVersions,createdAt,sourceRoute:`/new-design/books/${bookId}/story-setting?tab=world&selected=${current.workspace.rootCardId}&detail=sync`,repeated:false};
 await db.query('INSERT INTO new_design.world_package_sync_commands(id,book_id,installation_id,request_key,operation,sequence,input_hash,input,receipt,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10)',[id,bookId,raw.installationId,raw.requestKey,raw.operation,sequence,inputHash,JSON.stringify(parsed),JSON.stringify(receipt),createdAt]);
 if(candidateId&&raw.operation==='push'){
  const snapshot:WorldPushCandidate={id:candidateId,bookId,installationId:raw.installationId,packageId:raw.packageId,input:parsed,workspaceHash:current.workspace.workspaceHash,objects:current.workspace.objects,publicLive:current.workspace.publicLive,createdAt,publishedPackageId:null};
  await db.query('INSERT INTO new_design.world_package_push_candidates(id,command_id,book_id,installation_id,package_id,snapshot,created_at) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7)',[candidateId,id,bookId,raw.installationId,raw.packageId,JSON.stringify(snapshot),createdAt]);
 }
 for(const card of addedCards){
  await db.query('INSERT INTO new_design.world_package_added_card_refs(installation_id,command_id,package_id,source_card_id,target_card_id,snapshot) VALUES($1,$2,$3,$4,$5,$6::jsonb)',[raw.installationId,id,raw.packageId,card.sourceCardId,card.targetCardId,JSON.stringify(card)]);
  await db.query("INSERT INTO new_design.resource_adoptions(id,resource_card_id,resource_version_id,book_id,target_card_id,action,snapshot) VALUES($1,$2,$3,$4,$5,'install_snapshot',$6::jsonb)",[randomUUID(),card.sourceCardId,card.sourceVersionId,bookId,card.targetCardId,JSON.stringify({contract:'world_package_pull_v1',installationId:raw.installationId,commandId:id,mapping:card.mapping})]);
 }
 if(raw.operation==='pull'||raw.operation==='publish')await saveSyncBaselines(db,id,raw.installationId,baselineInput,baselinePackage,current.workspace,addedCards,relationVersions);
 return receipt;
 });}
