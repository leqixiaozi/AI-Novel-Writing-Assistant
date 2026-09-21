import type {WorldGenerationCandidateSave,WorldGenerationCapability,WorldGenerationPublishInput,WorldGenerationReceipt,WorldGenerationRegenerateInput,WorldGenerationSession,WorldGenerationStartInput} from '../../common/worldGeneration';

type Request=<T>(path:string,init?:RequestInit)=>Promise<T>;
export interface WorldGenerationApi {
  capability():Promise<WorldGenerationCapability>;
  list():Promise<WorldGenerationSession[]>;
  read(id:string):Promise<WorldGenerationSession>;
  original(requestKey:string):Promise<WorldGenerationSession|null>;
  start(input:WorldGenerationStartInput):Promise<{session:WorldGenerationSession;repeated:boolean}>;
  save(id:string,input:WorldGenerationCandidateSave):Promise<{session:WorldGenerationSession;candidate:WorldGenerationSession['candidates'][number];repeated:boolean}>;
  generate(id:string,input:WorldGenerationRegenerateInput):Promise<{session:WorldGenerationSession;candidate:WorldGenerationSession['candidates'][number];repeated:boolean}>;
  publish(id:string,input:WorldGenerationPublishInput):Promise<WorldGenerationReceipt>;
}
export function createWorldGenerationApi(request:Request):WorldGenerationApi{const e=encodeURIComponent,post=(body:unknown)=>({method:'POST',body:JSON.stringify(body)});return{
  capability:()=>request<WorldGenerationCapability>('/world-generation/capability'),
  list:()=>request<WorldGenerationSession[]>('/world-generation/sessions'),
  read:id=>request<WorldGenerationSession>(`/world-generation/sessions/${e(id)}`),
  original:key=>request<WorldGenerationSession|null>(`/world-generation/requests/${e(key)}`),
  start:input=>request<{session:WorldGenerationSession;repeated:boolean}>('/world-generation/sessions',post(input)),
  save:(id,input)=>request(`/world-generation/sessions/${e(id)}/candidates`,post(input)),
  generate:(id,input)=>request(`/world-generation/sessions/${e(id)}/regenerate`,post(input)),
  publish:(id,input)=>request<WorldGenerationReceipt>(`/world-generation/sessions/${e(id)}/publish`,post(input)),
};}
