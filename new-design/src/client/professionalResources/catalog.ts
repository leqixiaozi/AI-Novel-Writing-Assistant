import {RESOURCE_KINDS,RESOURCE_LABELS,type ProfessionalResource,type ProfessionalResourceKind} from "../../common/professionalResources";

export interface ProfessionalDirectoryNode {
 id:string;name:string;count?:number;description?:string;
 kind:ProfessionalResourceKind;resource?:ProfessionalResource;
 children?:ProfessionalDirectoryNode[];
}
export function buildProfessionalResourceTree(resources:ProfessionalResource[],filters:{search:string;favoritesOnly:boolean;includeArchived:boolean},kinds:readonly ProfessionalResourceKind[]=RESOURCE_KINDS):ProfessionalDirectoryNode[]{
 const term=filters.search.trim().toLocaleLowerCase("zh-CN");
 return kinds.flatMap(kind=>{
  const name=RESOURCE_LABELS[kind],categoryMatches=Boolean(term)&&name.toLocaleLowerCase("zh-CN").includes(term);
  const children=resources.filter(item=>item.kind===kind&&(filters.includeArchived||item.status==="active")&&(!filters.favoritesOnly||item.favorite)&&(!term||categoryMatches||item.title.toLocaleLowerCase("zh-CN").includes(term))).map(item=>({id:`resource:${item.id}`,name:item.title,kind,resource:item,description:`修订 ${item.revision} · ${item.status==="active"?"可使用":"已归档，只读"}${item.favorite?" · 已收藏":""}`}));
  if(term&&!categoryMatches&&!children.length)return [];
  return [{id:`kind:${kind}`,name,kind,count:children.length,children}];
 });
}
