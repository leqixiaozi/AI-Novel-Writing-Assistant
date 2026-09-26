import type {StoryTimeValue,StoryTimeProposal,StoryRelationValue,StoryRelationProposal,StoryNarrativeOccurrence,PlanningMaterialOption,StoryEventTiming,StoryEventRelation} from "../contracts";
// Migration provenance belongs only to existing formal timings, never to author inputs.
export type AuthorTimelineTimeValue=Omit<StoryTimeValue,"evidenceKind">&{evidenceKind:Exclude<StoryTimeValue["evidenceKind"],"migration">};
export type AuthorTimelineCommand=
 |{operation:"time_create";eventCardId:string;value:AuthorTimelineTimeValue}
 |{operation:"time_edit";proposalId:string;expectedRevision:number;value:AuthorTimelineTimeValue}
 |{operation:"time_review";proposalId:string;expectedRevision:number;action:"confirm"|"reject";note:string}
 |{operation:"relation_create";value:StoryRelationValue}
 |{operation:"relation_edit";proposalId:string;expectedRevision:number;value:StoryRelationValue}
 |{operation:"relation_review";proposalId:string;expectedRevision:number;action:"confirm"|"reject";note:string}
 |{operation:"occurrence_create";value:Omit<StoryNarrativeOccurrence,"id"|"bookId"|"sourceTimeProposalVersionId"|"status"|"revision"|"createdAt"|"updatedAt">}
 |{operation:"occurrence_edit";occurrenceId:string;expectedRevision:number;value:Omit<StoryNarrativeOccurrence,"id"|"bookId"|"sourceTimeProposalVersionId"|"status"|"revision"|"createdAt"|"updatedAt">};
export interface AuthorTimelineWorkspace {bookId:string;sourceHash:string;materials:PlanningMaterialOption[];times:StoryTimeProposal[];relations:StoryRelationProposal[];occurrences:StoryNarrativeOccurrence[];timings:StoryEventTiming[];eventRelations:StoryEventRelation[];}
export interface AuthorTimelinePreviewInput {requestKey:string;expectedSourceHash:string;command:AuthorTimelineCommand;candidateSource?:import("../characterExperiences").ExperienceCandidateSource;recentCandidateSource?:import('../characterExperiences/recentBodies').RecentBodyExperienceCandidateSource;}
export interface AuthorTimelinePreview {bookId:string;input:AuthorTimelinePreviewInput;previewHash:string;changes:Array<{label:string;before:string;after:string}>;warnings:string[];}
export interface AuthorTimelineSaveInput extends AuthorTimelinePreviewInput {previewHash:string;}
export interface AuthorTimelineReceipt {bookId:string;requestKey:string;inputHash:string;operation:AuthorTimelineCommand["operation"];result:StoryTimeProposal|StoryRelationProposal|StoryNarrativeOccurrence;repeated:boolean;candidateSource?:import("../characterExperiences").ExperienceCandidateSource;recentCandidateSource?:import('../characterExperiences/recentBodies').RecentBodyExperienceCandidateSource;}
