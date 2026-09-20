import type {PlanningObject} from '../../common/contracts';
import type {LegacyPlanningPresentation} from './legacyPlanningFields';

const copy={
 story_macro:{level:'story',eyebrow:'第 2 步 · 故事引擎',title:'先讲清楚，这本书靠什么吸引读者',description:'从核心卖点、核心冲突和主悬念开始，再补齐推进循环、成长路径与结局方向。规划先保存为候选，确认采用后才成为后续卷章的依据。',action:'建立故事总览'},
 outline:{level:'volume',eyebrow:'第 5 步 · 卷战略',title:'先确定每一卷的承诺与兑现',description:'明确开卷抓手、主承诺和持续压力，再安排卷末高潮与下卷钩子。只有采用的卷计划会作为后续章节拆分的依据。',action:'建立卷计划'},
 structured:{level:'chapter',eyebrow:'第 6 步 · 节奏与拆章',title:'把卷战略拆成能执行的章节',description:'逐章安排开场、压力转折、本章兑现与章末牵引；章节节奏和正文仍分别保存，不会自动采用候选。',action:'建立章节计划'},
} as const;

export default function PlanningStageIntro({presentation,objects}:{presentation:LegacyPlanningPresentation;objects:PlanningObject[]}){
 const stage=copy[presentation];
 const rows=objects.filter(object=>object.level===stage.level&&object.status==='active');
 const adopted=rows.filter(object=>object.adoptedVersion).length;
 return <section className="nd-planning-stage-intro" aria-label="本阶段创作任务">
  <div><p className="nd-kicker">{stage.eyebrow}</p><h2>{stage.title}</h2><p>{stage.description}</p></div>
  <div className="nd-planning-stage-action"><span>{rows.length?`已采用 ${adopted}/${rows.length} 项`:'尚未建立规划'}</span><a className="nd-button nd-button-primary" href="#plan-editor-title">{rows.length?'继续编辑规划':stage.action}</a></div>
 </section>;
}
