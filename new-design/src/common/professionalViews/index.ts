import type {BookSummary,StoryEventTiming} from '../contracts';
import type {AuthorTimelineWorkspace} from '../bookComposition/timeline';
import type {ProfessionalObject,ProfessionalRelation,ProfessionalState,ProfessionalKnowledge,ProfessionalSourceAction} from '../worldCharacterMaintenance';

export const PROFESSIONAL_VIEWS=['relationships','growth','timeline','map'] as const;
export type ProfessionalView=typeof PROFESSIONAL_VIEWS[number];
export interface ProfessionalGrowthEntry {
 id:string;subjectId:string;subjectLabel:string;fieldLabel:string;before:string;after:string;
 storyOrder:number|null;sequence:number;recordedAt:string;reason:string;available:boolean;reasonUnavailable:string|null;
 action:ProfessionalSourceAction;
}
export interface ProfessionalViewsWorkspace {
 book:BookSummary;objects:ProfessionalObject[];relations:ProfessionalRelation[];states:ProfessionalState[];
 knowledge:ProfessionalKnowledge[];growth:ProfessionalGrowthEntry[];timeline:AuthorTimelineWorkspace;
 truncated:boolean;notes:string[];
}
export interface ProfessionalViewsApi {getProfessionalViewsWorkspace:(bookId:string)=>Promise<ProfessionalViewsWorkspace>;}
export interface CoordinateFieldReference {key:string;versionId:string;}
export interface ProfessionalMapBinding {typeId:string;x:CoordinateFieldReference;y:CoordinateFieldReference;}
export interface ProfessionalViewPreferences {
 version:1;bookId:string;view:ProfessionalView;search:string;selectedId:string;
 positions:Record<string,{x:number;y:number}>;map:ProfessionalMapBinding|null;
}
export const professionalUuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
export function professionalPreferencesKey(bookId:string){return `new-design:professional-views:1:${bookId}`;}
export function emptyProfessionalPreferences(bookId:string):ProfessionalViewPreferences {return {version:1,bookId,view:'relationships',search:'',selectedId:'',positions:{},map:null};}
export function parseProfessionalPreferences(raw:string,bookId:string):ProfessionalViewPreferences|null {
 try {
  if(raw.length>60000||!professionalUuid.test(bookId))return null;
  const value=JSON.parse(raw);if(!value||value.version!==1||value.bookId!==bookId||!PROFESSIONAL_VIEWS.includes(value.view)||typeof value.search!=='string'||value.search.length>300||typeof value.selectedId!=='string'||(value.selectedId&&!professionalUuid.test(value.selectedId)))return null;
  if(!value.positions||typeof value.positions!=='object'||Array.isArray(value.positions)||Object.keys(value.positions).length>300)return null;
  const positions:ProfessionalViewPreferences['positions']={};
  for(const [id,point] of Object.entries(value.positions)){if(!professionalUuid.test(id)||!point||typeof point!=='object')return null;const p=point as Record<string,unknown>;if(typeof p.x!=='number'||typeof p.y!=='number'||!Number.isFinite(p.x)||!Number.isFinite(p.y)||p.x<0||p.x>2000||p.y<0||p.y>2000)return null;positions[id]={x:p.x,y:p.y};}
  const ref=(item:unknown):item is CoordinateFieldReference=>Boolean(item&&typeof item==='object'&&typeof (item as CoordinateFieldReference).key==='string'&&/^[a-zA-Z][a-zA-Z0-9_]{0,119}$/.test((item as CoordinateFieldReference).key)&&professionalUuid.test((item as CoordinateFieldReference).versionId));
  if(value.map!==null&&(!value.map||!professionalUuid.test(value.map.typeId)||!ref(value.map.x)||!ref(value.map.y)||value.map.x.key===value.map.y.key))return null;
  return {version:1,bookId,view:value.view,search:value.search,selectedId:value.selectedId,positions,map:value.map===null?null:{typeId:value.map.typeId,x:{key:value.map.x.key,versionId:value.map.x.versionId},y:{key:value.map.y.key,versionId:value.map.y.versionId}}};
 }catch{return null;}
}
/** Coordinates come only from the explicitly chosen, exact formal fields. Zero is a valid value. */
export function professionalMapPoints(objects:ProfessionalObject[],binding:ProfessionalMapBinding|null){
 if(!binding)return [];
 return objects.flatMap(object=>{
  if(object.typeKey!=='location'||object.typeId!==binding.typeId||object.unavailableReason||!object.versionId)return [];
  const x=object.fields.find(item=>item.field.key===binding.x.key&&item.versionId===binding.x.versionId&&item.field.type==='number'&&!item.field.hidden);
  const y=object.fields.find(item=>item.field.key===binding.y.key&&item.versionId===binding.y.versionId&&item.field.type==='number'&&!item.field.hidden);
  const xv=object.values[binding.x.key],yv=object.values[binding.y.key];
  return x&&y&&typeof xv==='number'&&typeof yv==='number'&&Number.isFinite(xv)&&Number.isFinite(yv)?[{id:object.id,label:object.title,x:xv,y:yv}]:[];
 });
}
export function sortedProfessionalTimings(timings:StoryEventTiming[]){return [...timings].sort((a,b)=>{
 const av=a.normalizedStart,bv=b.normalizedStart;
 return av===null?(bv===null?a.sequence-b.sequence:1):bv===null?-1:av-bv||a.sequence-b.sequence;
});}
