import type {ResourceFocusApi} from '../../../common/characterResources/focus';
type Request=<T>(path:string,init?:RequestInit)=>Promise<T>;
export function createResourceFocusApi(request:Request):ResourceFocusApi {
 const e=encodeURIComponent,base=(book:string,actor:string)=>`/books/${e(book)}/characters/${e(actor)}/resource-focus`,post=(value:unknown)=>({method:'POST',body:JSON.stringify(value)});
 return{
  previewResourceFocus:(book,actor,selection)=>request(`${base(book,actor)}/preview?${new URLSearchParams({...selection})}`),
  generateResourceFocus:(book,input)=>request(base(book,input.characterId),post(input)),
  readResourceFocusOriginal:(book,input)=>request(`${base(book,input.characterId)}/original-receipt`,post(input)),
  getResourceFocusRecord:(book,actor,key)=>request(`${base(book,actor)}/by-id/${e(key)}`),
  endUnknownResourceFocus:(book,input)=>request(`${base(book,input.characterId)}/end-unknown`,post({confirm:true,input})),
 };
}
