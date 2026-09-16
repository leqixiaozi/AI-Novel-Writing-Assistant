import {z} from "zod";
import type {AiRuntimeRecovery} from "../aiRuntime";
import type {ChapterWritingWorkspace,PlanningCenterWorkspace,BookSummary} from "../contracts";
export {originalChapterCandidateContent} from './candidate';
export const directorPolicySchema=z.enum(["completion_first","quality_first"]);
export const chapterKnowledgeSelectionSchema=z.object({assetId:z.string().uuid(),sourceVersionId:z.string().uuid(),parsedVersionId:z.string().uuid(),checksum:z.string().regex(/^[a-f0-9]{64}$/)}).strict();
export type ChapterKnowledgeSelection=z.infer<typeof chapterKnowledgeSelectionSchema>;
export const directorCreateSchema=z.object({requestKey:z.string().uuid(),chapters:z.array(z.object({planningObjectId:z.string().uuid(),planningVersionId:z.string().uuid(),expectedPlanningRevision:z.number().int().positive(),chapterCardId:z.string().uuid()}).strict()).min(1).max(500),instruction:z.string().max(4000),issuePolicy:directorPolicySchema,knowledgeSources:z.array(chapterKnowledgeSelectionSchema).max(20).optional()}).strict();
export const directorCommandSchema=z.object({requestKey:z.string().uuid(),expectedRevision:z.number().int().positive(),action:z.enum(["run","pause","resume","retry_failed","end_expired","cancel"])}).strict();
export type DirectorCreateInput=z.infer<typeof directorCreateSchema>;
export type DirectorCommand=z.infer<typeof directorCommandSchema>;
export type DirectorStatus="ready"|"running"|"paused"|"waiting_recovery"|"failed"|"completed"|"cancelled";
export interface DirectorChapter {planningObjectId:string;planningVersionId:string;expectedPlanningRevision:number;chapterCardId:string;title:string;requestId:string|null;documentId:string|null;bodyVersionId:string|null;modelResultSaved:boolean;ledgerPending:boolean;boundaryPending:boolean;unclaimed:boolean;leaseExpired:boolean;decision:ChapterGenerationOutput['decision']|null;status:"pending"|"running"|"candidate_saved"|"failed"|"unknown";warnings:string[];failure:AiRuntimeRecovery|null;}
export interface DirectorRun {id:string;bookId:string;requestKey:string;revision:number;status:DirectorStatus;issuePolicy:z.infer<typeof directorPolicySchema>;instruction:string;knowledgeSources:ChapterKnowledgeSelection[];pauseRequested:boolean;chapters:DirectorChapter[];sourceRoute:string;failure:AiRuntimeRecovery|null;leaseExpired:boolean;createdAt:string;}
export interface DirectorWorkspace {bookId:string;book:BookSummary;planning:PlanningCenterWorkspace;writing:ChapterWritingWorkspace;runs:DirectorRun[];}
export interface DirectorReceipt {run:DirectorRun;requestKey:string;action:"create"|DirectorCommand["action"];repeated:boolean;}
export interface ChapterGenerationOutput {content:string;decision:"continue"|"continue_with_warning"|"pause_for_manual"|"stop_for_replan";warnings:string[];reason:string;}
export interface SavedChapterWritingReply {requestId:string;bookId:string;chapterDocumentId:string;chapterCardId:string;inputBodyVersionId:string|null;expectedDocumentRevision:number;replyHash:string;sourceStatus:'database'|'local_receipt';content:string;decision:ChapterGenerationOutput['decision'];warnings:string[];reason:string;}
/** Only structured decisions can stop the chain; local quality debt does not become global failure. */
export function directorBoundaryDecision(policy:DirectorRun["issuePolicy"],output:ChapterGenerationOutput):"continue"|"pause"|"replan" {
  if(output.decision==="stop_for_replan")return "replan";
  return policy==="quality_first"&&output.decision==="pause_for_manual"?"pause":"continue";
}
