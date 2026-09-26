import type {FormAssistSnapshot} from '../formAssist';
import type {AuthorTimelineTimeValue,AuthorTimelineCommand} from '../bookComposition/timeline';
export interface ExperienceRequest {requestKey:string;instruction:string;sources:Array<{characterId:string;fieldKey:string;sourceHash?:string}>;}
export interface ExperienceSeriesInput {characterIds:string[];fieldKey:string;}
export interface ExperienceSeriesSources {bookId:string;sources:Array<{characterId:string;fieldKey:string;sourceHash:string}>;}
export interface ExperienceEventChoice {id:string;versionId:string;title:string;}
export interface ExperienceActorSource {id:string;title:string;versionId:string;revision:number;fieldKey:string;fieldLabel:string;text:string;form:FormAssistSnapshot;slotIds:string[];}
export interface ExperienceSnapshot {bookId:string;bookName:string;instruction:string;actors:ExperienceActorSource[];events:ExperienceEventChoice[];}
export type ExperienceTimeSuggestion=Omit<AuthorTimelineTimeValue,'evidenceKind'|'chapterDocumentId'|'bodyVersionId'|'textAnchorId'|'factId'|'planVersionId'|'stateProposalId'>;
export interface ExperienceCandidate {id:string;characterId:string;fieldKey:string;title:string;summary:string;evidenceStart:number;evidenceEnd:number;evidenceLabel:string;suggestedEventId:string|null;time:ExperienceTimeSuggestion;}
export interface ExperienceOutput {candidates:ExperienceCandidate[];notes:string[];}
export interface ExperienceRecord {id:string;bookId:string;request:ExperienceRequest;status:string;stage:string;error:string;snapshot:ExperienceSnapshot;output:ExperienceOutput|null;createdAt:string;}
export interface ExperienceWorkspace {bookId:string;characterId:string;characterName:string;sourceFields:Array<{key:string;label:string;text:string}>;characters:Array<{id:string;title:string}>;events:ExperienceEventChoice[];eventTypeId:string|null;truncated:boolean;}
export interface ExperienceCandidateSource {batchId:string;candidateId:string;characterId:string;sourceHash:string;}
export interface ExperienceDraft {source:ExperienceCandidateSource;command:AuthorTimelineCommand;title:string;summary:string;evidence:string;sourceRoute:string;}
