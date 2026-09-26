import type {CharacterAuthorInput,CharacterAuthorResult,CharacterAuthorWorkspace} from '../../common/characterAuthor';
import type {CharacterAuthorInfluenceCommand,characterAuthorInfluenceWorkspaceSchema,characterAuthorInfluenceReceiptSchema} from '../../common/characterAuthor';
import type {z} from 'zod';
export function createCharacterAuthorApi(request:<T>(path:string,init?:RequestInit)=>Promise<T>){const base='/character-author',post=(input:unknown)=>({method:'POST',body:JSON.stringify(input)});return{
 workspace:(bookId:string,cardId:string,cutoffBodyVersionId:string|null)=>request<CharacterAuthorWorkspace>(`${base}/workspace?${new URLSearchParams({bookId,cardId,...(cutoffBodyVersionId?{cutoffBodyVersionId}:{})})}`),
 run:(input:CharacterAuthorInput)=>request<CharacterAuthorResult>(`${base}/requests`,post(input)),
 byKey:(key:string)=>request<CharacterAuthorResult|null>(`${base}/by-key/${encodeURIComponent(key)}`),
 complete:(id:string)=>request<CharacterAuthorResult>(`${base}/${id}/complete`,post({})),
 endExpired:(id:string)=>request<CharacterAuthorResult>(`${base}/${id}/end-expired`,post({})),
 influences:(bookId:string,cardId:string)=>request<z.infer<typeof characterAuthorInfluenceWorkspaceSchema>>(`${base}/influences/workspace?${new URLSearchParams({bookId,cardId})}`),
 decideInfluence:(input:CharacterAuthorInfluenceCommand)=>request<z.infer<typeof characterAuthorInfluenceReceiptSchema>>(`${base}/influences/decisions`,post(input)),
 influenceDecision:(bookId:string,cardId:string,requestKey:string)=>request<z.infer<typeof characterAuthorInfluenceReceiptSchema>|null>(`${base}/influences/decisions/${encodeURIComponent(requestKey)}?${new URLSearchParams({bookId,cardId})}`)
};}
