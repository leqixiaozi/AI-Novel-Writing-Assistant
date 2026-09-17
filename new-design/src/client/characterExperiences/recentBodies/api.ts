import type {RecentBodySelection,RecentBodyExperienceRequest,RecentBodyExperiencePreview,RecentBodyExperienceWorkspace,RecentBodyExperienceRecord,RecentBodyExperienceDraft} from '../../../common/characterExperiences/recentBodies';
type Request=<T>(path:string,init?:RequestInit)=>Promise<T>;
export function createRecentBodyExperienceApi(request:Request){const e=encodeURIComponent,base=(book:string)=>`/books/${e(book)}/character-experiences/recent-bodies`,post=(input:unknown)=>({method:'POST',body:JSON.stringify(input)});return{
 workspace:(book:string,actor:string)=>request<RecentBodyExperienceWorkspace>(`${base(book)}/workspace?characterId=${e(actor)}`),
 preview:(book:string,input:RecentBodySelection)=>request<RecentBodyExperiencePreview>(`${base(book)}/preview`,post(input)),
 generate:(book:string,input:RecentBodyExperienceRequest)=>request<RecentBodyExperienceRecord>(base(book),post(input)),
 original:(book:string,input:RecentBodyExperienceRequest)=>request<RecentBodyExperienceRecord|null>(`${base(book)}/original-receipt`,post(input)),
 record:(book:string,id:string)=>request<RecentBodyExperienceRecord|null>(`${base(book)}/by-id/${e(id)}`),
 draft:(book:string,batch:string,candidate:string,eventId:string)=>request<RecentBodyExperienceDraft>(`${base(book)}/${e(batch)}/candidates/${e(candidate)}/draft`,post({eventId})),
 endUnknown:(book:string,input:RecentBodyExperienceRequest)=>request<RecentBodyExperienceRecord>(`${base(book)}/end-unknown`,post({confirm:true,input})),
};}
