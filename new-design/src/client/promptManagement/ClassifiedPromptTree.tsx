import {useMemo} from "react";
import type {PromptCatalog} from "../../common/promptManagement";
import {TreeManager,type TreeSelectorNode} from "../tree";

export default function ClassifiedPromptTree({catalog,selectedId,onCategory,onComponent,onAdd,onMove}:{catalog:PromptCatalog;selectedId:string|null;onCategory:(id:string)=>void;onComponent:(id:string)=>void;onAdd:(parentId:string|null)=>void;onMove:(id:string,direction:-1|1)=>void}){
  const groups=catalog.organization.groups.filter(group=>group.status==="active");
  const {nodes,componentByNode}=useMemo(()=>{
    const nodes:TreeSelectorNode[]=groups.map(group=>({id:group.id,parentId:group.parentId,name:group.name,sortOrder:group.sortOrder,description:`${group.memberCount} 个组件引用`}));
    const componentByNode=new Map<string,string>(),activeIds=new Set(groups.map(group=>group.id));
    nodes.push({id:"unclassified",parentId:null,name:"待选择主分类",sortOrder:100000,description:"原组件保留，不自动猜分类"});
    for(const component of catalog.components){
      const main=catalog.primaryGroups[component.id],extra=(catalog.organization.memberships.find(member=>member.cardId===component.id)?.groupIds??[]).filter(id=>id!==main&&activeIds.has(id));
      for(const groupId of [main??"unclassified",...extra]){
        const id=`component:${groupId}:${component.id}`;componentByNode.set(id,component.id);
        const path:string[]=[],visited=new Set<string>();let parent=groups.find(group=>group.id===groupId);
        while(parent&&!visited.has(parent.id)){visited.add(parent.id);path.unshift(parent.name);parent=groups.find(group=>group.id===parent?.parentId);}
        nodes.push({id,parentId:groupId,name:component.title,description:`${extra.includes(groupId)?"额外分组 · ":""}${component.values.enabled===false?"已停用":"可选用"}`,sortOrder:100000,path});
      }
    }
    return {nodes,componentByNode};
  },[catalog]);
  return <TreeManager nodes={nodes} selectedId={selectedId} onSelect={id=>componentByNode.has(id)?onComponent(componentByNode.get(id)!):onCategory(id)} onAdd={onAdd} onMove={onMove} isManagedNode={node=>groups.some(group=>group.id===node.id)}/>;
}
