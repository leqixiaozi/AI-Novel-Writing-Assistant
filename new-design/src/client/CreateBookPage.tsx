import { useEffect, useMemo, useState } from "react";
import type { BookCreationMethod, BookCreationSession, InspirationCandidate, TemplateGroupSummary } from "../common/contracts";
import { newDesignApi } from "./api";

const METHODS: Array<{key:BookCreationMethod;index:string;title:string;description:string;ai:boolean}> = [
  {key:"blank",index:"01",title:"空白开书",description:"只填写书名，先建立完整创作表单。",ai:false},
  {key:"template",index:"02",title:"模板开书",description:"带入模板准备好的示例与默认内容。",ai:false},
  {key:"idea",index:"03",title:"一句话灵感",description:"让 AI 给出三个可生产的故事方向。",ai:true},
  {key:"inspiration",index:"04",title:"没有想法",description:"从灵感候选中选一个，再由 AI 展开。",ai:true},
  {key:"market",index:"05",title:"市场方向",description:"把市场观察或选题简报转成创作方向。",ai:true},
  {key:"reference",index:"06",title:"拆书参考",description:"提取可迁移的结构约束，不复制原作。",ai:true},
  {key:"continuation",index:"07",title:"续写已有作品",description:"整理已有内容和续写边界，再进入统一表单。",ai:true},
];

const STAGE_LABELS:Record<string,string> = {
  understand_source:"正在理解创作来源",
  generate_directions:"正在准备创作方向",
  direction_confirmation:"请选择一个方向",
  map_template_fields:"正在匹配创作表单",
  generate_initial_content:"正在生成人物与世界基础",
  review_initial_content:"初始资料已准备好",
  install_template:"正在安装书籍结构",
  ready:"书籍已创建",
};

const TYPE_LABELS: Record<string, string> = {
  project_rule: "作品约定",
  story_idea: "故事构思",
  world_setting: "世界观",
  work_contract: "作品约定",
  story_concept: "故事构思",
  worldview: "世界观",
  character: "人物",
  location: "地点",
  organization: "组织／势力",
  faction: "势力",
  prop: "道具",
  event: "事件",
  world_rule: "世界规则",
  timeline_rule: "时间规则",
  goal_task: "目标／任务",
  conflict: "冲突",
  secret_truth: "秘密／真相",
  clue_evidence: "线索／证据",
  foreshadow: "伏笔",
  suspense_question: "悬念／问题",
  plotline: "剧情线",
  plot_beat: "剧情节点／节拍",
  arc: "弧线／变化线",
  theme: "主题／命题",
  clue: "线索与伏笔",
  relationship: "关系",
  volume: "分卷",
  chapter: "章节",
  scene: "场景",
  genre_strategy: "题材策略",
  progression_mode: "成长模式",
  writing_config: "写作配置",
  quality_rule: "质量规则",
  world_overview: "世界概览",
  power_system: "能力／科技／修炼体系",
  race: "种族",
  culture: "文化",
  religion: "宗教信仰",
  reference_material: "参考资料",
};

export default function CreateBookPage() {
  const [templates,setTemplates]=useState<TemplateGroupSummary[]>([]);
  const [inspirations,setInspirations]=useState<InspirationCandidate[]>([]);
  const [method,setMethod]=useState<BookCreationMethod>("blank");
  const [templateVersionId,setTemplateVersionId]=useState("");
  const [bookName,setBookName]=useState("");
  const [description,setDescription]=useState("");
  const [sourceReference,setSourceReference]=useState("");
  const [sourceText,setSourceText]=useState("");
  const [inspirationId,setInspirationId]=useState("");
  const [session,setSession]=useState<BookCreationSession|null>(null);
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState("");

  useEffect(()=>{void Promise.all([newDesignApi.listTemplates(),newDesignApi.listInspirationCandidates()]).then(([allTemplates,allInspirations])=>{const published=allTemplates.filter((item)=>item.currentVersionId);setTemplates(published);setTemplateVersionId(published[0]?.currentVersionId??"");setInspirations(allInspirations);setInspirationId(allInspirations[0]?.id??"");}).catch((error)=>setMessage(error instanceof Error?error.message:"开书选项加载失败。"));},[]);
  const selectedMethod=METHODS.find((item)=>item.key===method)!;
  const selectedInspiration=inspirations.find((item)=>item.id===inspirationId);
  const step=session?.status==="review"?4:session?.status==="waiting_direction"||session?.selectedDirectionId?3:session?2:1;
  const groupedCards=useMemo(()=>Object.entries(session?.initialCards.reduce<Record<string,number>>((result,card)=>{const label=TYPE_LABELS[card.typeKey]??"创作资料";return {...result,[label]:(result[label]??0)+1};},{})??{}),[session]);

  const pollDuring=async(id:string,action:()=>Promise<BookCreationSession>)=>{const timer=window.setInterval(()=>void newDesignApi.getBookCreationSession(id).then(setSession).catch(()=>undefined),700);try{const result=await action();setSession(result);return result;}finally{window.clearInterval(timer);}};
  const complete=async(target:BookCreationSession,keepCurrentResult=false)=>{const completed=await newDesignApi.completeBookCreation(target.id,keepCurrentResult);setSession(completed);if(completed.bookId)window.location.href=`/new-design/books/${completed.bookId}/forms`;};
  const start=async()=>{setBusy(true);setMessage("");try{const payload:Record<string,unknown>={};if(method==="idea")payload.idea=sourceText;if(method==="inspiration"&&selectedInspiration){payload.inspirationId=selectedInspiration.id;payload.inspiration=`${selectedInspiration.title}：${selectedInspiration.premise}`;}if(method==="market")payload.marketBrief=sourceText;if(method==="reference"||method==="continuation")payload.sourceMaterial=sourceText;const created=await newDesignApi.createBookCreationSession({method,templateVersionId,bookName,description,sourceReference,inputPayload:payload});setSession(created);if(!selectedMethod.ai){await complete(created);return;}const generated=await pollDuring(created.id,()=>newDesignApi.generateBookDirections(created.id));setSession(generated);}catch(error){setMessage(error instanceof Error?error.message:"开书流程启动失败。");if(session)void newDesignApi.getBookCreationSession(session.id).then(setSession).catch(()=>undefined);}finally{setBusy(false);}};
  const chooseDirection=async(directionId:string)=>{if(!session)return;setBusy(true);setMessage("");try{const selected=await newDesignApi.selectBookDirection(session.id,directionId);setSession(selected);const generated=await pollDuring(selected.id,()=>newDesignApi.generateBookInitialContent(selected.id));setSession(generated);}catch(error){setMessage(error instanceof Error?error.message:"初始资料生成失败。");void newDesignApi.getBookCreationSession(session.id).then(setSession).catch(()=>undefined);}finally{setBusy(false);}};
  const retry=async()=>{if(!session)return;setBusy(true);setMessage("");try{const next=session.selectedDirectionId?await pollDuring(session.id,()=>newDesignApi.generateBookInitialContent(session.id)):await pollDuring(session.id,()=>newDesignApi.generateBookDirections(session.id));setSession(next);}catch(error){setMessage(error instanceof Error?error.message:"重试失败。");void newDesignApi.getBookCreationSession(session.id).then(setSession).catch(()=>undefined);}finally{setBusy(false);}};
  const createFromReview=async()=>{if(!session)return;setBusy(true);setMessage("");try{await complete(session);}catch(error){setMessage(error instanceof Error?error.message:"创建书籍失败。");void newDesignApi.getBookCreationSession(session.id).then(setSession).catch(()=>undefined);}finally{setBusy(false);}};

  return <div className="nd-shell nd-create-flow">
    <header className="nd-create-header"><div><a href="/new-design/books">← 返回我的书籍</a><p className="nd-eyebrow">新设计 · 统一开书</p><h1>从你现在拥有的内容开始</h1><p>入口只决定第一次怎么准备内容。创建后都会进入相同的创作表单和本书资料库。</p></div><ol className="nd-stepper"><li className={step>=1?"is-active":""}><b>1</b><span>选择起点</span></li><li className={step>=2?"is-active":""}><b>2</b><span>AI 理解</span></li><li className={step>=3?"is-active":""}><b>3</b><span>确认方向</span></li><li className={step>=4?"is-active":""}><b>4</b><span>建立书籍</span></li></ol></header>

    {!session?<main className="nd-create-layout"><section><div className="nd-section-heading"><div><p className="nd-kicker">选择起点</p><h2>你准备从哪里开始？</h2></div></div><div className="nd-method-list">{METHODS.map((item)=><button className={method===item.key?"is-selected":""} key={item.key} type="button" onClick={()=>setMethod(item.key)}><span>{item.index}</span><div><strong>{item.title}</strong><small>{item.description}</small></div><b>{item.ai?"AI 辅助":"直接建立"}</b></button>)}</div></section><section className="nd-create-input"><div className="nd-section-heading"><div><p className="nd-kicker">{selectedMethod.index} · {selectedMethod.title}</p><h2>准备开书信息</h2></div></div><label className="nd-control"><span>创作模板</span><select value={templateVersionId} onChange={(event)=>setTemplateVersionId(event.target.value)}>{templates.map((template)=><option key={template.id} value={template.currentVersionId??""}>{template.name} · v{template.currentVersion}</option>)}</select><small>模板决定进入书籍后的字段、说明和关系；开书方式不会改变它。</small></label><div className="nd-form-grid"><label className="nd-control"><span>书名{method==="blank"||method==="template"?" *":""}</span><input value={bookName} placeholder={selectedMethod.ai?"可暂不填写，由方向生成":"输入作品名称"} onChange={(event)=>setBookName(event.target.value)}/></label><label className="nd-control"><span>一句话说明</span><input value={description} placeholder="你希望读者获得什么体验" onChange={(event)=>setDescription(event.target.value)}/></label></div>{method==="idea"&&<label className="nd-control"><span>一句话灵感 *</span><textarea rows={6} value={sourceText} placeholder="例如：一个能看见别人记忆的人，却唯独忘了自己的过去。" onChange={(event)=>setSourceText(event.target.value)}/></label>}{method==="inspiration"&&<><label className="nd-control"><span>选择一个灵感 *</span><select value={inspirationId} onChange={(event)=>setInspirationId(event.target.value)}>{inspirations.map((item)=><option key={item.id} value={item.id}>{item.title}</option>)}</select></label>{selectedInspiration&&<div className="nd-source-note"><strong>{selectedInspiration.title}</strong><p>{selectedInspiration.premise}</p><span>{selectedInspiration.tone.join(" · ")}</span></div>}</>}{method==="market"&&<><label className="nd-control"><span>来源名称或链接</span><input value={sourceReference} placeholder="市场雷达记录、报告名称或网址" onChange={(event)=>setSourceReference(event.target.value)}/></label><label className="nd-control"><span>市场观察／选题简报 *</span><textarea rows={7} value={sourceText} placeholder="粘贴真实简报内容，AI 会将它转换为故事方向。" onChange={(event)=>setSourceText(event.target.value)}/></label></>}{(method==="reference"||method==="continuation")&&<><label className="nd-control"><span>{method==="reference"?"参考作品／拆书记录":"已有作品名称或来源"}</span><input value={sourceReference} onChange={(event)=>setSourceReference(event.target.value)}/></label><label className="nd-control"><span>{method==="reference"?"可迁移的分析与约束 *":"已有内容摘要与续写要求 *"}</span><textarea rows={8} value={sourceText} placeholder={method==="reference"?"填写你自己的拆书结论、节奏观察与想借鉴的机制。":"填写已有剧情、人物现状、不能改动的事实和希望续写的方向。"} onChange={(event)=>setSourceText(event.target.value)}/></label></>}{message&&<p className="nd-message is-error">{message}</p>}<div className="nd-editor-actions"><a className="nd-button nd-button-secondary" href="/new-design/books">取消</a><button className="nd-button nd-button-primary" disabled={busy||!templateVersionId||((method==="blank"||method==="template")&&!bookName.trim())||(selectedMethod.ai&&method!=="inspiration"&&!sourceText.trim())} type="button" onClick={()=>void start()}>{busy?"正在准备…":selectedMethod.ai?"生成创作方向":"创建并进入"}</button></div></section></main>:<main className="nd-generation-stage">{session.status==="generating"&&<section className="nd-progress-panel"><div className="nd-progress-orbit"><span>{session.progress}%</span></div><p className="nd-kicker">AI 正在整理</p><h2>{STAGE_LABELS[session.stage]??"正在准备书籍内容"}</h2><p>内容会按所选模板的字段生成，不会建立另一套资料。</p><div className="nd-progress-track"><i style={{width:`${session.progress}%`}}/></div></section>}{session.status==="waiting_direction"&&<section><div className="nd-section-heading"><div><p className="nd-kicker">方向确认</p><h2>选择你真正想写的一条路</h2><p>确认后，AI 会按同一套模板准备世界、人物和核心冲突。</p></div></div><div className="nd-direction-list">{session.directionCandidates.map((direction,index)=><article key={direction.id}><span>方向 {index+1}</span><h3>{direction.title}</h3><p>{direction.premise}</p><dl><div><dt>主角</dt><dd>{direction.protagonist}</dd></div><div><dt>核心冲突</dt><dd>{direction.centralConflict}</dd></div><div><dt>阅读承诺</dt><dd>{direction.readerPromise}</dd></div></dl><div className="nd-direction-footer"><small>{direction.styleKeywords.join(" · ")}</small><button className="nd-button nd-button-primary" disabled={busy} type="button" onClick={()=>void chooseDirection(direction.id)}>采用这个方向</button></div></article>)}</div><button className="nd-text-button" type="button" onClick={()=>setSession(null)}>调整原始输入</button></section>}{session.status==="review"&&<section className="nd-review-panel"><div><p className="nd-kicker">初始资料预览</p><h2>{session.directionCandidates.find((item)=>item.id===session.selectedDirectionId)?.title||session.bookName}</h2><p>AI 已按模板准备 {session.initialCards.length} 条资料。进入书籍后，它们仍通过相同的创作表单查看和编辑。</p></div><div className="nd-review-summary">{groupedCards.map(([typeKey,count])=><div key={typeKey}><strong>{count}</strong><span>{typeKey}</span></div>)}</div><div className="nd-source-note"><strong>写入规则</strong><p>这些内容会标记为“AI 草稿”。只有你在表单中确认或修改后才成为已确认内容；以后重跑 AI 不会静默覆盖你的修改。</p></div><div className="nd-editor-actions"><button className="nd-button nd-button-secondary" disabled={busy} type="button" onClick={()=>void retry()}>重新生成</button><button className="nd-button nd-button-primary" disabled={busy} type="button" onClick={()=>void createFromReview()}>{busy?"正在建立书籍…":"确认并进入创作"}</button></div></section>}{session.status==="failed"&&<section className="nd-failure-panel"><p className="nd-kicker">流程停在 {STAGE_LABELS[session.lastFailedStage??session.stage]??"当前步骤"}</p><h2>这一步没有完成</h2><p>{session.errorMessage||message||"请重试或调整输入。"}</p><div className="nd-editor-actions"><button className="nd-button nd-button-secondary" type="button" onClick={()=>setSession(null)}>调整输入</button><button className="nd-button nd-button-secondary" disabled={busy} type="button" onClick={()=>void complete(session,true)}>{session.initialCards.length?"保留当前结果进入":"先建立空白书籍"}</button><button className="nd-button nd-button-primary" disabled={busy} type="button" onClick={()=>void retry()}>重试当前步骤</button></div></section>}</main>}
  </div>;
}
