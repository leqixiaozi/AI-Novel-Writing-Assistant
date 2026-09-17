import {useCallback,useEffect,useMemo,useRef,useState} from "react";
import {RESEARCH_RESOURCE_SPACE_ID,type BookViewCard,type CardSummary} from "../common/contracts";
import {newDesignApi as api} from "./api";
import ResourceShell from "./ResourceShell";
import MaterialManagementPanel from "./businessForms/MaterialManagementPanel";
import {ResourceCatalogTree,ResourceCardDetail,buildResourceCatalog,findResourceSelection,type ResourceCatalog} from "./resourceBrowser";
import "./resourceBrowser/resources.css";

const EMPTY:ResourceCatalog={strategies:[],prompts:[],signals:[],dictionaries:[],dimensions:[],books:[]};
const SYSTEM_SPACE="00000000-0000-4000-8000-000000000001";
export default function ResourceCenterPage(){
 const [catalog,setCatalog]=useState<ResourceCatalog>(EMPTY),[selectedId,setSelectedId]=useState("strategies"),[loading,setLoading]=useState(false),[message,setMessage]=useState(""),[failures,setFailures]=useState<string[]>([]),[managerCards,setManagerCards]=useState<BookViewCard[]>([]);
 const guarded=useRef(false),generation=useRef(0);
 const onGuard=useCallback((blocked:boolean)=>{guarded.current=blocked;},[]);
 const nodes=useMemo(()=>buildResourceCatalog(catalog),[catalog]),selection=findResourceSelection(nodes,selectedId);
 const read=async()=>{
  if(guarded.current){setMessage("当前填写未保存或结果待核对。请先保存、核对，或放弃本次修改，再读取目录。");return;}
  const token=++generation.current;setLoading(true);setFailures([]);setMessage("");
  const part=async<K extends keyof ResourceCatalog>(key:K,label:string,work:()=>Promise<ResourceCatalog[K]>)=>{try{const value=await work();if(generation.current===token)setCatalog(current=>({...current,[key]:value}));}catch(error){if(generation.current===token)setFailures(current=>[...current,`${label}：${error instanceof Error?error.message:"读取失败"}`]);}};
  await Promise.all([part("strategies","创作策略",()=>api.listStrategyResources()),part("books","书籍",()=>api.listBooks()),part("prompts","提示词组件",async()=>(await api.getPromptCatalog()).components),part("dictionaries","字典",()=>api.listDictionaries()),part("dimensions","标签",()=>api.listTagDimensions(SYSTEM_SPACE)),part("signals","市场信号",async()=>{const types=await api.listCardTypes();const type=types.find(item=>item.key==="market_signal");return type?api.listCards(type.id,false,RESEARCH_RESOURCE_SPACE_ID):[];})]);
  if(generation.current===token)setLoading(false);
 };
 useEffect(()=>{void read();return()=>{generation.current++;};},[]);
 const select=(id:string)=>{if(id===selectedId)return;if(guarded.current){setMessage("当前资源有未保存填写、正在处理或结果待核对。请先处理右侧内容，再切换；填写保留。");return;}setSelectedId(id);setMessage("");};
 const managerSpace=selection?.kind==="organize"?selection.spaceId:null;
 useEffect(()=>{setManagerCards([]);if(!managerSpace)return;let active=true;void api.listCardTypes(managerSpace).then(async types=>{const cards=await Promise.all(types.filter(type=>type.status==="published").map(async type=>(await api.listCards(type.id,false,managerSpace)).map(card=>({...card,typeKey:type.key,typeFields:type.draftFields}))));if(active)setManagerCards(cards.flat());}).catch(error=>{if(active)setMessage(error instanceof Error?error.message:"所选空间资料读取失败，请重新读取目录。");});return()=>{active=false;};},[managerSpace]);
 const saved=(card:CardSummary)=>setCatalog(current=>({...current,strategies:current.strategies.map(item=>item.id===card.id?{...item,...card}:item)}));
 const branch=(items:typeof nodes):typeof nodes[number]|undefined=>{for(const item of items){if(item.id===selectedId)return item;const child=branch(item.children??[]);if(child)return child;}};
 const selectedNode=branch(nodes);
 return <ResourceShell active="home" treeNavigation><main className="nd-resource-browser">
  <div className="nd-resource-browser-toolbar"><p>展开目录，选择具体资源查看或编辑。</p><button type="button" className="nd-button nd-button-secondary" disabled={loading} onClick={()=>void read()}>{loading?"正在读取…":"重新读取目录"}</button></div>
  {message&&<p className="nd-message" role="status">{message}</p>}{failures.length>0&&<section className="nd-message is-error" role="alert"><p>部分目录读取失败，其他资源仍可使用。点击“重新读取目录”核对失败项。</p><ul>{failures.map(failure=><li key={failure}>{failure}</li>)}</ul></section>}
  <div className="nd-resource-browser-workspace"><ResourceCatalogTree nodes={nodes} selectedId={selectedId} onSelect={select}/><div className="nd-resource-browser-content">
   {selection?.kind==="card"?<ResourceCardDetail key={selection.card.id} selection={selection} books={catalog.books} onGuard={onGuard} onSaved={saved}/>:selection?.kind==="organize"?<section className="nd-resource-browser-detail"><h2>{selection.name}</h2><MaterialManagementPanel key={selection.spaceId+":"+selection.mode} scope={{spaceId:selection.spaceId}} mode={selection.mode} cards={managerCards} onOpenCard={card=>{const resource=catalog.strategies.find(item=>item.id===card.id)||catalog.prompts.find(item=>item.id===card.id)||catalog.signals.find(item=>item.id===card.id);if(resource)select("card:"+card.id);else setMessage("该资料尚未出现在公共目录，请重新读取目录核对；未自动打开其他来源。");}}/></section>:selection?.kind==="book"?<section className="nd-resource-browser-detail"><p className="nd-kicker">本书独立资料</p><h2>{selection.name}</h2><p>{selection.book.cardCount} 条资料，人物、世界与事件在本书工作台维护。</p><a className="nd-button nd-button-primary" href={"/new-design/books/"+selection.book.id+"/cards"}>打开这本书的资料</a></section>:selection?.kind==="dictionary"||selection?.kind==="tag"?<section className="nd-resource-browser-detail"><p className="nd-kicker">{selection.kind==="dictionary"?"字典选项":"标签维度"}</p><h2>{selection.name}</h2><p>{selection.description||"尚未填写说明。"}</p>{selection.kind==="dictionary"&&selection.nodeId&&<p>所在字典：{selection.dictionary.name} · {selection.dictionary.readOnly?"只读资源":"可维护资源"}</p>}{selection.kind==="tag"&&selection.nodeId&&<p>所属维度：{selection.dimension.name}</p>}<p>目录可继续展开下级，调整结构、顺序和引用请打开对应树编辑器。</p><a className="nd-button nd-button-secondary" href={selection.kind==="dictionary"?"/new-design/resources/dictionaries":"/new-design/resources/tags"}>打开树编辑器</a></section>:<section className="nd-resource-browser-detail"><p className="nd-kicker">创作资源目录</p><h2>{selection?.name??"选择一项资源"}</h2><p>{selection?.kind==="category"?selection.description:"从左侧展开分类，选择具体资源。"}</p>{selectedNode?.children?.length?<ul className="nd-resource-browser-category-items">{selectedNode.children.map(node=><li key={node.id}><button type="button" onClick={()=>select(node.id)}>{node.name}<small>{node.count??""}</small></button></li>)}</ul>:<p>{loading?"正在读取目录。":"本分类尚无资源。"}</p>}{selection?.kind==="category"&&selection.href&&<a className="nd-button nd-button-secondary" href={selection.href}>新建或管理{selection.name}</a>}</section>}
  </div></div>
 </main></ResourceShell>;
}
