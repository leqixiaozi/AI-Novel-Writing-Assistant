import type {BookTaskNavKey} from '../navigation';
export const BOOK_WORKFLOW_STEPS=[
 {label:'项目设定',path:'setting',pages:['direction']},
 {label:'故事宏观规划',path:'planning?stage=story_macro',pages:['planning']},
 {label:'世界观准备',path:'story-setting?tab=world',pages:['world']},
 {label:'角色准备',path:'story-setting?tab=characters',pages:['story-setting','characters','character-dialogue','visual-assets']},
 {label:'卷战略 / 卷骨架',path:'planning?stage=outline',pages:[]},
 {label:'节奏 / 拆章',path:'planning?stage=structured',pages:['composition']},
 {label:'章节执行',path:'writing',pages:['writing']},
 {label:'质量修复',path:'views/quality',pages:[]},
] as const;
export function currentBookWorkflowStep(active:BookTaskNavKey,query:URLSearchParams,pathname:string){
 if(active==='planning'&&query.get('stage')==='outline')return 4;
 if(active==='planning'&&query.get('stage')==='structured')return 5;
 if(active==='story-setting')return query.get('tab')==='world'?2:3;
 if(active==='planning')return query.get('tab')==='chapters'&&query.get('scope')==='book'?4:1;
 if(active==='views'&&pathname.endsWith('/quality'))return 7;
 return BOOK_WORKFLOW_STEPS.findIndex(step=>(step.pages as readonly string[]).includes(active));
}
