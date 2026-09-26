import {createHash,randomUUID} from 'node:crypto';
import {lstat,mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {dramaExportManifestSchema,dramaExportSubmitSchema,type DramaExportManifest,type DramaExportReceipt} from '../../common/dramaProduction';
import {requireCardWorkflowTypes,workflowCard} from '../database/cardWorkflow';
import {createRecordCard,findRecordCardByValue,listRecordCards} from '../database/recordCards';
import {getNewDesignPool} from '../database/runtime';
import {DEFAULT_SPACE_ID} from '../database/store';
import {NewDesignError,assertFound} from '../domain/errors';
import {assertNoReparseChain,contained,ensurePrivateRuntimeLayout,resolvePrivateRuntimeLayout} from '../runtime/layout';

type Row=Record<string,any>;
const MANIFEST_TYPE='drama_export_manifest';
const ARTIFACT_TYPE='drama_export_artifact';
const stable=(value:unknown):string=>Array.isArray(value)
  ?`[${value.map(stable).join(',')}]`
  :value&&typeof value==='object'
    ?`{${Object.entries(value as Record<string,unknown>).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>`${JSON.stringify(key)}:${stable(item)}`).join(',')}}`
    :JSON.stringify(value)??'null';
const digest=(value:unknown)=>createHash('sha256').update(stable(value)).digest('hex');
const date=(value:unknown)=>new Date(String(value)).toISOString();

async function capable(write=false){
  await requireCardWorkflowTypes(await getNewDesignPool(),[MANIFEST_TYPE,ARTIFACT_TYPE],write);
}

function manifest(row:Row):DramaExportManifest{
  return{id:String(row.id),projectId:String(row.project_id),variant:row.variant,sourceHash:String(row.source_hash),sourceSnapshot:row.source_snapshot,createdAt:date(row.created_at)};
}

function artifact(row:Row){
  return{id:String(row.id),manifestId:String(row.manifest_id),filename:String(row.display_filename),mediaType:String(row.media_type),checksum:String(row.checksum),byteSize:Number(row.byte_size),downloadUrl:`/api/new-design/drama/exports/${row.id}/download`,createdAt:date(row.created_at)};
}

async function snapshot(projectId:string){
  const db=await getNewDesignPool();
  const project=await workflowCard(db,projectId,'drama_project');
  const projectValues=project.values as Row;
  const episodes=(await db.query(`SELECT card.id,card.values,version.values adopted_values
    FROM new_design.cards card
    JOIN new_design.card_types type ON type.id=card.card_type_id AND type.type_key='drama_stage'
    JOIN new_design.card_versions version ON version.id=(card.values->>'adopted_version_id')::uuid
    WHERE card.space_id=$1 AND card.status='active' AND card.values->>'stage_kind'='episode'
    ORDER BY (card.values->>'logical_order')::integer`,[projectId])).rows;
  const scripts=(await db.query(`SELECT card.id,card.values,version.values adopted_values
    FROM new_design.cards card
    JOIN new_design.card_types type ON type.id=card.card_type_id AND type.type_key='drama_script'
    JOIN new_design.card_versions version ON version.id=(card.values->>'adopted_version_id')::uuid
    WHERE card.space_id=$1 AND card.status='active' ORDER BY card.created_at,card.id`,[projectId])).rows;
  const boards=(await db.query(`SELECT card.id,card.values,version.values adopted_values
    FROM new_design.cards card
    JOIN new_design.card_types type ON type.id=card.card_type_id AND type.type_key='drama_storyboard'
    JOIN new_design.card_versions version ON version.id=(card.values->>'adopted_version_id')::uuid
    WHERE card.space_id=$1 AND card.status='active' ORDER BY card.created_at,card.id`,[projectId])).rows;
  if(!scripts.length)throw new NewDesignError('尚无已采用台本，不能导出。',409);
  return{
    project:{id:String(project.id),title:String(project.title),track:String(projectValues.track),targetEpisodes:Number(projectValues.target_episodes),episodeDurationSec:Number(projectValues.episode_duration_sec)},
    episodes:episodes.map((row:Row)=>({id:String(row.id),order:Number(row.values.logical_order),versionId:String(row.values.adopted_version_id),content:row.adopted_values.content})),
    scripts:scripts.map((row:Row)=>({episodeEntityId:String(row.values.episode_entity_id),versionId:String(row.values.adopted_version_id),content:row.adopted_values.content})),
    storyboards:boards.map((row:Row)=>({scriptEntityId:String(row.values.script_entity_id),versionId:String(row.values.adopted_version_id),content:row.adopted_values.content})),
  };
}

export async function previewDramaExport(projectId:string,raw:unknown){
  const input=dramaExportManifestSchema.parse(raw);
  await capable(true);
  const db=await getNewDesignPool(),fingerprint=digest({projectId,...input});
  const prior=await findRecordCardByValue(db,MANIFEST_TYPE,'request_key',input.requestKey);
  if(prior){
    if(prior.input_hash!==fingerprint)throw new NewDesignError('原短剧导出预览请求已用于其他输入。',409);
    return manifest(prior);
  }
  const source=await snapshot(projectId),sourceHash=digest(source),id=randomUUID();
  return manifest(await createRecordCard(db,{
    spaceId:DEFAULT_SPACE_ID,typeKey:MANIFEST_TYPE,title:`短剧导出预览 · ${projectId}`,
    values:{id,project_id:projectId,variant:input.variant,source_snapshot:source,source_hash:sourceHash,request_key:input.requestKey,input_hash:fingerprint},
  }));
}

const stamp=(seconds:number)=>{
  const value=Math.max(0,seconds),hours=Math.floor(value/3600),minutes=Math.floor(value%3600/60),secs=Math.floor(value%60),ms=Math.round((value-Math.floor(value))*1000);
  return`${String(hours).padStart(2,'0')}:${String(minutes).padStart(2,'0')}:${String(secs).padStart(2,'0')},${String(ms).padStart(3,'0')}`;
};

function render(item:DramaExportManifest){
  const source=item.sourceSnapshot as any;
  if(item.variant==='project_json'||item.variant==='timeline_json')return{bytes:Buffer.from(JSON.stringify(item.variant==='timeline_json'?{project:source.project,storyboards:source.storyboards}:source,null,2)),extension:'json',mediaType:'application/json'};
  if(item.variant==='project_markdown'){
    const body=[`# ${source.project.title}`,...source.episodes.flatMap((episode:any)=>{
      const script=source.scripts.find((value:any)=>value.episodeEntityId===episode.id);
      return[`
## 第 ${episode.order} 集：${episode.content.title}`,episode.content.outline??'',...((script?.content.scenes??[]).map((scene:any)=>`
### ${scene.order}. ${scene.location} ${scene.time}
${scene.action}
${(scene.dialogues??[]).map((line:any)=>`- **${line.speaker}**：${line.text}`).join('\n')}`))];
    })].join('\n');
    return{bytes:Buffer.from(body),extension:'md',mediaType:'text/markdown; charset=utf-8'};
  }
  let counter=1,cursor=0;
  const lines:string[]=[];
  for(const script of source.scripts)for(const scene of script.content.scenes??[])for(const dialogue of scene.dialogues??[]){
    const duration=Math.max(1,Math.min(8,String(dialogue.text).length/5));
    lines.push(String(counter++),`${stamp(cursor)} --> ${stamp(cursor+duration)}`,`${dialogue.speaker}：${dialogue.text}`,'');
    cursor+=duration;
  }
  return{bytes:Buffer.from(lines.join('\n')),extension:'srt',mediaType:'application/x-subrip; charset=utf-8'};
}

export async function createDramaExport(projectId:string,raw:unknown):Promise<DramaExportReceipt>{
  const input=dramaExportSubmitSchema.parse(raw);
  await capable(true);
  const db=await getNewDesignPool(),sourceRow=await findRecordCardByValue(db,MANIFEST_TYPE,'id',input.manifestId);
  const row=assertFound(sourceRow?.project_id===projectId?sourceRow:null,'短剧导出预览不存在。'),item=manifest(row);
  if(item.sourceHash!==input.expectedSourceHash||digest(await snapshot(projectId))!==item.sourceHash)throw new NewDesignError('来源已变化，请重新预览导出。',409);
  const fingerprint=digest({projectId,...input}),prior=await findRecordCardByValue(db,ARTIFACT_TYPE,'request_key',input.requestKey);
  if(prior){
    if(prior.input_hash!==fingerprint)throw new NewDesignError('原导出请求已用于其他清单。',409);
    return{manifest:item,artifact:artifact(prior)};
  }
  const output=render(item),layout=resolvePrivateRuntimeLayout();
  await ensurePrivateRuntimeLayout(layout);
  const folder=contained(layout.exportsDirectory,'drama',projectId);
  await mkdir(folder,{recursive:true});
  await assertNoReparseChain(layout.dataRoot,folder);
  const filename=`${item.variant}-${item.id}.${output.extension}`,target=contained(folder,filename);
  await writeFile(target,output.bytes,{flag:'wx'});
  const id=randomUUID(),result=await createRecordCard(db,{
    spaceId:DEFAULT_SPACE_ID,typeKey:ARTIFACT_TYPE,title:filename,
    values:{id,manifest_id:item.id,storage_locator:`drama/${projectId}/${filename}`,display_filename:filename,media_type:output.mediaType,checksum:createHash('sha256').update(output.bytes).digest('hex'),byte_size:output.bytes.length,request_key:input.requestKey,input_hash:fingerprint},
  });
  return{manifest:item,artifact:artifact(result)};
}

export async function listDramaExports(projectId:string):Promise<DramaExportReceipt[]>{
  await capable();
  const db=await getNewDesignPool();
  const manifests=(await listRecordCards(db,MANIFEST_TYPE)).filter(row=>row.project_id===projectId).sort((left,right)=>date(right.created_at).localeCompare(date(left.created_at)));
  const artifacts=await listRecordCards(db,ARTIFACT_TYPE);
  return manifests.map(row=>{const output=artifacts.find(item=>item.manifest_id===row.id);return{manifest:manifest(row),artifact:output?artifact(output):null};});
}

export async function resolveDramaExport(id:string){
  await capable();
  const db=await getNewDesignPool(),row=assertFound(await findRecordCardByValue(db,ARTIFACT_TYPE,'id',id),'短剧导出文件不存在。');
  const layout=resolvePrivateRuntimeLayout(),target=contained(layout.exportsDirectory,...String(row.storage_locator).split('/'));
  await assertNoReparseChain(layout.dataRoot,path.dirname(target));
  const info=await lstat(target);
  if(!info.isFile()||info.isSymbolicLink()||info.size!==Number(row.byte_size))throw new NewDesignError('短剧导出文件缺失或变化。',503);
  const bytes=await readFile(target);
  if(createHash('sha256').update(bytes).digest('hex')!==row.checksum)throw new NewDesignError('短剧导出校验失败。',503);
  return{path:target,filename:String(row.display_filename),mediaType:String(row.media_type)};
}
