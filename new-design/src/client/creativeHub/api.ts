import type {CreativeHubBinding,CreativeHubCapability,CreativeHubState,CreativeHubThread,CreativeHubTurn,CreativeHubTurnRequest} from '../../common/creativeHub';
type Request=<T>(path:string,init?:RequestInit)=>Promise<T>;
export interface CreativeHubApi {
  capability():Promise<CreativeHubCapability>;
  list(includeArchived?:boolean):Promise<CreativeHubThread[]>;
  create(input:{title:string;binding:CreativeHubBinding}):Promise<CreativeHubThread>;
  update(id:string,input:{title?:string;binding?:CreativeHubBinding;expectedRevision:number}):Promise<CreativeHubThread>;
  archive(id:string,expectedRevision:number):Promise<CreativeHubThread>;
  restore(id:string,expectedRevision:number):Promise<CreativeHubThread>;
  state(id:string):Promise<CreativeHubState>;
  history(id:string):Promise<CreativeHubTurn[]>;
  start(id:string,input:CreativeHubTurnRequest):Promise<{turn:CreativeHubTurn;repeated:boolean}>;
  resume(id:string,turnId:string):Promise<CreativeHubTurn>;
}
export function createCreativeHubApi(request:Request):CreativeHubApi{const e=encodeURIComponent;return{
  capability:()=>request<CreativeHubCapability>('/creative-hub/capability'),
  list:(includeArchived=false)=>request<CreativeHubThread[]>(`/creative-hub/threads${includeArchived?'?includeArchived=true':''}`),
  create:input=>request<CreativeHubThread>('/creative-hub/threads',{method:'POST',body:JSON.stringify(input)}),
  update:(id,input)=>request<CreativeHubThread>(`/creative-hub/threads/${e(id)}`,{method:'PATCH',body:JSON.stringify(input)}),
  archive:(id,expectedRevision)=>request<CreativeHubThread>(`/creative-hub/threads/${e(id)}`,{method:'DELETE',body:JSON.stringify({expectedRevision})}),
  restore:(id,expectedRevision)=>request<CreativeHubThread>(`/creative-hub/threads/${e(id)}/restore`,{method:'POST',body:JSON.stringify({expectedRevision})}),
  state:id=>request<CreativeHubState>(`/creative-hub/threads/${e(id)}/state`),
  history:id=>request<CreativeHubTurn[]>(`/creative-hub/threads/${e(id)}/history`),
  start:(id,input)=>request<{turn:CreativeHubTurn;repeated:boolean}>(`/creative-hub/threads/${e(id)}/turns`,{method:'POST',body:JSON.stringify(input)}),
  resume:(id,turnId)=>request<CreativeHubTurn>(`/creative-hub/threads/${e(id)}/turns/${e(turnId)}/resume`,{method:'POST',body:'{}'}),
};}
