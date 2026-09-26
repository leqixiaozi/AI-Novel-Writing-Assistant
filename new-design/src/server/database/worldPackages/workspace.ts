import type {PoolClient} from 'pg';
import {z} from 'zod';
import {worldThreeWayFields,type WorldValue,type WorldInstallReceipt,type PublishedWorldPackage,type WorldSyncWorkspace,type WorldSyncObject,type WorldPushCandidate} from '../../../common/worldPackages';
import {assertFound,NewDesignError} from '../../domain/errors';
import {getNewDesignPool} from '../runtime';
import {freezeFormContext,formHash} from '../formAssist';
import {resolveBookFormVersion} from '../referenceParity';
import {worldPackageCapability,requireWorldPackageCapability} from './capability';
import {freezeWorldPackage} from './freeze';
import {readSyncRelations} from './synchronization/relations';
import {worldCatalogArchiveAvailable,worldCatalogStateInstalled} from './availability';
import {findRecordCardByValue,listRecordCards} from '../recordCards';

export const worldValue=(values:Record<string,unknown>,key:string):WorldValue=>Object.hasOwn(values,key)?{present:true,value:values[key]}:{present:false};
const dateValue=(value:unknown)=>new Date(String(value)).toISOString();
export async function getWorldInstallationFields(bookId:string,typeId:string){z.string().uuid().parse(bookId);z.string().uuid().parse(typeId);const db=await(await getNewDesignPool()).connect();try{await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');await requireWorldPackageCapability(db);const type=assertFound((await db.query("SELECT type.* FROM new_design.card_types type JOIN new_design.books book ON book.space_id=type.space_id WHERE type.id=$1 AND book.id=$2 AND book.status='active' AND type.status='published'",[typeId,bookId])).rows[0],'请选择本书已发布的世界类型。');const resolution=await resolveBookFormVersion(db,type.space_id,type.type_key),context=await freezeFormContext(db,{bookId,cardTypeId:type.id,typeVersionId:type.current_version_id,cardId:null,cardRevision:null,formVersionId:resolution?.id??null,title:'世界资料'},{},[]);await db.query('COMMIT');return{bookId,typeId,fields:context.fields};}catch(error){await db.query('ROLLBACK');throw error;}finally{db.release();}}
export async function readSyncWorkspace(db:PoolClient,bookId:string,installationId:string,packageId:string,lock=false):Promise<WorldSyncWorkspace>{
 await requireWorldPackageCapability(db);
 const installedRow=await findRecordCardByValue(db,'world_package_installation','id',installationId,{lock}),installed=assertFound(installedRow?.book_id===bookId?installedRow:null,'本书公共世界安装来源不存在。'),installation=installed.receipt as WorldInstallReceipt;
 const original=assertFound(await findRecordCardByValue(db,'world_package_snapshot','id',String(installed.package_id)),'原公共世界固定版本不存在。').frame;
 const upstream=assertFound(await findRecordCardByValue(db,'world_package_snapshot','id',packageId),'所选公共世界更新版本不存在。').receipt.package as PublishedWorldPackage;
 if(upstream.rootCardId!==original.rootCardId)throw new NewDesignError('所选版本不属于本书原公共世界来源，独立资料保留。',422);
 const commands=(await listRecordCards(db,'world_package_sync_command')).filter(row=>row.installation_id===installationId).sort((left,right)=>Number(right.sequence)-Number(left.sequence)),history=commands.slice(0,100),toggle=commands.find(row=>row.operation==='toggle'),syncEnabled=toggle?toggle.receipt.input.syncEnabled===true:installed.sync_enabled;
 const baselineMap=new Map<string,Record<string,any>>();for(const command of commands)for(const baseline of command.field_baselines??[]){const key=`${baseline.source_card_id}:${baseline.source_key}`;if(!baselineMap.has(key))baselineMap.set(key,baseline);}const baselines=[...baselineMap.values()];
 const snapshots=await listRecordCards(db,'world_package_snapshot'),added=commands.flatMap(command=>(command.receipt?.addedCards??[]).map((snapshot:WorldInstallReceipt['cards'][number])=>({snapshot,frame:snapshots.find(item=>item.id===command.input?.packageId)?.frame})));
 const mappings=[...installation.cards,...added.map(row=>row.snapshot as WorldInstallReceipt['cards'][number])],objects:WorldSyncObject[]=[];
 for(const mapping of mappings){
  const card=assertFound((await db.query("SELECT card.*,type.type_key,type.current_version_id current_type_version_id,type.revision type_revision FROM new_design.cards card JOIN new_design.card_types type ON type.id=card.card_type_id JOIN new_design.books book ON book.space_id=card.space_id WHERE card.id=$1 AND book.id=$2 AND card.status='active' AND book.status='active'"+(lock?' FOR SHARE OF card,type,book':''),[mapping.targetCardId,bookId])).rows[0],'本书独立世界对象不可用，请保留固定来源核对。');
  const resolution=await resolveBookFormVersion(db,card.space_id,card.type_key),localRows=await listRecordCards(db,'card_version_local_value'),definitions=(await db.query('SELECT id,field_key FROM new_design.field_definitions')).rows,fieldKeys=new Map(definitions.map(row=>[String(row.id),String(row.field_key)])),localValues=Object.fromEntries(localRows.filter(row=>row.card_version_id===String(card.current_version_id)).map(row=>[fieldKeys.get(String(row.field_definition_id))??String(row.field_definition_id),row.value]));
  const context=await freezeFormContext(db,{bookId,cardTypeId:card.card_type_id,typeVersionId:card.current_type_version_id,cardId:card.id,cardRevision:card.revision,formVersionId:resolution?.id??null,title:card.title},{...card.values,...localValues},[]);
  const initial=original.cards.find((item:{cardId:string})=>item.cardId===mapping.sourceCardId)??added.find(row=>row.snapshot.sourceCardId===mapping.sourceCardId)!.frame.cards.find((item:{cardId:string})=>item.cardId===mapping.sourceCardId),next=upstream.frame.cards.find(item=>item.cardId===mapping.sourceCardId),baseValues={...initial.values,...initial.localValues},nextValues=next?{...next.values,...next.localValues}:{};
  const initialLocal=assertFound((await db.query('SELECT values FROM new_design.card_versions WHERE id=$1 AND card_id=$2',[mapping.targetVersionId,mapping.targetCardId])).rows[0],'原本书世界版本不存在。'),initialExtras=Object.fromEntries(localRows.filter(row=>row.card_version_id===mapping.targetVersionId).map(row=>[fieldKeys.get(String(row.field_definition_id))??String(row.field_definition_id),row.value]));
  const sourceKeys=[...new Set([...Object.keys(baseValues),...Object.keys(nextValues),...baselines.filter(row=>row.source_card_id===mapping.sourceCardId).map(row=>row.source_key)])].sort();
  const differences=sourceKeys.map(key=>{
   const saved=baselines.find(row=>row.source_card_id===mapping.sourceCardId&&row.source_key===key),mapped=mapping.mapping.find(item=>item.sourceKey===key),targetKey=saved?.target_key??mapped?.targetKey??null,base=saved?.public_value??worldValue(baseValues,key),localBase=saved?.local_value??(mapped?worldValue({...initialLocal.values,...initialExtras},mapped.targetKey):{present:false}),local=targetKey?worldValue({...card.values,...localValues},targetKey):{present:false} as WorldValue,up=worldValue(nextValues,key),localChanged=formHash(local)!==formHash(localBase),upChanged=formHash(up)!==formHash(base);
   const status=!localChanged&&!upChanged?'unchanged':formHash(local)===formHash(up)?'converged':!upChanged?'local_only':!localChanged?'upstream_only':'conflict';
   return{key,base,localBase,local,upstream:up,status:status as ReturnType<typeof worldThreeWayFields>[number]['status'],targetKey,sourceLabel:[...(next?.fields??initial.fields),...(next?.localFields??initial.localFields).map((item:{field:{key:string;name:string}})=>item.field)].find((field:{key:string})=>field.key===key)?.name??key,targetLabel:context.fields.find(field=>field.key===targetKey)?.name??null};
  });
  objects.push({sourceCardId:mapping.sourceCardId,section:next?.section??initial.section,title:card.title,targetCardId:card.id,targetTypeId:card.card_type_id,targetTypeKey:card.type_key,targetVersionId:card.current_version_id,targetRevision:card.revision,fields:context.fields,localFieldKeys:context.localFieldKeys,localValues,values:card.values,formVersionId:resolution?.id??null,formResolutionKind:resolution?'installed_form':'type_schema',sourceHash:context.sourceHash,differences});
 }
 const publicLive=(await db.query('SELECT id card_id,current_version_id FROM new_design.cards WHERE id=ANY($1::uuid[]) ORDER BY id'+(lock?' FOR SHARE':''),[upstream.frame.cards.map(card=>card.cardId)])).rows.map(row=>({cardId:String(row.card_id),versionId:String(row.current_version_id)}));
 const candidateRows=(await listRecordCards(db,'world_package_push_candidate')).filter(row=>row.installation_id===installationId).sort((left,right)=>dateValue(right.created_at).localeCompare(dateValue(left.created_at))).slice(0,100),candidates=candidateRows.map(row=>({snapshot:row.snapshot,published_package_id:commands.find(command=>command.operation==='publish'&&command.input?.candidateId===row.id)?.receipt?.publishedPackageId??null}));
 const publicSources=await freezeWorldPackage(db,{requestKey:installation.requestKey,rootCardId:upstream.rootCardId,rootVersionId:upstream.rootVersionId,cards:upstream.frame.cards.map(card=>({cardId:card.cardId,versionId:card.versionId,section:card.section})),relationVersionIds:upstream.frame.relations.map(relation=>relation.versionId)},lock);
 const newObjects=upstream.frame.cards.filter(card=>!mappings.some(mapping=>mapping.sourceCardId===card.cardId)),removedObjects=mappings.filter(mapping=>!upstream.frame.cards.some(card=>card.cardId===mapping.sourceCardId)).map(mapping=>mapping.sourceCardId),relations=await readSyncRelations(db,bookId,installation,original,upstream,mappings,lock);
 const workspaceHash=formHash({bookId,rootCardId:installed.root_card_id,installation,upstream,objects,newObjects,removedObjects,relations,publicLive,publicSources:publicSources.frame,syncEnabled,baselines});
 return{bookId,rootCardId:installed.root_card_id,installation,upstream,objects,newObjects,removedObjects,relations,publicLive,syncEnabled,workspaceHash,history:history.map(row=>row.receipt),candidates:candidates.map(row=>({...row.snapshot,publishedPackageId:row.published_package_id??null} as WorldPushCandidate))};
}
export async function getWorldPackageCatalog(includeArchived=false){
 const db=await(await getNewDesignPool()).connect();
 try{
  await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const capability=await worldPackageCapability(db),stateInstalled=await worldCatalogStateInstalled(db),archiveAvailable=await worldCatalogArchiveAvailable(db);
  let items:PublishedWorldPackage[]=[],states:Record<string,{status:'active'|'archived';revision:number}>={};
  if(capability.installed){
   const snapshots=(await listRecordCards(db,'world_package_snapshot')).sort((left,right)=>String(left.root_card_id).localeCompare(String(right.root_card_id))||Number(right.version)-Number(left.version)),actions=stateInstalled?await listRecordCards(db,'world_package_catalog_action'):[],latest=new Map<string,Record<string,any>>();
   for(const action of actions.sort((left,right)=>Number(right.revision)-Number(left.revision)))if(!latest.has(String(action.root_card_id)))latest.set(String(action.root_card_id),action);
   const visible=snapshots.filter(row=>includeArchived||latest.get(String(row.root_card_id))?.action!=='archive');
   if(visible.length>300)throw new NewDesignError('公共世界版本超过目录范围，请先按来源筛选。',422);
   items=visible.map(row=>row.receipt.package);
   const roots=[...new Set(items.map(item=>item.rootCardId))];
   states=Object.fromEntries(roots.map(root=>{const state=latest.get(root);return[root,{status:state?.action==='archive'?'archived':'active',revision:Number(state?.revision??0)}];}));
  }
  await db.query('COMMIT');
  return{capability,archiveAvailable,items,states};
 }catch(error){await db.query('ROLLBACK');throw error;}finally{db.release();}
}
export async function getBookWorldSyncWorkspace(bookId:string,rootCardId:string,packageId?:string){
 z.string().uuid().parse(bookId);z.string().uuid().parse(rootCardId);
 const db=await(await getNewDesignPool()).connect();
 try{
  await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');const capability=await worldPackageCapability(db);
  if(!capability.operational){await db.query('COMMIT');return{capability,workspace:null};}
  const installed=(await listRecordCards(db,'world_package_installation')).find(row=>row.book_id===bookId&&row.root_card_id===rootCardId);
  const confirmed=installed?(await listRecordCards(db,'world_package_sync_command')).filter(row=>row.installation_id===installed.id&&['pull','publish'].includes(row.operation)).sort((left,right)=>Number(right.sequence)-Number(left.sequence))[0]:null;
  const workspace=installed?await readSyncWorkspace(db,bookId,String(installed.id),packageId?z.string().uuid().parse(packageId):String(confirmed?.receipt?.publishedPackageId??confirmed?.input?.packageId??installed.package_id)):null;
  await db.query('COMMIT');return{capability,workspace};
 }catch(error){await db.query('ROLLBACK');throw error;}finally{db.release();}
}

export async function getWorldSyncHistory(bookId:string,installationId:string,before?:number){
 z.string().uuid().parse(bookId);z.string().uuid().parse(installationId);if(before!==undefined)z.number().int().positive().parse(before);
 const db=await(await getNewDesignPool()).connect();
 try{
  await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const capability=await worldPackageCapability(db);if(!capability.installed){await db.query('COMMIT');return{items:[],nextSequence:null};}
  const installation=await findRecordCardByValue(db,'world_package_installation','id',installationId);assertFound(installation?.book_id===bookId?installation:null,'同步历史不属于本书来源。');
  const rows=(await listRecordCards(db,'world_package_sync_command')).filter(row=>row.installation_id===installationId&&(before===undefined||Number(row.sequence)<before)).sort((left,right)=>Number(right.sequence)-Number(left.sequence)).slice(0,101),items=rows.slice(0,100).map(row=>row.receipt);
  await db.query('COMMIT');return{items,nextSequence:rows.length>100?Number(rows[99].sequence):null};
 }catch(error){await db.query('ROLLBACK');throw error;}finally{db.release();}
}
