import { useEffect, useMemo, useState } from "react";
import { CARD_TYPE_CAPABILITIES, type CardTypeCapability, type CardTypeCategory, type CardTypeSummary, type CardTypeTagBinding, type CardTypeVersion, type DictionarySummary, type FieldDefinition, type StandardFieldSemantic, type TagDimension, type TreeSelectionMode, type TreeSelectionRule } from "../common/contracts";
import { ApiError, newDesignApi } from "./api";
import DynamicForm from "./DynamicForm";
import FieldBuilder from "./FieldBuilder";

interface TypeDesignerProps {
  selected: CardTypeSummary | null;
  onSaved: (cardType: CardTypeSummary) => void;
  spaceId?: string;
  categories?: CardTypeCategory[];
}

const SYSTEM_SPACE_ID = "00000000-0000-4000-8000-000000000001";

const CAPABILITY_LABELS: Record<CardTypeCapability, { name: string; description: string }> = {
  body_text: { name: "承载正文", description: "可以挂接正式叙事文本" },
  timeline: { name: "进入时间线", description: "可以按故事时间定位" },
  state_change: { name: "形成状态变化", description: "会改变人物、关系或世界状态" },
  relation_subject: { name: "关联主体", description: "可以与其他资料建立关联" },
  lifecycle: { name: "生命周期", description: "具有计划、进行、完成等阶段" },
  creative_goal: { name: "创作目标", description: "服务作者的结构安排与生产计划" },
  canonical_fact: { name: "正式事实", description: "可作为故事世界的确定信息" },
};

function personStarterFields(): FieldDefinition[] {
  return [
    { key: "name", name: "姓名", description: "人物在故事中使用的姓名", type: "short_text", required: true, defaultValue: null, options: [], group: "基本信息", order: 0 },
    { key: "story_role", name: "人物定位", description: "例如主角、导师、对手或关键配角", type: "short_text", required: true, defaultValue: null, options: [], group: "故事职责", order: 1 },
    { key: "personality", name: "性格", description: "写下最影响行动选择的性格特点", type: "long_text", required: false, defaultValue: null, options: [], group: "人物内核", order: 2 },
    { key: "age", name: "年龄", description: "人物当前年龄", type: "number", required: false, defaultValue: null, options: [], group: "基本信息", order: 3 },
  ];
}

function blankType(spaceId = SYSTEM_SPACE_ID): CardTypeSummary {
  return {
    id: "",
    spaceId,
    key: `type_${Date.now().toString(36)}`,
    name: "",
    description: "",
    isSystem: false,
    sortOrder: 1_000,
    categoryId: null,
    categoryKey: null,
    semanticCapabilities: [],
    status: "draft",
    revision: 1,
    currentVersion: null,
    currentVersionId: null,
    draftFields: [],
    createdAt: "",
    updatedAt: "",
  };
}

function TagBindingEditor({binding,dimension,busy,onChange,onSave}:{binding:CardTypeTagBinding;dimension:TagDimension|null;busy:boolean;onChange:(next:CardTypeTagBinding)=>void;onSave:()=>void}){
  const patchRule=(next:Partial<TreeSelectionRule>)=>onChange({...binding,rule:{...binding.rule,...next}});
  return <article>
    <div><strong>{binding.dimensionName}</strong><small>{binding.includeInAiContext?"进入 AI 参考资料":"仅人工分类"} · {binding.includeInFilters?"可筛选":"不参与筛选"}</small></div>
    <div className="nd-form-grid">
      <label className="nd-control"><span>选择方式</span><select value={binding.rule.mode} onChange={event=>{const mode=event.target.value as TreeSelectionMode;patchRule({mode,maxSelections:mode==="single"||mode==="cascade_single"?1:binding.rule.maxSelections});}}><option value="single">单选</option><option value="multiple">多选</option><option value="cascade_single">逐级单选</option><option value="cascade_multiple">逐级多选</option></select></label>
      <label className="nd-control"><span>可选范围</span><select value={binding.rule.depthMode} onChange={event=>{const depthMode=event.target.value as TreeSelectionRule["depthMode"];patchRule({depthMode,rootNodeId:depthMode==="whole_tree"?null:binding.rule.rootNodeId,relativeDepth:depthMode==="relative_depth"?(binding.rule.relativeDepth??1):null});}}><option value="whole_tree">整棵树</option><option value="branch">包含指定节点的分支</option><option value="direct_children">仅指定节点的直接下级</option><option value="descendants">指定节点的所有后代</option><option value="relative_depth">指定节点以下若干层</option></select></label>
      {binding.rule.depthMode!=="whole_tree"&&<label className="nd-control"><span>范围起点</span><select value={binding.rule.rootNodeId??""} onChange={event=>patchRule({rootNodeId:event.target.value||null})}><option value="">请选择节点</option>{(dimension?.nodes??[]).filter(node=>node.status==="active").map(node=><option key={node.id} value={node.id}>{node.path.map(part=>part.name).join(" / ")||node.name}</option>)}</select></label>}
      {binding.rule.depthMode==="relative_depth"&&<label className="nd-control"><span>向下开放层数</span><input type="number" min="1" value={binding.rule.relativeDepth??1} onChange={event=>patchRule({relativeDepth:Math.max(1,Number(event.target.value)||1)})}/></label>}
      <label className="nd-control"><span>最少选择</span><input type="number" min="0" value={binding.rule.minSelections} onChange={event=>{const minSelections=Math.max(0,Number(event.target.value)||0);onChange({...binding,required:minSelections>0,rule:{...binding.rule,minSelections}});}}/></label>
      <label className="nd-control"><span>最多选择</span><input type="number" min="1" disabled={binding.rule.mode==="single"||binding.rule.mode==="cascade_single"} placeholder="不限" value={binding.rule.maxSelections??""} onChange={event=>patchRule({maxSelections:event.target.value?Math.max(1,Number(event.target.value)):null})}/></label>
      <label className="nd-control"><span>显示位置</span><select value={binding.displayArea} onChange={event=>onChange({...binding,displayArea:event.target.value as CardTypeTagBinding["displayArea"]})}><option value="main">主表单</option><option value="sidebar">侧边栏</option><option value="metadata">分类信息</option></select></label>
    </div>
    <div className="nd-tree-rule-checks">
      <label className="nd-check-control"><input type="checkbox" checked={binding.rule.leafOnly} onChange={event=>patchRule({leafOnly:event.target.checked})}/><span>仅允许最末级</span></label>
      <label className="nd-check-control"><input type="checkbox" checked={binding.rule.allowParentSelection} onChange={event=>patchRule({allowParentSelection:event.target.checked})}/><span>允许选择有下级的节点</span></label>
      <label className="nd-check-control"><input type="checkbox" checked={binding.rule.showFullPath} onChange={event=>patchRule({showFullPath:event.target.checked})}/><span>显示完整路径</span></label>
      <label className="nd-check-control"><input type="checkbox" checked={binding.rule.allowInlineCreate} onChange={event=>patchRule({allowInlineCreate:event.target.checked})}/><span>允许原地新增</span></label>
      <label className="nd-check-control"><input type="checkbox" checked={binding.rule.aiSuggestible} onChange={event=>patchRule({aiSuggestible:event.target.checked})}/><span>允许 AI 建议</span></label>
      <label className="nd-check-control"><input type="checkbox" checked={binding.includeInFilters} onChange={event=>onChange({...binding,includeInFilters:event.target.checked})}/><span>可用于筛选</span></label>
      <label className="nd-check-control"><input type="checkbox" checked={binding.includeInAiContext} onChange={event=>onChange({...binding,includeInAiContext:event.target.checked})}/><span>进入 AI 参考资料</span></label>
    </div>
    <button className="nd-button nd-button-secondary" type="button" disabled={busy} onClick={onSave}>保存维度规则</button>
  </article>;
}

export default function TypeDesigner({ selected, onSaved, spaceId = SYSTEM_SPACE_ID, categories = [] }: TypeDesignerProps) {
  const [draft, setDraft] = useState<CardTypeSummary>(() => selected ?? blankType(spaceId));
  const [versions, setVersions] = useState<CardTypeVersion[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [dictionaries,setDictionaries]=useState<DictionarySummary[]>([]),[semantics,setSemantics]=useState<StandardFieldSemantic[]>([]),[dimensions,setDimensions]=useState<TagDimension[]>([]),[tagBindings,setTagBindings]=useState<CardTypeTagBinding[]>([]),[dimensionId,setDimensionId]=useState("");

  useEffect(() => {
    setDraft(selected ?? blankType(spaceId));
    setMessage(null);
    if (!selected?.id) {
      setVersions([]);
      return;
    }
    void newDesignApi.listCardTypeVersions(selected.id).then(setVersions).catch(() => setVersions([]));
  }, [selected, spaceId]);
  useEffect(()=>{void Promise.all([newDesignApi.listDictionaries(spaceId===SYSTEM_SPACE_ID?undefined:spaceId),newDesignApi.listStandardFieldSemantics(),newDesignApi.listTagDimensions(spaceId)]).then(([nextDictionaries,nextSemantics,nextDimensions])=>{setDictionaries(nextDictionaries);setSemantics(nextSemantics);setDimensions(nextDimensions);setDimensionId(current=>current||nextDimensions[0]?.id||"");}).catch(()=>undefined);},[spaceId]);
  useEffect(()=>{if(!selected?.id){setTagBindings([]);return;}void newDesignApi.listCardTypeTagBindings(selected.id).then(setTagBindings).catch(()=>setTagBindings([]));},[selected?.id]);

  const publishedKeys = useMemo(() => new Set((versions[0]?.fields ?? []).map((field) => field.key)), [versions]);
  const toggleCapability = (capability: CardTypeCapability) => {
    const selectedCapabilities = new Set(draft.semanticCapabilities);
    if (selectedCapabilities.has(capability)) selectedCapabilities.delete(capability);
    else selectedCapabilities.add(capability);
    setDraft({ ...draft, semanticCapabilities: CARD_TYPE_CAPABILITIES.filter((item) => selectedCapabilities.has(item)) });
  };
  const save = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const saved = draft.id ? await newDesignApi.updateCardType(draft) : await newDesignApi.createCardType(draft);
      setDraft(saved);
      onSaved(saved);
      setMessage({ tone: "success", text: "草稿已保存。" });
    } catch (error) {
      const text = error instanceof ApiError ? error.message : "草稿保存失败。";
      setMessage({ tone: "error", text });
    } finally {
      setBusy(false);
    }
  };
  const publish = async () => {
    if (!draft.id) {
      setMessage({ tone: "error", text: "请先保存草稿，再发布版本。" });
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const published = await newDesignApi.publishCardType(draft.id, draft.revision);
      const nextVersions = await newDesignApi.listCardTypeVersions(draft.id);
      setDraft(published);
      setVersions(nextVersions);
      onSaved(published);
      setMessage({ tone: "success", text: `版本 v${published.currentVersion} 已发布，可以创建资料。` });
    } catch (error) {
      const text = error instanceof ApiError ? error.message : "发布失败。";
      setMessage({ tone: "error", text });
    } finally {
      setBusy(false);
    }
  };
  const addTagBinding=async()=>{if(!draft.id||!dimensionId)return;setBusy(true);try{const saved=await newDesignApi.createCardTypeTagBinding({cardTypeId:draft.id,dimensionId,rule:{mode:"multiple",rootNodeId:null,depthMode:"whole_tree",relativeDepth:null,leafOnly:false,allowParentSelection:true,showFullPath:true,allowInlineCreate:true,aiSuggestible:true,minSelections:0,maxSelections:5},required:false,displayArea:"metadata",includeInFilters:true,includeInAiContext:true});setTagBindings(items=>[...items,saved]);setMessage({tone:"success",text:"标签维度已绑定。"});}catch(error){setMessage({tone:"error",text:error instanceof Error?error.message:"标签维度绑定失败。"});}finally{setBusy(false);}};
  const saveTagBinding=async(binding:CardTypeTagBinding)=>{setBusy(true);try{const saved=await newDesignApi.updateCardTypeTagBinding(binding);setTagBindings(items=>items.map(item=>item.id===saved.id?saved:item));setMessage({tone:"success",text:"标签选择规则已保存。"});}catch(error){setMessage({tone:"error",text:error instanceof Error?error.message:"标签规则保存失败。"});}finally{setBusy(false);}};

  return (
    <div className="nd-designer-grid">
      <div className="nd-editor-column">
        <section className="nd-section nd-type-overview">
          <div className="nd-section-heading">
            <div>
              <p className="nd-kicker">内容类型</p>
              <h1>{draft.id ? draft.name || "未命名类型" : "新建内容类型"}</h1>
            </div>
            <span className={`nd-status nd-status-${draft.status}`}>
              {draft.isSystem ? "系统内置 · " : ""}{draft.currentVersion ? `已发布 v${draft.currentVersion}` : "草稿"}
            </span>
          </div>
          <div className="nd-grid-2">
            <label className="nd-control">
              <span>类型名称</span>
              <input value={draft.name} placeholder="例如：人物" onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
            </label>
            <label className="nd-control nd-control-wide">
              <span>用途说明</span>
              <input value={draft.description} placeholder="这类资料帮助作者记录什么" onChange={(event) => setDraft({ ...draft, description: event.target.value })} />
            </label>
          </div>
          {categories.length>0&&<label className="nd-control"><span>所属分类</span><select value={draft.categoryId??""} onChange={(event)=>setDraft({...draft,categoryId:event.target.value||null,categoryKey:categories.find((item)=>item.id===event.target.value)?.key??null})}><option value="">未分类</option>{categories.map((category)=><option key={category.id} value={category.id}>{category.parentId?"　":""}{category.name}</option>)}</select><small>分类只管理目录位置，不会让类型继承字段。</small></label>}
          {!draft.id && draft.draftFields.length === 0 && (
            <button className="nd-inline-action" type="button" onClick={() => setDraft({ ...draft, name: draft.name || "人物", description: draft.description || "记录故事人物的身份、职责与性格。", draftFields: personStarterFields() })}>
              使用人物字段示例开始
            </button>
          )}
          <div className="nd-capability-section">
            <div>
              <p className="nd-kicker">语义能力</p>
              <p className="nd-help-text">描述这类资料能参与哪些通用流程，不把题材规则写死在底层。</p>
            </div>
            <div className="nd-capability-grid">
              {CARD_TYPE_CAPABILITIES.map((capability) => {
                const label = CAPABILITY_LABELS[capability];
                const checked = draft.semanticCapabilities.includes(capability);
                return (
                  <label className={`nd-capability${checked ? " is-selected" : ""}`} key={capability}>
                    <input type="checkbox" checked={checked} onChange={() => toggleCapability(capability)} />
                    <span><strong>{label.name}</strong><small>{label.description}</small></span>
                  </label>
                );
              })}
            </div>
          </div>
        </section>

        <FieldBuilder fields={draft.draftFields} publishedKeys={publishedKeys} allowPublishedPresentationEdits={draft.spaceId !== SYSTEM_SPACE_ID} dictionaries={dictionaries} semantics={semantics} onChange={(draftFields) => setDraft({ ...draft, draftFields })} />

        <section className="nd-section nd-tag-binding-section">
          <div className="nd-section-heading">
            <div><p className="nd-kicker">多维标签</p><h2>给这类资料绑定标签树</h2><p className="nd-help-text">每个维度独立控制选择范围、数量和 AI 建议，不会写进正式字段值。</p></div>
            {draft.id&&dimensions.length?<div className="nd-row-actions"><select aria-label="选择标签维度" value={dimensionId} onChange={event=>setDimensionId(event.target.value)}>{dimensions.filter(item=>!tagBindings.some(binding=>binding.dimensionId===item.id)).map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select><button className="nd-button nd-button-secondary" type="button" disabled={busy||!dimensionId||tagBindings.some(item=>item.dimensionId===dimensionId)} onClick={()=>void addTagBinding()}>＋ 绑定维度</button></div>:null}
          </div>
          {!draft.id?<div className="nd-empty nd-empty-compact">先保存内容类型，再绑定标签维度。</div>:tagBindings.length?<div className="nd-tag-binding-list">{tagBindings.map((binding,index)=><TagBindingEditor key={binding.id} binding={binding} dimension={dimensions.find(item=>item.id===binding.dimensionId)??null} busy={busy} onChange={next=>setTagBindings(items=>items.map((item,i)=>i===index?next:item))} onSave={()=>void saveTagBinding(binding)}/>)}</div>:<div className="nd-empty nd-empty-compact">还没有绑定标签维度。</div>}
        </section>

        <footer className="nd-sticky-actions">
          <div>
            {message && <p className={`nd-message is-${message.tone}`}>{message.text}</p>}
            {!message && <p className="nd-save-hint">先保存草稿；确认字段后再发布为不可变版本。</p>}
          </div>
          <div className="nd-action-row">
            <button className="nd-button nd-button-secondary" type="button" disabled={busy || !draft.name.trim()} onClick={save}>{busy ? "处理中…" : "保存草稿"}</button>
            <button className="nd-button nd-button-primary" type="button" disabled={busy || !draft.id || draft.draftFields.length === 0} onClick={publish}>发布新版本</button>
          </div>
        </footer>
      </div>

      <aside className="nd-preview-column">
        <div className="nd-preview-header">
          <p className="nd-kicker">实时表单预览</p>
          <span>{draft.draftFields.length} 个字段</span>
        </div>
        <div className="nd-preview-paper">
          <div className="nd-preview-title">
            <span>FORM · {String((draft.currentVersion ?? 0) + 1).padStart(2, "0")}</span>
            <h2>{draft.name || "未命名资料"}</h2>
            <p>{draft.description || "填写类型说明后，作者会在这里理解表单用途。"}</p>
          </div>
          <DynamicForm fields={draft.draftFields} values={{}} preview />
        </div>
      </aside>
    </div>
  );
}
