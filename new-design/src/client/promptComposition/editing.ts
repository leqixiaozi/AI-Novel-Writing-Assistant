import type {CompositionCatalog,CompositionRecipe,CompositionSettings,SaveCompositionInput} from "../../common/promptComposition";
import type {TreeSelectorNode} from "../tree";
export type RecipeDraft=CompositionSettings&{name:string;description:string};
export function copyDraft(recipe:RecipeDraft):RecipeDraft{return {name:recipe.name,description:recipe.description,taskType:recipe.taskType,components:recipe.components.map(item=>({...item})),variables:recipe.variables.map(item=>({...item,options:[...item.options]})),context:{bookId:recipe.context.bookId,sources:recipe.context.sources.map(item=>({...item}))}};}
export function emptyRecipe():RecipeDraft{return{name:"",description:"",taskType:"form_assist",components:[],variables:[],context:{bookId:null,sources:[]}};}
export function sameComposition(a:RecipeDraft,b:RecipeDraft):boolean{return JSON.stringify(copyDraft(a))===JSON.stringify(copyDraft(b));}
export function matchingSavedRecipes(catalog:CompositionCatalog,input:SaveCompositionInput):CompositionRecipe[]{return catalog.recipes.filter(recipe=>(input.id?recipe.id===input.id:true)&&sameComposition(recipe,input));}
export function pickerNodes(catalog:CompositionCatalog):TreeSelectorNode[]{
  const groups=catalog.prompts.organization.groups.filter(group=>group.status==="active");
  const active=new Set(groups.map(group=>group.id));
  return [...groups.map(group=>({id:`group:${group.id}`,parentId:group.parentId&&active.has(group.parentId)?`group:${group.parentId}`:null,name:group.name,sortOrder:group.sortOrder})),{id:"unclassified",parentId:null,name:"待分类组件",sortOrder:100000},...catalog.prompts.components.map(component=>({id:component.id,parentId:active.has(catalog.prompts.primaryGroups[component.id])?`group:${catalog.prompts.primaryGroups[component.id]}`:"unclassified",name:component.title,description:component.values.enabled===false?"已停用，请在提示词管理核对":"可加入组合",sortOrder:100000}))];
}
export function bookTypes(catalog:CompositionCatalog,bookId:string|null){const space=catalog.books.find(book=>book.id===bookId)?.spaceId;return space?catalog.types.filter(type=>type.spaceId===space&&type.status==="published"):[];}
export function compositionFieldLabel(path:string):string{
  const labels:Record<string,string>={name:"组合名称",description:"用途说明",taskType:"创作任务",components:"指令组件",cardId:"引用资料",versionId:"引用版本",enabled:"组件启停",variables:"补充参数",key:"稳定标识",label:"参数名称",type:"填写方式",options:"可选值",defaultValue:"默认值",context:"参考资料",bookId:"参考书籍",sources:"参考资料位置",role:"参考用途",parameters:"本次试运行输入",instruction:"创作要求",sourceText:"参考文本／已有构思",sourceReference:"文本来源说明",method:"开书来源",schemaTypeIds:"输出内容类型",direction:"故事方向",title:"名称",premise:"核心构思",protagonist:"主角定位",centralConflict:"主要冲突",readerPromise:"读者体验",styleKeywords:"文风关键词",planning:"规划输入",level:"规划层级",analysis:"分析输入",purpose:"分析用途",preset:"分析深度",dimensions:"分析维度",rankingSnapshotIds:"已采集榜单",variableValues:"本次填写",expectedRevision:"服务器修订",recipeId:"组合位置",recipeVersionId:"组合版本"};
  const parts=path.split(".").filter(part=>!/^\d+$/.test(part));
  return [...parts].reverse().map(part=>labels[part]).find(Boolean)??"输入内容";
}
