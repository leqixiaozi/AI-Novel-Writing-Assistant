import {useEffect,useState} from "react";
import {COMPOSITION_ROUTE,DEFAULT_DEBUG_PARAMETERS,type CompositionCatalog,type CompositionDebugPreview,type CompositionDebugResult,type CompositionRecipe,type CompositionSources,type DebugParameters,type DebugPreviewInput,type SaveCompositionInput,type SaveCompositionResult} from "../../common/promptComposition";
import {MODEL_TASKS} from "../../common/modelRouting";
import type {AiRuntimeRecovery} from "../../common/aiRuntime";
import {ApiError,newDesignApi as api} from "../api";
import ResourceShell from "../ResourceShell";
import {TreeSelector} from "../tree";
import {compositionFieldLabel,copyDraft,emptyRecipe,pickerNodes,sameComposition,type RecipeDraft} from "./editing";
import {Parameters} from "./Parameters";
import {VariableEditor} from "./VariableEditor";
import {PreviewResult} from "./PreviewResult";
import "./composition.css";
interface Pending {kind:"save"|"preview"|"run";checked:boolean;save?:SaveCompositionInput;preview?:DebugPreviewInput;run?:{previewId:string;expectedRevision:number;idempotencyKey:string};foundRecipe?:SaveCompositionResult|null;foundPreview?:CompositionDebugPreview|null;foundResult?:CompositionDebugResult|null;}
const parameters=():DebugParameters=>({...DEFAULT_DEBUG_PARAMETERS,schemaTypeIds:[],rankingSnapshotIds:[],direction:{...DEFAULT_DEBUG_PARAMETERS.direction,styleKeywords:[]},planning:{...DEFAULT_DEBUG_PARAMETERS.planning},analysis:{...DEFAULT_DEBUG_PARAMETERS.analysis,dimensions:["story_structure"]}});

export default function PromptCompositionPage(){
  const [catalog,setCatalog]=useState<CompositionCatalog|null>(null);
  const [draft,setDraft]=useState<RecipeDraft>(emptyRecipe);
  const [base,setBase]=useState<CompositionRecipe|null>(null);
  const [sources,setSources]=useState<CompositionSources|null>(null);
  const [params,setParams]=useState<DebugParameters>(parameters);
  const [variableValues,setVariableValues]=useState<Record<string,string|number|boolean>>({});
  const [preview,setPreview]=useState<CompositionDebugPreview|null>(null);
  const [result,setResult]=useState<CompositionDebugResult|null>(null);
  const [previewFresh,setPreviewFresh]=useState(false);
  const [busy,setBusy]=useState(false);
  const [pending,setPending]=useState<Pending|null>(null);
  const [saved,setSaved]=useState<SaveCompositionResult|null>(null);
  const [error,setError]=useState("");
  const [recovery,setRecovery]=useState<AiRuntimeRecovery|null>(null);
  const [failedStep,setFailedStep]=useState("");
  const [notice,setNotice]=useState("");
  const [issues,setIssues]=useState<Record<string,string>>({});
  const locked=busy||Boolean(pending);
  const dirty=base?!sameComposition(base,draft):Boolean(draft.name||draft.components.length||draft.variables.length||draft.context.bookId);
  const change=(next:RecipeDraft)=>{setDraft(next);setPreviewFresh(false);};
  const changeParams=(next:DebugParameters)=>{setParams(next);setPreviewFresh(false);};
  const report=(reason:unknown,step:string)=>{setRecovery(reason instanceof ApiError?reason.recovery:null);setFailedStep(reason instanceof ApiError?reason.recovery?.failedStep??step:step);setError(reason instanceof Error?reason.message:"未收到有效回执，请核对服务器结果。");setIssues(reason instanceof ApiError?reason.issues:{});};
  const uncertain=(reason:unknown)=>!(reason instanceof ApiError)||reason.status===409||reason.status>=500;
  const loadSources=async(bookId:string|null)=>{setSources(null);if(bookId)setSources(await api.getCompositionSources(bookId));};
  const read=async()=>{setBusy(true);setError("");try{setCatalog(await api.getCompositionCatalog());}catch(reason){report(reason,"读取提示词组合目录");}finally{setBusy(false);}};
  useEffect(()=>{void read();},[]);
  const choose=async(recipe:CompositionRecipe|null)=>{
    if(locked||dirty&&!confirm("当前组合编辑未保存，切换会放弃此页编辑，是否继续？"))return;
    setBusy(true);setError("");setBase(recipe);setDraft(recipe?copyDraft(recipe):emptyRecipe());setSaved(null);setPreview(null);setResult(null);setPreviewFresh(false);setParams(parameters());setVariableValues(Object.fromEntries((recipe?.variables??[]).map(variable=>[variable.key,variable.defaultValue])));
    try{await loadSources(recipe?.context.bookId??null);}catch(reason){report(reason,"读取组合参考书籍资料");}finally{setBusy(false);}
  };
  const changeBook=async(bookId:string|null)=>{change({...draft,context:{bookId,sources:[]}});changeParams({...params,schemaTypeIds:[]});setBusy(true);setError("");try{await loadSources(bookId);}catch(reason){report(reason,"读取参考书籍资料");}finally{setBusy(false);}};
  const afterSaved=async(value:SaveCompositionResult)=>{
    setSaved(value);setBase(value.recipe);setDraft(copyDraft(value.recipe));setPreviewFresh(false);setNotice(value.active?`组合已保存并启用，第 ${value.savedVersion} 版。`:`组合已保存，第 ${value.savedVersion} 版；启用状态需核对。`);setPending(null);
    try{setCatalog(await api.getCompositionCatalog());}catch(reason){report(reason,"组合已保存后的目录刷新");setPending({kind:"save",checked:false,foundRecipe:value});}
  };
  const save=async(original?:SaveCompositionInput)=>{
    if(!original&&(locked||base?.editable===false))return;
    const input=original??{...copyDraft(draft),id:base?.id??null,expectedRevision:base?.revision??null,idempotencyKey:crypto.randomUUID()};
    setBusy(true);setError("");setNotice("");
    try{await afterSaved(await api.saveCompositionRecipe(input));}
    catch(reason){report(reason,"保存并启用组合");if(uncertain(reason))setPending({kind:"save",checked:false,save:input});}
    finally{setBusy(false);}
  };
  const rememberPreview=(value:CompositionDebugPreview)=>{setPreview(value);setResult(null);setPreviewFresh(value.recipeVersionId===base?.versionId&&!dirty);const url=new URL(location.href);url.searchParams.set("previewId",value.id);history.replaceState(null,"",url);};
  const createPreview=async(original?:DebugPreviewInput)=>{
    if(!base||!original&&(locked||dirty||!draft.context.bookId))return;
    const input=original??{recipeId:base.id,recipeVersionId:base.versionId,parameters:params,variableValues,idempotencyKey:crypto.randomUUID()};
    setBusy(true);setError("");setNotice("");
    try{const value=await api.createCompositionPreview(input);rememberPreview(value);setPending(null);setNotice(value.status==="blocked"?"冻结预览已生成；请处理列出的阻断问题，本次未调用模型。":"冻结预览已生成，核对后明确点击“确认试运行”。");}
    catch(reason){report(reason,"冻结提示词与参考预览");if(uncertain(reason))setPending({kind:"preview",checked:false,preview:input});}
    finally{setBusy(false);}
  };
  const run=async(original?:Pending["run"])=>{
    if(!preview||!original&&(locked||!previewFresh||preview.status!=="ready"||result))return;
    const input=original??{previewId:preview.id,expectedRevision:preview.revision,idempotencyKey:crypto.randomUUID()};
    setBusy(true);setError("");setNotice("");
    try{const value=await api.runCompositionPreview(input.previewId,{expectedRevision:input.expectedRevision,idempotencyKey:input.idempotencyKey});setResult(value);setPending(null);setPreviewFresh(false);setNotice(value.status==="running"?"试运行处理中，请点击“读取试运行结果”核对。":"试运行结果已读取；未采用为小说内容。");}
    catch(reason){report(reason,"提交组合试运行");if(uncertain(reason))setPending({kind:"run",checked:false,run:input});}
    finally{setBusy(false);}
  };
  const check=async()=>{
    if(!pending)return;setBusy(true);setError("");
    try{
      if(pending.kind==="save"){
        const receipt=pending.save?await api.getCompositionRecipeByRequest(pending.save.idempotencyKey):pending.foundRecipe??null;
        setCatalog(await api.getCompositionCatalog());setPending({...pending,checked:true,foundRecipe:receipt});
        if(receipt){setSaved(receipt);setNotice(`原请求已确认保存，第 ${receipt.savedVersion} 版；当前编辑仍保留，明确使用服务器结果后继续。`);}else setNotice("尚未查到原请求回执，不能据此断言未保存。可明确按原请求重试，不会自动重复新增。");
      }else if(pending.kind==="preview"&&pending.preview){const found=await api.getCompositionPreviewByRequest(pending.preview.idempotencyKey);setPending({...pending,checked:true,foundPreview:found});setNotice(found?"原请求的冻结预览已找到，明确使用它后继续。":"尚未查到冻结预览，保留原请求标识；可明确按原请求重试。");}
      else if(pending.run){const found=await api.getCompositionResult(pending.run.previewId);if(found)setResult(found);setPending({...pending,checked:true,foundResult:found});setNotice(found?"试运行状态已找到，明确使用核对结果后继续。":"尚未查到试运行结果，提交状态未知，不能断言原请求未执行。保留冻结请求并继续只读核对，不会再次提交模型调用。");}
    }catch(reason){report(reason,"只读核对服务器结果");}finally{setBusy(false);}
  };
  const acceptChecked=()=>{
    if(!pending?.checked)return;
    if(pending.kind==="save"&&pending.foundRecipe){setBase(pending.foundRecipe.recipe);setDraft(copyDraft(pending.foundRecipe.recipe));setSaved(pending.foundRecipe);setPreviewFresh(false);}
    else if(pending.kind==="preview"&&pending.foundPreview)rememberPreview(pending.foundPreview);
    else if(pending.kind==="run"&&pending.foundResult){setResult(pending.foundResult);setPreviewFresh(false);}
    else return;
    setPending(null);setError("");setNotice("已使用核对结果，没有自动重复生成或采用小说内容。");
  };
  const keepDraft=()=>{if(pending?.kind!=="save"||!pending.checked||!pending.foundRecipe)return;setBase(pending.foundRecipe.recipe);setSaved(pending.foundRecipe);setPending(null);setError("");setPreviewFresh(false);setNotice("当前编辑保留，已对齐原请求确认后的修订；请核对后明确保存。");};
  const refreshResult=async()=>{
    if(!preview||locked)return;setBusy(true);setError("");
    const reads=await Promise.allSettled([api.getCompositionPreview(preview.id),api.getCompositionResult(preview.id)]);
    if(reads[0].status==="fulfilled")setPreview(reads[0].value);
    if(reads[1].status==="fulfilled"){
      const output=reads[1].value;
      if(output)setResult(output);
      setNotice(output?"已读取冻结试运行状态。":result?"暂未读到新回执，此前成功读取的结果保留；提交状态需核对，不会再次提交模型调用。":preview.status==="submitted"?"此预览已提交，但尚未读到执行回执；请继续只读核对。":"此预览尚未确认提交，当前执行状态未知；不会自动提交或把无记录当作未执行。");
    }
    if(reads[0].status==="rejected")report(reads[0].reason,"读取冻结预览（已读取结果保留）");
    if(reads[1].status==="rejected")report(reads[1].reason,"读取试运行结果（此前结果保留）");
    setBusy(false);
  };
  useEffect(()=>{
    const id=new URLSearchParams(location.search).get("previewId");if(!id||!catalog||base||preview)return;
    setBusy(true);void Promise.allSettled([api.getCompositionPreview(id),api.getCompositionResult(id)]).then(reads=>{
      if(reads[0].status==="fulfilled")setPreview(reads[0].value);else report(reads[0].reason,"读取历史冻结预览（已读取结果保留）");
      if(reads[1].status==="fulfilled"){if(reads[1].value)setResult(reads[1].value);}else report(reads[1].reason,"读取历史试运行结果（此前结果保留）");
      setPreviewFresh(false);setNotice("历史请求只读查看，未读到回执时保持未知；明确选择组合并生成新预览后再试运行。");
    }).finally(()=>setBusy(false));
  },[catalog]);
  return <ResourceShell active="composition"><main className="nd-composition-page"><p>试运行选择参考书籍，不写小说内容。组件分类用于查找，组合中的顺序决定指令排列。</p>
    {saved&&<section className="nd-composition-saved" role="status"><h2>组合第 {saved.savedVersion} 版已保存{saved.active?"并启用":""}</h2><details><summary>保存凭证</summary><code>{saved.savedVersionId}</code></details></section>}
    {notice&&<p role="status">{notice}</p>}{error&&<section className="nd-message is-error" role="alert"><h2>{failedStep}未完成</h2><p>{error}</p>{recovery&&<><p>{recovery.savedResult}</p><a className="nd-button" href={recovery.sourceRoute} target="_blank" rel="noreferrer">{recovery.actionLabel}</a></>}<p>当前编辑、已保存配方和已有小说内容保留。{pending?"请先点击“核对服务器结果”；写入及切换已暂停，避免重复提交。":"目录读取失败可重试读取；字段不合格请核对列出的内容，再明确保存或重新预览。"}{saved&&failedStep.includes("目录")?"原保存已成功，失败的是目录读取。":""}</p>{Object.entries(issues).length>0&&<ul>{Object.entries(issues).map(([key,detail])=><li key={key}>{compositionFieldLabel(key)}：{detail}</li>)}</ul>}</section>}
    {pending&&<section className="nd-composition-recovery"><h2>核对后明确恢复</h2><p>原请求标识和填写内容保留，不自动重发模型调用。试运行结果未知时只读核对；保存或预览可明确按原领取标识重试，由服务器核对原请求，不新增第二份领取或模型调用。</p><div className="nd-action-row"><button className="nd-button" disabled={busy} onClick={()=>void check()}>核对服务器结果</button><button className="nd-button" disabled={busy||!pending.checked||!(pending.foundRecipe||pending.foundPreview||pending.foundResult)} onClick={acceptChecked}>使用核对结果继续</button>{pending.kind==="save"&&<button className="nd-button" disabled={busy||!pending.checked||!pending.foundRecipe} onClick={keepDraft}>保留我的编辑，按确认修订继续</button>}{pending.kind!=="run"&&pending.checked&&!pending.foundRecipe&&!pending.foundPreview&&!pending.foundResult&&<button className="nd-button" disabled={busy} onClick={()=>pending.kind==="save"&&pending.save?void save(pending.save):pending.kind==="preview"&&pending.preview?void createPreview(pending.preview):undefined}>按原请求标识明确重试</button>}</div></section>}
    <div className="nd-composition-workspace"><aside className="nd-composition-catalog"><h2>组合配方</h2><button className="nd-button" disabled={locked} onClick={()=>void choose(null)}>＋ 新建组合</button><div className="nd-composition-recipe-list">{catalog?.recipes.map(recipe=><button key={recipe.id} disabled={locked} aria-pressed={base?.id===recipe.id} onClick={()=>void choose(recipe)}>{recipe.name}<small>{MODEL_TASKS.find(task=>task.key===recipe.taskType)?.label??"已保存的任务"} · 第 {recipe.version} 版</small></button>)}</div><button className="nd-button" disabled={busy} onClick={()=>void read()}>重新读取目录</button>{catalog&&<fieldset disabled={locked||base?.editable===false} className="nd-composition-picker"><TreeSelector label="按分类选择指令组件" nodes={pickerNodes(catalog)} rule={{mode:"multiple",rootNodeId:null,depthMode:"whole_tree",relativeDepth:null,leafOnly:true,allowParentSelection:false,showFullPath:true,allowInlineCreate:false,aiSuggestible:false,minSelections:0,maxSelections:50}} selectedIds={draft.components.map(item=>item.cardId)} disabled={locked||base?.editable===false} onChange={ids=>{const cards=catalog.prompts.components.filter(card=>ids.includes(card.id));change({...draft,components:[...draft.components.filter(binding=>cards.some(card=>card.id===binding.cardId)),...cards.filter(card=>!draft.components.some(binding=>binding.cardId===card.id)).map(card=>({cardId:card.id,versionId:card.currentVersionId,enabled:card.values.enabled!==false}))]});}}/></fieldset>}</aside>
    <section className="nd-composition-editor">{base?.editable===false&&<section className="nd-message is-error"><h2>此历史配方只读</h2><p>{base.configurationIssue??"此页无法安全编辑其历史参数；原配方和引用保持不变。"}</p><p>可新建组合使用受支持的输入，不自动覆盖历史设置。</p></section>}<fieldset disabled={locked||base?.editable===false} className="nd-composition-edit-fields"><div className="nd-composition-form-grid"><label className="nd-control">组合名称<input value={draft.name} onChange={event=>change({...draft,name:event.target.value})}/></label><label className="nd-control">创作任务<select value={draft.taskType} onChange={event=>{change({...draft,taskType:event.target.value as RecipeDraft["taskType"]});changeParams(parameters());}}>{MODEL_TASKS.map(task=><option key={task.key} value={task.key}>{task.label}</option>)}</select></label></div><label className="nd-control">用途说明<textarea rows={2} value={draft.description} onChange={event=>change({...draft,description:event.target.value})}/></label><section><h2>指令排列与启停</h2>{draft.components.map((binding,index)=>{const card=catalog?.prompts.components.find(item=>item.id===binding.cardId);return <div className="nd-composition-binding" key={binding.cardId}><label><input type="checkbox" checked={binding.enabled} onChange={event=>change({...draft,components:draft.components.map((item,position)=>position===index?{...item,enabled:event.target.checked}:item)})}/>{index+1}. {card?.title??"原引用需复核"}</label><div className="nd-action-row"><button className="nd-button" disabled={index===0} onClick={()=>{const rows=[...draft.components];[rows[index-1],rows[index]]=[rows[index],rows[index-1]];change({...draft,components:rows});}}>上移</button><button className="nd-button" disabled={index===draft.components.length-1} onClick={()=>{const rows=[...draft.components];[rows[index+1],rows[index]]=[rows[index],rows[index+1]];change({...draft,components:rows});}}>下移</button><button className="nd-button" onClick={()=>change({...draft,components:draft.components.filter((_,position)=>position!==index)})}>移除引用</button>{card&&binding.versionId!==card.currentVersionId&&<button className="nd-button" onClick={()=>change({...draft,components:draft.components.map((item,position)=>position===index?{...item,versionId:card.currentVersionId}:item)})}>使用组件当前修订</button>}</div><details><summary>引用版本</summary><code>{binding.versionId}</code></details></div>;})}</section>
    <VariableEditor variables={draft.variables} values={variableValues} disabled={locked||base?.editable===false} onVariables={variables=>change({...draft,variables})} onValues={values=>{setVariableValues(values);setPreviewFresh(false);}}/>
    <section><h2>明确选择参考资料</h2><label className="nd-control">参考书籍<select value={draft.context.bookId??""} onChange={event=>void changeBook(event.target.value||null)}><option value="">暂不选择（可保存，不能预览）</option>{catalog?.books.filter(book=>book.status==="active").map(book=><option key={book.id} value={book.id}>{book.name}</option>)}</select></label><p>只引用勾选资料的确切修订，不自动读取全书，不创建新书或采用试运行结果。</p>{sources?.truncated&&<p>资料目录已截断，未显示的既有引用仍保留，不会静默移除。</p>}{draft.context.sources.filter(binding=>!sources?.cards.some(card=>card.id===binding.cardId)).map(binding=><p key={binding.cardId}>已保存的资料引用需复核；确切版本保留。</p>)}{sources?.cards.map(card=>{const selected=draft.context.sources.find(binding=>binding.cardId===card.id);return <div className="nd-composition-source" key={card.id}><label><input type="checkbox" checked={Boolean(selected)} onChange={event=>change({...draft,context:{...draft.context,sources:event.target.checked?[...draft.context.sources,{cardId:card.id,versionId:card.currentVersionId,role:"reference"}]:draft.context.sources.filter(binding=>binding.cardId!==card.id)}})}/>{card.title} · 修订 {card.revision}</label>{selected&&<><select aria-label={`${card.title}的参考用途`} value={selected.role} onChange={event=>change({...draft,context:{...draft.context,sources:draft.context.sources.map(binding=>binding.cardId===card.id?{...binding,role:event.target.value as "formal"|"reference"}:binding)}})}><option value="reference">参考资料</option><option value="formal">正式参考事实</option></select>{selected.versionId!==card.currentVersionId&&<button className="nd-button" onClick={()=>change({...draft,context:{...draft.context,sources:draft.context.sources.map(binding=>binding.cardId===card.id?{...binding,versionId:card.currentVersionId}:binding)}})}>使用资料当前修订</button>}<details><summary>引用版本</summary><code>{selected.versionId}</code></details></>}</div>;})}</section>{catalog&&<Parameters task={draft.taskType} value={params} catalog={catalog} bookId={draft.context.bookId} disabled={locked||base?.editable===false} onChange={changeParams}/>}<div className="nd-action-row"><button className="nd-button nd-button-primary" disabled={!draft.name.trim()||base?.editable===false} onClick={()=>void save()}>保存并启用组合</button><button className="nd-button" disabled={!base||dirty||!draft.context.bookId||base.editable===false} onClick={()=>void createPreview()}>生成冻结预览</button><button className="nd-button" disabled={!draft.context.bookId} onClick={()=>{setBusy(true);void loadSources(draft.context.bookId).catch(reason=>report(reason,"重新读取参考书籍资料")).finally(()=>setBusy(false));}}>重新读取参考资料</button></div>{dirty&&<p>组合结构有未保存的修改，保存后才能预览。仅改变本次参数也需重新预览。</p>}</fieldset></section></div>
    {catalog&&<PreviewResult catalog={catalog} preview={preview} result={result} canRun={previewFresh&&!dirty&&!pending} busy={locked} onRun={()=>void run()} onRefresh={()=>void refreshResult()}/>}<p><a href={COMPOSITION_ROUTE}>组合页面入口</a> · <a href="/new-design/resources/prompts" target="_blank" rel="noreferrer">维护指令组件</a></p>
  </main></ResourceShell>;
}
