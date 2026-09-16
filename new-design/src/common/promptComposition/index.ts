import type {BookCreationMethod,PlanningLevel,CardTypeSummary,FieldDefinition,CardSummary,BookSummary} from "../contracts";
import {MODEL_TASKS,type ManagedTaskRoute} from "../modelRouting";
import type {PromptCatalog} from "../promptManagement";
import type {AiRuntimeRecovery as Recovery} from "../aiRuntime";

// A new production task does not automatically acquire a supported debug input contract.
export const COMPOSITION_TASK_KEYS=["directions","initial_content","form_assist","market_analysis","book_analysis","planning_candidate"] as const;
export type CompositionTaskKey=(typeof COMPOSITION_TASK_KEYS)[number];
export const COMPOSITION_TASKS=MODEL_TASKS.filter((task):task is Extract<(typeof MODEL_TASKS)[number],{key:CompositionTaskKey}>=>
  (COMPOSITION_TASK_KEYS as readonly string[]).includes(task.key));

export interface CompositionVariable {key:string;label:string;type:"text"|"number"|"boolean"|"select";options:string[];defaultValue:string|number|boolean;}
export interface CompositionBinding {cardId:string;versionId:string;enabled:boolean;}
export interface CompositionContext {bookId:string|null;sources:Array<{cardId:string;versionId:string;role:"formal"|"reference"}>;}
export interface CompositionSettings {taskType:CompositionTaskKey;components:CompositionBinding[];variables:CompositionVariable[];context:CompositionContext;}
export interface CompositionRecipe extends CompositionSettings {id:string;name:string;description:string;revision:number;versionId:string;version:number;publishedVersionId:string|null;editable:boolean;configurationIssue:string|null;}
export interface SaveCompositionInput extends CompositionSettings {id:string|null;expectedRevision:number|null;name:string;description:string;idempotencyKey:string;}
export interface SaveCompositionResult {recipe:CompositionRecipe;savedVersionId:string;savedVersion:number;active:boolean;repeated:boolean;}
export interface CompositionCatalog {recipes:CompositionRecipe[];prompts:Omit<PromptCatalog,"components">&{components:Array<CardSummary&{currentVersionId:string}>};books:BookSummary[];types:Array<CardTypeSummary&{fields:FieldDefinition[]}>;rankingSnapshots:Array<{id:string;label:string}>;}
export interface CompositionSources {bookId:string;cards:Array<CardSummary&{currentVersionId:string}>;truncated:boolean;}
export interface DebugParameters {
  instruction:string;sourceText:string;sourceReference:string;method:BookCreationMethod;
  schemaTypeIds:string[];
  direction:{title:string;premise:string;protagonist:string;centralConflict:string;readerPromise:string;styleKeywords:string[]};
  planning:{level:PlanningLevel;title:string};
  analysis:{purpose:"reference_learning"|"continuation"|"diagnosis";preset:"quick"|"standard"|"full";dimensions:string[]};
  rankingSnapshotIds:string[];
}
export interface DebugPreviewInput {recipeId:string;recipeVersionId:string;parameters:DebugParameters;variableValues:Record<string,string|number|boolean>;idempotencyKey:string;}
export interface CompositionDebugPreview {
  id:string;recipeId:string;recipeVersionId:string;recipeVersion:number;taskType:CompositionTaskKey;bookId:string;revision:number;
  status:"ready"|"blocked"|"stale"|"submitted";messages:Array<{role:"system"|"user";content:string}>;
  outputSchema:Record<string,unknown>;assetId:string;assetVersion:string;previewHash:string;
  components:Array<{cardId:string;versionId:string;title:string;enabled:boolean}>;
  sources:Array<{cardId:string;versionId:string;title:string;role:"formal"|"reference"}>;
  variables:Array<{label:string;value:string|number|boolean}>;route:ManagedTaskRoute|null;recovery:Recovery|null;
  blockers:string[];estimatedInputUnits:number;taskId:string|null;createdAt:string;
}
export interface CompositionDebugResult {previewId:string;taskId:string;status:"running"|"succeeded"|"failed";output:unknown|null;modelSnapshot:Record<string,unknown>|null;failure:Recovery|null;usageRecorded:boolean;repeated:boolean;}
export const DEFAULT_DEBUG_PARAMETERS:DebugParameters={instruction:"",sourceText:"",sourceReference:"",method:"idea",schemaTypeIds:[],direction:{title:"",premise:"",protagonist:"",centralConflict:"",readerPromise:"",styleKeywords:[]},planning:{level:"story",title:""},analysis:{purpose:"diagnosis",preset:"standard",dimensions:["story_structure"]},rankingSnapshotIds:[]};
export const COMPOSITION_ROUTE="/new-design/resources/ai/prompt-composition";
