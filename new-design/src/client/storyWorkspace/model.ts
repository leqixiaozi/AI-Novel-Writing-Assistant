import type {BookViewCard, PlanningObject} from '../../common/contracts';

export const SETTING_TABS = [{key:'characters',label:'人物'}, {key:'world',label:'世界'}, {key:'places',label:'地点与势力'}, {key:'props',label:'道具'}, {key:'other',label:'其他资料'}] as const;
export const PLANNING_TABS = [{key:'chapters',label:'章节'}, {key:'characters',label:'人物'}, {key:'events',label:'事件'}, {key:'timeline',label:'时间线'}, {key:'relations',label:'关系'}, {key:'clues',label:'伏笔'}, {key:'props',label:'道具'}] as const;
export type SettingTab = typeof SETTING_TABS[number]['key'];
export type PlanningTab = typeof PLANNING_TABS[number]['key'];
const worldKeys = ['world_setting','world_overview','world_rule','time_rule','power_system','race','culture','religion'];
export function settingTabForType(key:string):SettingTab { return key==='character'?'characters':worldKeys.includes(key)?'world':['location','faction','organization'].includes(key)?'places':key==='prop'?'props':'other'; }
export function plansInScope(objects:PlanningObject[], scope:string):PlanningObject[] {
 if(scope==='book')return objects.filter(item=>item.status==='active');
 const root=objects.find(item=>item.id===scope&&item.status==='active');if(!root)return [];
 const ids=new Set([root.id]);let changed=true;while(changed){changed=false;for(const item of objects)if(item.status==='active'&&item.parentObjectId&&ids.has(item.parentObjectId)&&!ids.has(item.id)){ids.add(item.id);changed=true;}}
 return objects.filter(item=>item.status==='active'&&ids.has(item.id));
}
export function planningCardIds(plans:PlanningObject[]):Set<string> {return new Set(plans.flatMap(item=>[...(item.cardId?[item.cardId]:[]),...item.currentVersion.references.map(ref=>ref.cardId),...plannedRelations(item).flatMap(row=>[row.sourceId,row.targetId])]));}
export function plannedRelations(plan:PlanningObject):Array<{sourceId:string;targetId:string;description:string}> {const rows=plan.currentVersion.content.relationshipPlans;return Array.isArray(rows)?rows.filter((row):row is {sourceId:string;targetId:string;description:string}=>!!row&&typeof row.sourceId==='string'&&typeof row.targetId==='string'&&typeof row.description==='string'):[];}
export function plannedTime(plan:PlanningObject,eventId:string):string {const schedule=plan.currentVersion.content.eventSchedule;if(schedule&&typeof schedule==='object'&&!Array.isArray(schedule)){const row=(schedule as Record<string,unknown>)[eventId];if(row&&typeof row==='object'){const entry=row as Record<string,unknown>;return `${typeof entry.occurrenceOrder==='number'?`发生顺序 ${entry.occurrenceOrder}`:'发生顺序未安排'}${typeof entry.timeLabel==='string'&&entry.timeLabel?` · ${entry.timeLabel}`:''}`;}}return typeof plan.currentVersion.content.storyTime==='string'&&plan.currentVersion.content.storyTime?plan.currentVersion.content.storyTime:'未安排发生顺序／时间';}
export function cardsForDimension(cards:BookViewCard[], tab:PlanningTab):BookViewCard[] {
 const keys:Record<PlanningTab,string[]>={chapters:['chapter','chapter_plan','volume','volume_plan','scene','scene_plan'],characters:['character'],events:['event','goal_task','conflict','plotline','plot_beat','arc'],timeline:['event'],relations:['character'],clues:['foreshadow','foreshadow_clue','clue_evidence','clue','suspense_question','secret_truth'],props:['prop']};
 return cards.filter(item=>item.status==='active'&&keys[tab].includes(item.typeKey));
}
export function settingHref(bookId:string,card:Pick<BookViewCard,'id'|'typeKey'>,returnTo?:string):string {const query=new URLSearchParams({tab:settingTabForType(card.typeKey),selected:card.id});if(returnTo)query.set('returnTo',returnTo);return `/new-design/books/${bookId}/story-setting?${query}`;}
export function safePlanningReturn(bookId:string,raw:string|null):string|null {if(!raw)return null;try{const url=new URL(raw,'http://workspace.local');return url.origin==='http://workspace.local'&&url.pathname===`/new-design/books/${bookId}/planning`?url.pathname+url.search+url.hash:null;}catch{return null;}}
export function hasAmbiguousNavigation(query:URLSearchParams):boolean {return ['tab','scope','selected','plan','type','new','detail','relation','returnTo','batch','batchMode','experienceBatch','recentExperienceBatch'].some(key=>query.getAll(key).length>1);}
export function writingHref(bookId:string,chapterCardId?:string|null):string {return chapterCardId?`/new-design/books/${bookId}/chapters/${encodeURIComponent(chapterCardId)}/write`:`/new-design/books/${bookId}/writing`;}
