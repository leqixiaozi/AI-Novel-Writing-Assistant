import type {BookCompletionWorkspace,PublicationExportRecord,ResearchRecordDetail,ResearchRecordSummary,ResearchRecordVersion,BookResearchAdoptionBatch} from "../contracts";
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export type ResearchSourceSelection={valid:true;recordId:string|null;versionId:string|null}|{valid:false;message:string};
export type ExportSourceSelection={valid:true;requestId:string|null}|{valid:false;message:string};
export type ResearchAdoptionSourceSelection={valid:true;bookId:string|null;adoptionId:string|null}|{valid:false;message:string};
function uuidParameter(params:URLSearchParams,key:string):{valid:boolean;value:string|null}{
 const values=params.getAll(key);if(!values.length)return{valid:true,value:null};
 return values.length===1&&UUID.test(values[0])?{valid:true,value:values[0].toLowerCase()}:{valid:false,value:null};
}
export function parseResearchSourceSelection(search:string):ResearchSourceSelection {
 const params=new URLSearchParams(search),record=uuidParameter(params,"record"),version=uuidParameter(params,"version");
 if(!record.valid||!version.valid||version.value&&!record.value)return{valid:false,message:"研究来源链接无效，请从原运行记录打开对应记录与版本。"};
 return{valid:true,recordId:record.value,versionId:version.value};
}
export function parseExportSourceSelection(search:string):ExportSourceSelection {
 const request=uuidParameter(new URLSearchParams(search),"export");
 return request.valid?{valid:true,requestId:request.value}:{valid:false,message:"导出来源链接无效，请从原运行记录打开对应导出回执。"};
}
export function parseResearchAdoptionSourceSelection(search:string):ResearchAdoptionSourceSelection {
 const params=new URLSearchParams(search),book=uuidParameter(params,"book"),adoption=uuidParameter(params,"adoption");
 if(!book.valid||!adoption.valid||adoption.value&&!book.value)return{valid:false,message:"研究采用来源链接无效，请从原运行记录打开对应书籍与批次。"};
 return{valid:true,bookId:book.value,adoptionId:adoption.value};
}
export function findResearchAdoptionSource(items:BookResearchAdoptionBatch[],bookId:string,source:ResearchAdoptionSourceSelection):BookResearchAdoptionBatch|null {
 if(!source.valid||source.bookId!==bookId||!source.adoptionId)return null;
 return items.find(item=>item.id===source.adoptionId&&item.bookId===bookId)??null;
}
export function findResearchSourceRecord(records:ResearchRecordSummary[],selection:ResearchSourceSelection):ResearchRecordSummary|null {
 return selection.valid&&selection.recordId?records.find(record=>record.id===selection.recordId)??null:null;
}
export function findResearchSourceVersion(detail:ResearchRecordDetail,selection:ResearchSourceSelection):ResearchRecordVersion|null {
 if(!selection.valid||selection.recordId&&selection.recordId!==detail.id)return null;
 const id=selection.versionId??detail.currentVersion.id;
 return detail.versions.find(version=>version.id===id&&version.recordId===detail.id)??null;
}
export function findExportSourceRecord(workspace:BookCompletionWorkspace,bookId:string,selection:ExportSourceSelection):PublicationExportRecord|null {
 if(!selection.valid||!selection.requestId||workspace.bookId!==bookId)return null;
 return workspace.exports.find(record=>record.requestId===selection.requestId&&record.manifest.bookId===bookId&&(!record.artifact||record.artifact.requestId===record.requestId&&record.artifact.manifestId===record.manifest.id))??null;
}
/** Metadata baseline excludes immutable reports, version pointers and model configuration. */
export function researchMetadataBaseline(record:ResearchRecordSummary):string {
 return JSON.stringify({id:record.id,title:record.title,tags:record.tags,notes:record.notes,favorite:record.favorite,status:record.status,revision:record.revision});
}
