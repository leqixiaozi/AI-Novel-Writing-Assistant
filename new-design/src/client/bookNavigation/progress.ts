import type {BookViewCard,ChapterWritingChapter,PlanningObject} from '../../common/contracts';
import {LEGACY_PLANNING_FIELDS,type LegacyPlanningPresentation} from '../../common/planningRhythm/stageFields';

export interface WorkflowProgress {adopted:string;ready:boolean;detail:string;}
const filled=(value:unknown)=>typeof value==='string'?value.trim().length>0:typeof value==='number'?Number.isFinite(value)&&value>0:Array.isArray(value)?value.length>0:false;
function planningProgress(objects:PlanningObject[],presentation:LegacyPlanningPresentation):WorkflowProgress {
 const level=presentation==='story_macro'?'story':presentation==='outline'?'volume':'chapter';
 const rows=objects.filter(item=>item.status==='active'&&item.level===level);
 const adopted=rows.filter(item=>item.adoptedVersion);
 const fields=LEGACY_PLANNING_FIELDS[presentation].flatMap(group=>group.fields);
 const missing=adopted.flatMap(item=>fields.filter(field=>!filled(item.adoptedVersion?.content[field.key])).map(field=>field.label));
 return {adopted:`已采用 ${adopted.length}/${rows.length} 项`,ready:rows.length>0&&adopted.length===rows.length&&missing.length===0,detail:rows.length===0?'尚无正式规划':adopted.length<rows.length?'有规划待采用':missing.length?`待补 ${[...new Set(missing)].slice(0,2).join('、')}`:'本步就绪'};
}
function cardProgress(cards:BookViewCard[],keys:string[],required:string[]=[]):WorkflowProgress {
 const rows=cards.filter(item=>item.status==='active'&&keys.includes(item.typeKey));
 const complete=rows.some(item=>required.length?required.every(key=>filled(item.values[key])):Object.values(item.values).some(filled));
 return {adopted:`正式档案 ${rows.length} 项`,ready:complete,detail:complete?'本步就绪':rows.length?'专用填写待补':'尚无正式档案'};
}
export function workflowProgress(objects:PlanningObject[],cards:BookViewCard[],chapters:ChapterWritingChapter[]):WorkflowProgress[] {
 const adoptedBody=chapters.filter(item=>item.adoptedBodyVersionId).length;
 return [
  cardProgress(cards,['project_rule'],['reader_promise','target_length']),
  planningProgress(objects,'story_macro'),
  cardProgress(cards,['world_setting','world_overview','world_rule','time_rule','power_system','race','culture','religion']),
  cardProgress(cards,['character']),
  planningProgress(objects,'outline'),
  planningProgress(objects,'structured'),
  {adopted:`已采用正文 ${adoptedBody}/${chapters.length} 章`,ready:chapters.length>0&&adoptedBody===chapters.length,detail:chapters.length===0?'先完成章节计划':adoptedBody===chapters.length?'本步就绪':'正文待采用'},
  {adopted:'检查记录按章节查看',ready:false,detail:'未检查不代表通过；选择章节查看'},
 ];
}
