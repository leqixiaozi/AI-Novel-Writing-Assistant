export const CREATION_DIRECTOR_MODES = ["automatic", "stepwise", "manual"] as const;
export type CreationDirectorMode = typeof CREATION_DIRECTOR_MODES[number];

// A workflow catalogue, not intent routing: content is still prepared by structured AI.
export const CREATION_DIRECTOR_STAGES = [
  {key:"direction",name:"创作方向",typeKeys:[]},
  {key:"project",name:"项目设定与故事方向",typeKeys:["work_contract","story_concept","genre_strategy","progression_mode","writing_config","quality_rule","theme","plotline","goal_task","conflict"]},
  {key:"world",name:"世界设定",typeKeys:["world_overview","world_rule","power_system","race","culture","religion","location","prop"]},
  {key:"characters",name:"人物与势力",typeKeys:["character","organization","arc","secret_truth","clue_evidence","foreshadow"]},
  {key:"skeleton",name:"卷、事件与章节骨架",typeKeys:["volume","event","chapter","scene","plot_beat","suspense_question"]},
] as const;
export type CreationDirectorStage = typeof CREATION_DIRECTOR_STAGES[number]["key"];

export interface CreationDirectorState {
  mode:CreationDirectorMode;
  cursor:number;
  completedStages:CreationDirectorStage[];
  skippedStages:CreationDirectorStage[];
  activeBatchId:string|null;
  leaseUntil:string|null;
}
export interface CreationDirectorCommand {expectedRevision:number;idempotencyKey:string;}
export interface CreationDirectorControl {
  expectedRevision:number;
  idempotencyKey:string;
  mode:CreationDirectorMode;
  cursor?:number;
  takeOver?:boolean;
  directionId?:string;
}
export interface CreationDirectorControlReceipt {
 sessionId:string;requestKey:string;operation:"director_control";repeated:boolean;session:import("./contracts").BookCreationSession;
}
export interface CreationDirectorCommandReceipt {
 sessionId:string;requestKey:string;status:"running"|"review"|"failed";
 session:import("./contracts").BookCreationSession;receipts:import("./creationReviewAi").CreationPreparationReceipt[];
}
export function creationDirectorState(payload:Record<string,unknown>):CreationDirectorState|null {
  const value=payload.creationDirector as Partial<CreationDirectorState>|undefined;
  if(!value||!CREATION_DIRECTOR_MODES.includes(value.mode!)||!Number.isInteger(value.cursor)||value.cursor!<0||value.cursor!>CREATION_DIRECTOR_STAGES.length)return null;
  return {mode:value.mode!,cursor:value.cursor!,completedStages:Array.isArray(value.completedStages)?value.completedStages.filter(key=>CREATION_DIRECTOR_STAGES.some(stage=>stage.key===key)):[],skippedStages:Array.isArray(value.skippedStages)?value.skippedStages.filter(key=>CREATION_DIRECTOR_STAGES.some(stage=>stage.key===key)):[],activeBatchId:value.activeBatchId??null,leaseUntil:value.leaseUntil??null};
}
