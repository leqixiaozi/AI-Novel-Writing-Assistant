import type {FieldDefinition} from '../contracts';
export function stableDialogueValue(value:unknown):string {if(value===null||typeof value!=='object')return JSON.stringify(value)??'null';if(Array.isArray(value))return `[${value.map(stableDialogueValue).join(',')}]`;return `{${Object.entries(value).filter(([,v])=>v!==undefined).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${JSON.stringify(k)}:${stableDialogueValue(v)}`).join(',')}}`;}
export interface DialogueCheckpoint {id:string;bookId:string;chapterDocumentId:string;bodyVersionId:string;settlementId:string;chapterOrder:number;label:string;createdAt:string;dependencyHash:string;}
export interface DialogueActor {cardId:string;cardVersionId:string;typeVersionId:string;label:string;fields:Array<{key:string;label:string;specVersionId:string;specHash:string;specification:FieldDefinition;value:unknown}>;}
export interface DialogueState {id:string;stableObjectId:string;kind:'initial'|'change';subjectKind:'card'|'relation';subjectId:string;fieldKey:string;fieldLabel:string;value:unknown;sourceVersionId:string;chapterDocumentId:string|null;bodyVersionId:string|null;}
export interface DialogueKnowledge {id:string;proposalId:string;holderCardId:string;claimId:string;proposalVersionId:string;stance:'knows'|'believes'|'suspects'|'misunderstands'|'unknown';label:string;predicate:string;subjectCardId:string|null;subjectLabel:string|null;objectCardId:string|null;objectLabel:string|null;value:unknown;chapterDocumentId:string;bodyVersionId:string;}
export interface DialogueRelation {id:string;versionId:string;sourceCardId:string;targetCardId:string;sourceCardVersionId:string;targetCardVersionId:string;label:string;specHash:string;fields:Array<{key:string;label:string;value:unknown}>;}
export interface DialogueSources {bookId:string;checkpoint:DialogueCheckpoint;actors:DialogueActor[];states:DialogueState[];knowledge:DialogueKnowledge[];relations:DialogueRelation[];warnings:string[];hash:string;}
export interface DialogueCreateInput {requestKey:string;checkpointId:string;participantCardIds:string[];sourceHash:string;situation:string;}
export interface DialoguePublicRound {id:string;actorCardId:string;actorLabel:string;utterance:string;}
export interface DialogueAction {key:string;label:string;constraint:string;reason:string;knowledgeIds:string[];stateIds:string[];}
export function appendDialogueConstraints(value:unknown,actions:DialogueAction[]):{ok:true;constraints:string[]}|{ok:false;message:string}{
 if(!Array.isArray(value)||value.some(v=>typeof v!=='string')||value.length+actions.length>100)return{ok:false,message:'原规划约束格式或100条上限不允许追加，不截断原约束。'};
 if(new Set(actions.map(a=>a.constraint)).size!==actions.length||actions.some(a=>value.includes(a.constraint)))return{ok:false,message:'选择包含重复或已存在的约束，请保留规划历史并只选择新的候选。'};
 return{ok:true,constraints:[...value,...actions.map(a=>a.constraint)]};
}
export interface DialogueRoundOutput {actorCardId:string;utterance:string;actions:DialogueAction[];}
export interface DialogueRoundInput {requestKey:string;expectedSessionRevision:number;sourceHash:string;actorCardId:string;instruction:string;}
export interface DialogueRoundReceipt {id:string;sessionId:string;bookId:string;requestKey:string;requestHash:string;input:DialogueRoundInput;inputHash:string;status:'running'|'succeeded'|'failed'|'stale'|'ended_unknown';modelRequestState:'not_sent'|'sent_unknown'|'completed';output:DialogueRoundOutput|null;modelResultSaved:boolean;canCompleteSavedResult:boolean;canReleaseSavedResult:boolean;canEndExpiredUnknown:boolean;failure:DialogueFailure|null;}
export interface DialogueFailure {failedStep:string;summary:string;savedResult:string;sourceRoute:string;actionLabel:'返回人物对话模拟';mutationOutcome:'unknown'|'not_written';}
export interface DialogueActionSelectionInput {requestKey:string;roundId:string;actionKeys:string[];planningObjectId:string;expectedPlanningRevision:number;planningVersionId:string;sourceHash:string;}
export interface DialogueActionReceipt {sessionId:string;bookId:string;requestKey:string;requestHash:string;input:DialogueActionSelectionInput;planningObjectId:string;planningVersionId:string;}
export interface DialogueSession {id:string;bookId:string;requestKey:string;requestHash:string;input:DialogueCreateInput;revision:number;sources:DialogueSources;isCurrent:boolean;rounds:DialogueRoundReceipt[];selections:DialogueActionReceipt[];}
export interface DialogueWorkspace {bookId:string;checkpoints:DialogueCheckpoint[];participants:Array<{id:string;label:string}>;sources:DialogueSources|null;sessions:DialogueSession[];planningTargets:Array<{id:string;label:string;revision:number;versionId:string}>;}
export interface DialoguePromptInput {contract:'character_dialogue_v1';sessionId:string;roundId:string;checkpoint:DialogueCheckpoint;situation:string;instruction:string;actor:DialogueActor;otherParticipants:Array<{cardId:string;label:string}>;states:DialogueState[];knowledge:DialogueKnowledge[];relations:DialogueRelation[];publicRounds:DialoguePublicRound[];}
export interface DialogueApi {
 getCharacterDialogueWorkspace(bookId:string,query?:{checkpointId?:string;participantCardIds?:string[]}):Promise<DialogueWorkspace>;
 createCharacterDialogueSession(bookId:string,input:DialogueCreateInput):Promise<DialogueSession>;
 getCharacterDialogueSession(bookId:string,sessionId:string):Promise<DialogueSession>;
 getCharacterDialogueSessionByKey(bookId:string,key:string):Promise<DialogueSession|null>;
 runCharacterDialogueRound(bookId:string,sessionId:string,input:DialogueRoundInput):Promise<DialogueRoundReceipt>;
 getCharacterDialogueRoundByKey(bookId:string,sessionId:string,key:string):Promise<DialogueRoundReceipt|null>;
 getCharacterDialogueRound(bookId:string,sessionId:string,id:string):Promise<DialogueRoundReceipt>;
 completeSavedCharacterDialogueRound(bookId:string,sessionId:string,id:string):Promise<DialogueRoundReceipt>;
 releaseSavedCharacterDialogueRound(bookId:string,sessionId:string,id:string):Promise<DialogueRoundReceipt>;
 endExpiredCharacterDialogueRound(bookId:string,sessionId:string,id:string):Promise<DialogueRoundReceipt>;
 selectCharacterDialogueActions(bookId:string,sessionId:string,input:DialogueActionSelectionInput):Promise<DialogueActionReceipt>;
 getCharacterDialogueSelectionByKey(bookId:string,sessionId:string,key:string):Promise<DialogueActionReceipt|null>;
}
