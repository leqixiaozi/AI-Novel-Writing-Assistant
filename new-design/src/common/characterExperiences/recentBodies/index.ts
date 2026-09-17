import type {ExperienceActorSource,ExperienceEventChoice,ExperienceTimeSuggestion} from '..';
import type {AuthorTimelineCommand} from '../../bookComposition/timeline';
export interface RecentBodySelection {characterIds:string[];chapterDocumentIds:string[];}
export interface RecentBodyExperienceRequest extends RecentBodySelection {requestKey:string;instruction:string;expectedSourceHash:string;}
export interface RecentBodySource {documentId:string;chapterCardId:string;revision:number;title:string;logicalOrder:number;bodyVersionId:string;contentHash:string;content:string;planningVersion:Record<string,unknown>|null;sourceRoute:string;}
export interface RecentBodyExperienceSnapshot {contract:'character_recent_body_experiences_v1';bookId:string;bookName:string;actors:ExperienceActorSource[];bodies:RecentBodySource[];events:ExperienceEventChoice[];timeline:Record<string,unknown>;}
export interface RecentBodyExperiencePreview {snapshot:RecentBodyExperienceSnapshot;sourceHash:string;}
export interface RecentBodyExperienceWorkspace {bookId:string;characterId:string;characters:Array<{id:string;title:string}>;chapters:Array<Omit<RecentBodySource,'content'|'planningVersion'>>;events:ExperienceEventChoice[];eventTypeId:string|null;truncated:boolean;}
export interface RecentBodyExperienceCandidate {id:string;characterId:string;chapterDocumentId:string;bodyVersionId:string;title:string;summary:string;evidenceStart:number;evidenceEnd:number;evidenceLabel:string;suggestedEventId:string|null;narrativeRole:'mention'|'scene'|'reveal'|'retell'|'flashback'|'flashforward';time:Omit<ExperienceTimeSuggestion,'lifecycle'>&{lifecycle:'planned'|'occurred'};}
export interface RecentBodyExperienceOutput {candidates:RecentBodyExperienceCandidate[];notes:string[];}
export interface RecentBodyExperienceRecord {id:string;bookId:string;request:RecentBodyExperienceRequest;status:string;stage:string;error:string;snapshot:RecentBodyExperienceSnapshot;output:RecentBodyExperienceOutput|null;createdAt:string;sourceRoute:string;}
export interface RecentBodyExperienceCandidateSource {contract:'character_recent_body_candidate_v1';batchId:string;candidateId:string;characterId:string;sourceHash:string;}
export interface RecentBodyExperienceDraft {source:RecentBodyExperienceCandidateSource;command:AuthorTimelineCommand;title:string;summary:string;evidence:string;sourceRoute:string;bodySourceRoute:string;}
export * from './schema';
