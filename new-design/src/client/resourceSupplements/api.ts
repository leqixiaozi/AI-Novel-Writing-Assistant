import type {ResourceSupplementApi} from '../../common/resourceSupplements/api';
type Request=<T>(path:string,init?:RequestInit)=>Promise<T>;
export function createResourceSupplementApi(request:Request):ResourceSupplementApi{
 const e=encodeURIComponent,base=(book:string)=>`/books/${e(book)}/resource-supplements`,session=(book:string,id:string)=>`${base(book)}/sessions/${e(id)}`;
 const input=(value:unknown)=>`?input=${e(JSON.stringify(value))}`,post=(value:unknown)=>({method:'POST',body:JSON.stringify(value)});
 return {
  getResourceSupplementChapterBasis:(book,document)=>request(`${base(book)}/chapters/${e(document)}`),
  listResourceSupplementIssues:(book,character)=>request(`${base(book)}/characters/${e(character)}/issues`),
  getResourceSupplementIssueSource:(book,issue)=>request(`${base(book)}/issues/${e(issue)}`),
  getResourceSupplementSource:(book,id)=>request(`${session(book,id)}/source`),
  previewResourceSupplement:(book,value)=>request(`${base(book)}/preview${input(value)}`),
  startResourceSupplement:(book,value)=>request(base(book),post(value)),
  readResourceSupplementStartOriginal:(book,value)=>request(`${base(book)}/original${input(value)}`),
  previewResourceSupplementCorrection:(book,value)=>request(`${base(book)}/corrections/preview${input(value)}`),
  startResourceSupplementCorrection:(book,value)=>request(`${base(book)}/corrections`,post(value)),
  readResourceSupplementCorrectionStartOriginal:(book,value)=>request(`${base(book)}/corrections/original${input(value)}`),
  previewResourceSupplementImpact:(book,id)=>request(`${session(book,id)}/impact`),
  confirmResourceSupplementImpact:(book,id,value)=>request(`${session(book,id)}/impact-reviews`,post(value)),
  readResourceSupplementImpactOriginal:(book,id,value)=>request(`${session(book,id)}/impact-original${input(value)}`),
  commitResourceSupplement:(book,id,value)=>request(`${session(book,id)}/commit`,post(value)),
  readResourceSupplementCommitOriginal:(book,id,value)=>request(`${session(book,id)}/commit-original${input(value)}`),
  commitResourceSupplementCorrection:(book,id,value)=>request(`${session(book,id)}/correction-commit`,post(value)),
  readResourceSupplementCorrectionCommitOriginal:(book,id,value)=>request(`${session(book,id)}/correction-commit-original${input(value)}`),
 };
}
