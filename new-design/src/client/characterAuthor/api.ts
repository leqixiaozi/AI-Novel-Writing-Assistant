import type {CharacterAuthorInput,CharacterAuthorResult,CharacterAuthorWorkspace} from '../../common/characterAuthor';
export function createCharacterAuthorApi(request:<T>(path:string,init?:RequestInit)=>Promise<T>){const base='/character-author',post=(input:unknown)=>({method:'POST',body:JSON.stringify(input)});return{
 workspace:(bookId:string,cardId:string,cutoffBodyVersionId:string|null)=>request<CharacterAuthorWorkspace>(`${base}/workspace?${new URLSearchParams({bookId,cardId,...(cutoffBodyVersionId?{cutoffBodyVersionId}:{})})}`),
 run:(input:CharacterAuthorInput)=>request<CharacterAuthorResult>(`${base}/requests`,post(input)),
 byKey:(key:string)=>request<CharacterAuthorResult|null>(`${base}/by-key/${encodeURIComponent(key)}`),
 complete:(id:string)=>request<CharacterAuthorResult>(`${base}/${id}/complete`,post({})),
 endExpired:(id:string)=>request<CharacterAuthorResult>(`${base}/${id}/end-expired`,post({}))
};}
