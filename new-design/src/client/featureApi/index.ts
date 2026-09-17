import type {CreativeExtractionApi} from "../../common/creativeExtraction";
import type {ImageGenerationApi} from "../../common/imageGeneration";
import type {WorldConsistencyInput,WorldConsistencyWorkspace,WorldConsistencyReceipt,WorldConsistencyRepairDraft} from "../../common/worldConsistency";
import type {WorldRepairSavedInput,WorldRepairSavedReceipt} from "../../common/worldConsistency";
import type {AuthorMaterialWriteReceipt} from "../../common/authorMaterials";
import type {DirectorFollowupApi} from "../../common/directorFollowup";
import type {ProfessionalViewsWorkspace} from "../../common/professionalViews";
import type {DialogueApi} from "../../common/characterDialogue";

type Request = <T>(path:string,init?:RequestInit)=>Promise<T>;
const encoded=encodeURIComponent;
const post=(input:unknown={}):RequestInit=>({method:"POST",body:JSON.stringify(input)});

/** Shares the central transport, envelope validation and safe recovery handling. */
export function createFeatureApi(request:Request){
 const dialogueBase=(book:string)=>`/books/${encoded(book)}/character-dialogue`;
 const sessionBase=(book:string,session:string)=>`${dialogueBase(book)}/sessions/${encoded(session)}`;
 const characterDialogue:DialogueApi={
  getCharacterDialogueWorkspace:(book,query={})=>{const params=new URLSearchParams();if(query.checkpointId)params.set("checkpointId",query.checkpointId);if(query.participantCardIds)params.set("participantCardIds",query.participantCardIds.join(","));return request(`${dialogueBase(book)}/workspace?${params}`);},
  createCharacterDialogueSession:(book,input)=>request(`${dialogueBase(book)}/sessions`,post(input)),
  getCharacterDialogueSession:(book,session)=>request(sessionBase(book,session)),
  getCharacterDialogueSessionByKey:(book,key)=>request(`${dialogueBase(book)}/sessions/by-key/${encoded(key)}`),
  runCharacterDialogueRound:(book,session,input)=>request(`${sessionBase(book,session)}/rounds`,post(input)),
  getCharacterDialogueRoundByKey:(book,session,key)=>request(`${sessionBase(book,session)}/rounds/by-key/${encoded(key)}`),
  getCharacterDialogueRound:(book,session,id)=>request(`${sessionBase(book,session)}/rounds/${encoded(id)}`),
  completeSavedCharacterDialogueRound:(book,session,id)=>request(`${sessionBase(book,session)}/rounds/${encoded(id)}/complete-saved`,post()),
  releaseSavedCharacterDialogueRound:(book,session,id)=>request(`${sessionBase(book,session)}/rounds/${encoded(id)}/release-saved`,post()),
  endExpiredCharacterDialogueRound:(book,session,id)=>request(`${sessionBase(book,session)}/rounds/${encoded(id)}/end-expired-unknown`,post()),
  selectCharacterDialogueActions:(book,session,input)=>request(`${sessionBase(book,session)}/selections`,post(input)),
  getCharacterDialogueSelectionByKey:(book,session,key)=>request(`${sessionBase(book,session)}/selections/by-key/${encoded(key)}`),
 };
 const directorFollowup:DirectorFollowupApi={
  workspace:input=>request(`/director-followup/workspace?${new URLSearchParams(Object.entries(input).filter(([,value])=>value!==undefined).map(([key,value])=>[key,String(value)]))}`),
  detail:(kind,id)=>request(`/director-followup/records/${encoded(kind)}/${encoded(id)}`),
 };
 const creativeExtraction:CreativeExtractionApi={
  catalog:book=>request(`/creative-extraction/catalog/${encoded(book)}`),
  prepare:input=>request("/creative-extraction/previews",post(input)),
  byKey:key=>request(`/creative-extraction/by-key/${encoded(key)}`),
  read:id=>request(`/creative-extraction/${encoded(id)}`),
  run:(id,input)=>request(`/creative-extraction/${encoded(id)}/run`,post(input)),
  complete:id=>request(`/creative-extraction/${encoded(id)}/complete-saved`,post()),
  command:(id,input)=>request(`/creative-extraction/${encoded(id)}/commands`,post(input)),
  receipt:key=>request(`/creative-extraction/commands/by-key/${encoded(key)}`),
 };
 const imageGeneration:ImageGenerationApi={
  catalog:book=>request(`/books/${encoded(book)}/image-generation/catalog`),
  generate:input=>request(`/books/${encoded(input.bookId)}/image-generation/requests`,post(input)),
  byKey:(book,key)=>request(`/books/${encoded(book)}/image-generation/by-key/${encoded(key)}`),
  result:id=>request(`/image-generation/requests/${encoded(id)}/result`),
  completeSaved:id=>request(`/image-generation/requests/${encoded(id)}/complete-saved`,post()),
  endExpired:id=>request(`/image-generation/requests/${encoded(id)}/end-expired`,post()),
  connectionCatalog:()=>request("/models/image-generation/catalog"),
  saveConnection:input=>request("/models/image-generation/connections",post(input)),
  connectionReceipt:key=>request(`/models/image-generation/connections/by-request/${encoded(key)}`),
 };
 const base=(book:string)=>`/books/${encoded(book)}/world-consistency`;
 return {
  creativeExtraction,imageGeneration,directorFollowup,characterDialogue,
  getProfessionalViewsWorkspace:(book:string)=>request<ProfessionalViewsWorkspace>(`/books/${encoded(book)}/professional-views/workspace`),
  getWorldConsistencyWorkspace:(book:string)=>request<WorldConsistencyWorkspace>(`${base(book)}/workspace`),
  runWorldConsistency:(book:string,input:WorldConsistencyInput)=>request<WorldConsistencyReceipt>(`${base(book)}/runs`,post(input)),
  getWorldConsistencyByKey:(book:string,key:string)=>request<WorldConsistencyReceipt|null>(`${base(book)}/by-key/${encoded(key)}`),
  getWorldConsistencyResult:(book:string,id:string)=>request<WorldConsistencyReceipt>(`${base(book)}/runs/${encoded(id)}`),
  importSavedWorldConsistency:(book:string,id:string)=>request<WorldConsistencyReceipt>(`${base(book)}/runs/${encoded(id)}/import-saved`,post()),
  releaseSavedWorldConsistency:(book:string,id:string)=>request<WorldConsistencyReceipt>(`${base(book)}/runs/${encoded(id)}/release-saved`,post()),
  endExpiredUnknownWorldConsistency:(book:string,id:string)=>request<WorldConsistencyReceipt>(`${base(book)}/runs/${encoded(id)}/end-expired-unknown`,post()),
  getWorldConsistencyRepairDraft:(book:string,id:string)=>request<WorldConsistencyRepairDraft>(`${base(book)}/repairs/${encoded(id)}/draft`),
  getWorldRepairNormalSaveReceipt:(book:string,id:string)=>request<AuthorMaterialWriteReceipt|null>(`${base(book)}/repairs/${encoded(id)}/normal-save-receipt`),
  recordWorldRepairSaved:(book:string,id:string,input:WorldRepairSavedInput)=>request<WorldRepairSavedReceipt>(`${base(book)}/repairs/${encoded(id)}/saved`,post(input)),
  getWorldRepairSavedReceipt:(book:string,id:string,key:string)=>request<WorldRepairSavedReceipt|null>(`${base(book)}/repairs/${encoded(id)}/saved/by-key/${encoded(key)}`),
 };
}
