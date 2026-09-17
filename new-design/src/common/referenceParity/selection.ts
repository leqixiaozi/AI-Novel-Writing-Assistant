import type {CardGroupFormSummary,CardGroupFormVersion} from "../contracts";
export function selectPublishedBusinessForm(primaryTypeKey:string,forms:CardGroupFormSummary[],versions:Map<string,CardGroupFormVersion[]>,activeVersionId?:string){
  const published=forms.filter(form=>form.status==='published');
  if(activeVersionId){const matches=published.flatMap(form=>(versions.get(form.id)??[]).filter(version=>version.id===activeVersionId&&version.definition.primaryTypeKey===primaryTypeKey).map(version=>({form,version})));return matches.length===1?{...matches[0],needsSelection:false}:{form:null,version:null,needsSelection:true};}
  const candidates=published.flatMap(form=>(versions.get(form.id)??[]).filter(version=>version.id===form.currentVersionId&&version.definition.primaryTypeKey===primaryTypeKey).map(version=>({form,version})));
  return candidates.length===1?{...candidates[0],needsSelection:false}:{form:null,version:null,needsSelection:candidates.length>1};
}
