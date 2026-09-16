export const KNOWLEDGE_MAX_BYTES=2*1024*1024;
export interface PreparedKnowledgeFile {checksum:string;byteSize:number;locator:string;text:string;mimeType:string}
export interface KnowledgeWriteInput {requestKey:string;expectedRevision:number}
export interface KnowledgeUploadInput {requestKey:string;filename:string;title:string;contentBase64:string}
export interface KnowledgeOwnerChoice {kind:"book"|"card_version"|"chapter_body_version"|"ai_task_attempt";stableId:string;versionId:string;label:string}
export interface KnowledgeBindInput extends KnowledgeWriteInput {owner:KnowledgeOwnerChoice}
export interface KnowledgeArchiveInput extends KnowledgeWriteInput {previewHash:string;reason:string}
export interface KnowledgeReferenceItem {id:string;versionId:string;revision:number;title:string;filename:string;checksum:string;byteSize:number;status:"pending"|"ready"|"failed"|"stale"|"archived";parsedVersionId:string|null;derivationRevision:number;failure:string|null;parseAvailable?:boolean;recoveryReason?:string|null;bindings:Array<{id:string;owner:KnowledgeOwnerChoice;status:"active"|"ended"}>}
export interface KnowledgeWorkspace {bookId:string;bookLabel:string;items:KnowledgeReferenceItem[];owners:KnowledgeOwnerChoice[];capabilities:{textParsing:true;keywordSearch:true;vectorSearch:boolean;vectorReason:string;settingsRoute:string};truncated:boolean}
export interface KnowledgeSearchResult {items:Array<{assetId:string;title:string;parsedVersionId:string;excerpt:string}>;mode:"keyword";truncated:boolean}
export interface KnowledgeArchivePreview {assetId:string;revision:number;previewHash:string;impacts:Array<{id:string;label:string;state:string}>;truncated:boolean}
export interface KnowledgeWriteReceipt {bookId:string;requestKey:string;operation:"upload"|"parse"|"bind"|"archive"|"reference";assetId:string;repeated:boolean;item:KnowledgeReferenceItem;mutationOutcome:"committed";manifestId?:string}
export interface KnowledgeContent {assetId:string;sourceVersionId:string;parsedAssetId:string;parsedVersionId:string;checksum:string;title:string;text:string;offset:number;totalCharacters:number;nextOffset:number|null;truncated:boolean}
export type KnowledgeReferenceCandidate=Omit<KnowledgeContent,"text"|"offset"|"totalCharacters"|"nextOffset"|"truncated">&{excerpt:string;resourceId:string};
export interface KnowledgeReferenceInput {requestKey:string;baseManifestId:string;slotKey:string;sources:Array<{assetId:string;sourceVersionId:string;parsedVersionId:string;checksum:string}>}
export interface KnowledgeReferenceTarget {manifestId:string;label:string;slots:Array<{slotKey:string;label:string;allowsKnowledge:boolean}>}
