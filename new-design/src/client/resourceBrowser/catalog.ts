import {PROMPT_COMPONENT_RESOURCE_SPACE_ID,RESEARCH_RESOURCE_SPACE_ID,type BookSummary,type CardSummary,type DictionarySummary,type StrategyResourceSummary,type TagDimension} from "../../common/contracts";

export const STRATEGY_GROUPS=[
 {key:"genre_strategy",name:"题材策略",description:"确定读者、核心体验和题材边界。"},
 {key:"progression_mode",name:"推进模式",description:"定义故事持续升级和阶段兑现的循环。"},
 {key:"writing_config",name:"写法配置",description:"保存视角、语言、节奏和章节密度。"},
 {key:"quality_rule",name:"质量规则",description:"检查质量与表达。"},
] as const;
export interface ResourceNode {id:string;name:string;description?:string;count?:number;children?:ResourceNode[];selection?:ResourceSelection;}
export type ResourceSelection=
 |{kind:"category";id:string;name:string;description:string;href?:string}
 |{kind:"card";id:string;name:string;card:CardSummary;editable:boolean;href:string}
 |{kind:"dictionary";id:string;name:string;description:string;dictionary:DictionarySummary;nodeId?:string}
 |{kind:"tag";id:string;name:string;description:string;dimension:TagDimension;nodeId?:string}
 |{kind:"organize";id:string;name:string;spaceId:string;mode:"groups"|"tags"|"views"}
 |{kind:"book";id:string;name:string;book:BookSummary};
export interface ResourceCatalog {strategies:StrategyResourceSummary[];prompts:CardSummary[];signals:CardSummary[];dictionaries:DictionarySummary[];dimensions:TagDimension[];books:BookSummary[];}

function hierarchy<T extends {id:string;parentId:string|null;sortOrder:number}>(items:T[],make:(item:T)=>ResourceNode):ResourceNode[]{
 const byId=new Map(items.map(item=>[item.id,item]));
 const walk=(parentId:string|null,ancestors:Set<string>):ResourceNode[]=>items.filter(item=>item.parentId===parentId||(parentId===null&&item.parentId&&!byId.has(item.parentId))).sort((a,b)=>a.sortOrder-b.sortOrder||a.id.localeCompare(b.id)).flatMap(item=>{
  if(ancestors.has(item.id))return [];
  const children=walk(item.id,new Set([...ancestors,item.id]));return [{...make(item),...(children.length?{children}: {})}];
 });
 return walk(null,new Set());
}
const category=(id:string,name:string,description:string,children:ResourceNode[],href?:string):ResourceNode=>({id,name,description,count:children.length,children,selection:{kind:"category",id,name,description,href}});
export function buildResourceCatalog(input:ResourceCatalog):ResourceNode[]{
 const strategy=STRATEGY_GROUPS.map<ResourceNode>(group=>category(`strategy:${group.key}`,group.name,group.description,input.strategies.filter(card=>card.typeKey===group.key).map<ResourceNode>(card=>({id:`card:${card.id}`,name:card.title,selection:{kind:"card",id:`card:${card.id}`,name:card.title,card,editable:true,href:`/new-design/resources/strategies?type=${group.key}`}})),`/new-design/resources/strategies?type=${group.key}`));
 const prompts=input.prompts.map<ResourceNode>(card=>({id:`card:${card.id}`,name:card.title,selection:{kind:"card" as const,id:`card:${card.id}`,name:card.title,card,editable:false,href:"/new-design/resources/prompts"}}));
 const signals=input.signals.map<ResourceNode>(card=>({id:`card:${card.id}`,name:card.title,selection:{kind:"card" as const,id:`card:${card.id}`,name:card.title,card,editable:false,href:"/new-design/research/market-radar"}}));
 const dictionaries=input.dictionaries.filter(item=>item.status!=="archived"&&item.scope!=="book").map<ResourceNode>(dictionary=>({id:`dictionary:${dictionary.id}`,name:dictionary.name,selection:{kind:"dictionary" as const,id:`dictionary:${dictionary.id}`,name:dictionary.name,description:dictionary.description,dictionary},children:hierarchy(dictionary.items.filter(item=>item.status==="active"),item=>({id:`dictionary:${dictionary.id}:${item.id}`,name:item.label,selection:{kind:"dictionary",id:`dictionary:${dictionary.id}:${item.id}`,name:item.label,description:item.description,dictionary,nodeId:item.id}}))}));
 const dimensions=input.dimensions.filter(item=>item.status==="active"&&item.scope!=="book").map<ResourceNode>(dimension=>({id:`tag:${dimension.id}`,name:dimension.name,selection:{kind:"tag" as const,id:`tag:${dimension.id}`,name:dimension.name,description:dimension.description,dimension},children:hierarchy(dimension.nodes.filter(item=>item.status==="active"),item=>({id:`tag:${dimension.id}:${item.id}`,name:item.name,selection:{kind:"tag",id:`tag:${dimension.id}:${item.id}`,name:item.name,description:String(item.metadata.description??""),dimension,nodeId:item.id}}))}));
 const organization=[{id:"strategy",name:"创作策略",spaceId:"60000000-0000-4000-8000-000000000001"},{id:"prompt",name:"提示词组件",spaceId:PROMPT_COMPONENT_RESOURCE_SPACE_ID},{id:"research",name:"研究与市场信号",spaceId:RESEARCH_RESOURCE_SPACE_ID}].map<ResourceNode>(space=>category(`organize:${space.id}`,space.name,"各空间独立整理。",([['groups','分组目录'],['tags','标签整理'],['views','智能视图']] as const).map<ResourceNode>(([mode,name])=>({id:`organize:${space.id}:${mode}`,name,selection:{kind:"organize",id:`organize:${space.id}:${mode}`,name:`${space.name}／${name}`,spaceId:space.spaceId,mode}}))));
 const recent=[...input.strategies].sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)).slice(0,5).map<ResourceNode>(card=>({id:`recent:${card.id}`,name:card.title,selection:{kind:"card" as const,id:`recent:${card.id}`,name:card.title,card,editable:true,href:`/new-design/resources/strategies?type=${card.typeKey}`}}));
 return [category("public-characters","公共角色导入","选择固定公共角色版本，逐项映射后创建书内独立人物。",[],"/new-design/resources/characters"),category("strategies","创作策略","跨书复用的题材、推进、写法和质量要求。",strategy),category("prompts","提示词管理","可复用指令，分类与配方引用由提示词编辑器维护。",[category("prompt-components","提示词组件","选择组件查看内容。",prompts,"/new-design/resources/prompts"),category("composition","组合与试运行","明确选择参数后试运行，不自动调用 AI。",[],"/new-design/resources/ai/prompt-composition")]),category("options","选项与标签","按多层目录查找标准选项与标签。",[category("dictionaries","字典树","选择字典或具体选项。",dictionaries,"/new-design/resources/dictionaries"),category("tags","标签树","选择标签维度或具体标签。",dimensions,"/new-design/resources/tags")]),category("research","研究与市场信号","查看已保存的研究信号。",signals,"/new-design/research/market-radar"),category("organization","整理资源","标签、分组与智能视图按原空间独立保存。",organization),category("recent","最近更新","直接选择最近维护的资源。",recent),category("books","各书资料","正式设定只属于对应书籍。",input.books.map<ResourceNode>(book=>({id:`book:${book.id}`,name:book.name,count:book.cardCount,selection:{kind:"book",id:`book:${book.id}`,name:book.name,book}})))];
}
export function findResourceSelection(nodes:ResourceNode[],id:string):ResourceSelection|null{
 for(const node of nodes){if(node.id===id)return node.selection??null;const child=findResourceSelection(node.children??[],id);if(child)return child;}return null;
}
export function filterResourceNodes(nodes:ResourceNode[],query:string):ResourceNode[]{
 const term=query.trim().toLocaleLowerCase("zh-CN");if(!term)return nodes;
 return nodes.flatMap(node=>{if(`${node.name} ${node.description??""}`.toLocaleLowerCase("zh-CN").includes(term))return [node];const children=filterResourceNodes(node.children??[],query);return children.length?[{...node,children}]:[];});
}
