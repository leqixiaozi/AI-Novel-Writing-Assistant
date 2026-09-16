import type {MultiviewAuthorFacet,MultiviewAuthorWorkspace,MultiviewTreeNode} from "../../../common/multiviewAuthor";
import {getBookViewWorkspace} from "../bookViewStore";
import {getDictionary} from "../compositionStore";
import {listTagDimensions} from "../treeResources";
import {getMaterialManagementWorkspace} from "../materialManagement";
import {multiviewDescendants} from "../../../common/multiviewAuthor";
import {NewDesignError} from "../../domain/errors";
export async function getBookMultiviewAuthorWorkspace(bookId:string):Promise<MultiviewAuthorWorkspace>{
 const book=await getBookViewWorkspace(bookId),facets:MultiviewAuthorFacet[]=[],seen=new Set<string>();
 for(const card of book.cards)for(const field of card.typeFields){const source=field.optionSource;if(source?.kind!=="dictionary_tree")continue;const id=`dictionary:${card.cardTypeId}:${card.typeVersionId}:${field.key}`;if(seen.has(id))continue;seen.add(id);let dictionary;try{dictionary=await getDictionary(source.dictionaryId);}catch(error){if(!(error instanceof NewDesignError)||error.status!==404)throw error;facets.push({id,kind:"dictionary",label:`${card.cardTypeName} · ${field.name} · 类型版本 ${card.typeVersion}`,sourceId:source.dictionaryId,fieldKey:field.key,cardTypeId:card.cardTypeId,typeVersionId:card.typeVersionId,nodes:[],unavailableReason:"正式字段绑定的字典不存在或已停用，请核对内容类型的字典来源。"});continue;}let nodes:MultiviewTreeNode[]=dictionary.items.filter(node=>node.status==="active").map(node=>({id:node.id,parentId:node.parentId,label:node.label,path:node.path.map(part=>part.label),sortOrder:node.sortOrder}));let unavailableReason:string|null=null;
  if(dictionary.ownerSpaceId!==null&&dictionary.ownerSpaceId!==book.spaceId){nodes=[];unavailableReason="字典来源不属于本书可用空间，请从本书内容类型核对绑定来源。";}
  if(source.rule.rootNodeId){const root=nodes.find(node=>node.id===source.rule.rootNodeId);if(!root){nodes=[];unavailableReason="正式字段的字典范围起点未找到，请核对字段规格。";}else{const allowed=multiviewDescendants(nodes,root.id);allowed.add(root.id);nodes=nodes.filter(node=>allowed.has(node.id)).map(node=>({...node,parentId:node.id===root.id?null:node.parentId}));}}
  facets.push({id,kind:"dictionary",label:`${card.cardTypeName} · ${field.name} · 类型版本 ${card.typeVersion}`,sourceId:source.dictionaryId,fieldKey:field.key,cardTypeId:card.cardTypeId,typeVersionId:card.typeVersionId,nodes,unavailableReason});
 }
 const dimensions=await listTagDimensions(book.spaceId),materials=await getMaterialManagementWorkspace({bookId});
 for(const dimension of dimensions)facets.push({id:`tag:${dimension.id}`,kind:"tag",label:dimension.name,sourceId:dimension.id,fieldKey:null,cardTypeId:null,typeVersionId:null,nodes:dimension.nodes.filter(node=>node.status==="active").map(node=>({id:node.id,parentId:node.parentId,label:node.name,path:node.path.map(part=>part.name),sortOrder:node.sortOrder})),unavailableReason:null});
 return {bookId,spaceId:book.spaceId,cards:book.cards,facets,assignments:materials.memberships.map(item=>({cardId:item.cardId,nodeIds:item.tagIds}))};
}
