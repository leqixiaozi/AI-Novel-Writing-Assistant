import {BOOK_NAV_GROUPS,BOOK_TASK_NAV,type BookTaskNavKey} from "../navigation";
import type {TreeNavigationNode} from "../tree";

export function buildBookFunctionTree(bookId:string):TreeNavigationNode[]{
 const page=(key:BookTaskNavKey):TreeNavigationNode=>{
  const item=BOOK_TASK_NAV.find(candidate=>candidate.key===key)!;
  return {id:`page:${key}`,name:item.label,href:`/new-design/books/${bookId}/${item.path}`};
 };
 return BOOK_NAV_GROUPS.map(group=>{
  const keys=group.sections.flatMap(section=>section.items);
  if(keys.length===1)return {...page(keys[0]),name:group.label};
  return {id:`group:${group.key}`,name:group.label,children:group.sections.map(section=>
   section.items.length===1?page(section.items[0]):{
    id:`section:${group.key}:${section.key}`,name:section.label,children:section.items.map(page),
   }),};
 });
}
