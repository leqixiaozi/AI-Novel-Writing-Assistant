import type {StoryFormat} from '../storyFormat';
import type {BookClassification} from '../bookClassification';
import type {HomeBookFact,HomeCreationDraft} from '../home';
import type {AuthorTaskPage} from '../authorTasks';
import type {AiUsageSummary,BackgroundRuntimeHealth} from '../contracts';
export interface ShelfCover {assetId:string;versionId:string;title:string;integrity:string;}
export interface ShelfBook extends HomeBookFact {storyFormat?:StoryFormat|null;classification?:BookClassification;classificationIssue?:string|null;revision:number;cover:ShelfCover|null;wordCount:number;candidateCount:number;firstChapterId:string|null;lastChapterCardId:string|null;}
export interface RecycledBook {id:string;name:string;description:string;revision:number;updatedAt:string;}
export interface BookLifecycle {bookId:string;status:'active'|'archived';revision:number;}
export interface BookLifecycleInput {action:'archive'|'restore';expectedRevision:number;}
export interface BookshelfSnapshot {books:ShelfBook[];recycled:RecycledBook[];drafts:HomeCreationDraft[];readAt:string;}
export type ReadingScope='saved'|'adopted';
export interface ReadingChapter {id:string;cardId:string;title:string;order:number;versionId:string;version:number;wordCount:number;stable:boolean;adopted:boolean;source:string;}
export interface ReadingReview {status:'unreviewed'|'reviewing'|'quality_debt'|'replan_required'|'attention'|'reviewed'|'stale';reportId:string|null;issueCount:number|null;summary:string;}
export interface BookReading {review?:ReadingReview;bookId:string;name:string;scope:ReadingScope;chapters:ReadingChapter[];selected:(ReadingChapter&{content:string;contentHash:string})|null;readAt:string;}
export interface ShelfTextExport {bookId:string;name:string;scope:ReadingScope;chapters:Array<ReadingChapter&{content:string;contentHash:string}>;readAt:string;}
export interface ShelfBookDetail {bookId:string;health?:BackgroundRuntimeHealth;healthReadAt?:string;stageUsage?:Array<{stage:string;label?:string;usage:AiUsageSummary}>;records:AuthorTaskPage;usage:AiUsageSummary;worlds:Array<{id:string;name:string}>;readAt:string;}
export type ShelfFilter='all'|'running'|'attention'|'readable'|'preparing';
export type ShelfSort='updated'|'created'|'progress';
