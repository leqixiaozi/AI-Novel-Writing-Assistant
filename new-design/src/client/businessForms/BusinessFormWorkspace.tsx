import ReferenceForms from "../referenceParity/Forms";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  BookSummary,
  BookViewWorkspace,
  CardGroupFormSummary,
  CardGroupFormVersion,
  CardSummary,
  CardTypeSummary,
  CardTypeVersion,
  CardVersion,
  FieldDefinition,
  ScopedFieldBundle,
  ScopedFieldDefinition,
  ScopedFieldVersion,
} from "../../common/contracts";
import { ApiError, newDesignApi } from "../api";
import DynamicForm from "../DynamicForm";
import AddInformationDialog from "./AddInformationDialog";
import AssociationPanel from "./AssociationPanel";
import MaterialManagementPanel from "./MaterialManagementPanel";
import { CardTagFields } from "../tree";
import {
  SCOPE_COPY,
  cardsForType,
  defaultValues,
  resolveBusinessForm,
  typesForScope,
  type BusinessFormScope,
} from "./model";
import "./business-form.css";
import type {AuthorMaterialWriteReceipt} from "../../common/authorMaterials";
import {stableWorldConsistencyValue,type WorldConsistencyRepairDraft} from "../../common/worldConsistency";
import {businessUuid,readBusinessDraft,retainBusinessDraft,clearBusinessDraft,type BusinessDraftRecovery} from "./draftRecovery";

export interface BusinessEditorState {dirty:boolean;locked:boolean;preserveDraft:()=>boolean;save?:()=>Promise<boolean>;discard?:()=>boolean;}

interface Props {
  book: BookSummary;
  cardTypes: CardTypeSummary[];
  scope: BusinessFormScope;
  initialCardId?:string;
  embedded?:boolean;
  compact?:boolean;
  fieldSection?:import('../../common/formPresentation').CharacterFieldSection;
  initialTypeId?:string;
  startCreating?:boolean;
  onEditorStateChange?:(state:BusinessEditorState)=>void;
  onSaved?:()=>Promise<void>;
  repairDraft?:WorldConsistencyRepairDraft;
  batchDraft?:import("../../common/storyWorkspace").StoryBatchDraft;
  onSavedReceipt?:(receipt:AuthorMaterialWriteReceipt)=>void;
}

interface ConflictState {
  localTitle: string;
  localValues: Record<string, unknown>;
  latest: CardSummary | null;
}

function historySource(source: CardVersion["source"]): string {
  return { create: "首次创建", edit: "作者修改", archive: "归档", restore: "恢复使用" }[source];
}

function displayValue(value: unknown, field?: FieldDefinition): string {
  if (value === null || value === undefined || value === "") return "未填写";
  if (Array.isArray(value)) return value.map((item) => field?.options.find((option) => option.value === item)?.label ?? String(item)).join("、") || "未填写";
  if (typeof value === "boolean") return value ? "是" : "否";
  return field?.options.find((option) => option.value === value)?.label ?? String(value);
}

function changedKeys(local: Record<string, unknown>, latest: Record<string, unknown>): string[] {
  return [...new Set([...Object.keys(local), ...Object.keys(latest)])].filter((key) => JSON.stringify(local[key]) !== JSON.stringify(latest[key]));
}

const TYPE_LABELS:Record<string,string>={short_text:"短文本",long_text:"长文本",number:"数字",boolean:"是／否",select:"单选",multi_select:"多选",date:"日期"};
function fieldSourceDetail(item:ScopedFieldDefinition){if(item.origin==="core")return "系统核心规格";if(item.origin==="template")return `随模板安装${item.sourceTemplateVersionId?` · 来源版本 ${item.sourceTemplateVersionId.slice(0,8)}`:""}`;if(item.origin==="book_extension")return `本书独立规格 · 字段版本 ${item.currentVersion.version}`;return `当前资料独立补充 · 字段版本 ${item.currentVersion.version}`;}

export default function BusinessFormWorkspace({ book, cardTypes, scope,initialCardId,embedded=false,compact=false,fieldSection,initialTypeId,startCreating=false,onEditorStateChange,onSaved,repairDraft,batchDraft,onSavedReceipt }: Props) {
  const [batchApplied,setBatchApplied]=useState("");
  const [browserMode,setBrowserMode]=useState<"types"|"tags"|"groups"|"views">("types");
  const [liveCardTypes,setLiveCardTypes]=useState(cardTypes);
  const availableTypes = useMemo(() => typesForScope(liveCardTypes, scope), [liveCardTypes, scope]);
  const [selectedTypeId, setSelectedTypeId] = useState(initialTypeId??"");
  const [workspace, setWorkspace] = useState<BookViewWorkspace | null>(null);
  const associationEditor=useRef<BusinessEditorState|null>(null);
  const [associationFlags,setAssociationFlags]=useState({dirty:false,locked:false});
  const receiveAssociations=useCallback((state:BusinessEditorState)=>{associationEditor.current=state;setAssociationFlags(current=>current.dirty===state.dirty&&current.locked===state.locked?current:{dirty:state.dirty,locked:state.locked});},[]);
  const [formCommandLocked,setFormCommandLocked]=useState(false);
  const [activeForms,setActiveForms]=useState<Record<string,string>>({});
  const [forms, setForms] = useState<CardGroupFormSummary[]>([]);
  const [formVersions, setFormVersions] = useState<Map<string, CardGroupFormVersion[]>>(new Map());
  const [typeVersions, setTypeVersions] = useState<CardTypeVersion[]>([]);
  const [editing, setEditing] = useState<CardSummary | null>(null);
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [localValues,setLocalValues]=useState<Record<string,unknown>>({});
  const [aiDraftDecisionIds,setAiDraftDecisionIds]=useState<string[]>([]);
  const [draftTagIds,setDraftTagIds]=useState<string[]|undefined>(undefined);
  const [scopedFields,setScopedFields]=useState<ScopedFieldBundle>({definitions:[],values:{}});
  const [addingInformation,setAddingInformation]=useState(false);
  const [editingField,setEditingField]=useState<ScopedFieldDefinition|null>(null);
  const [fieldHistory,setFieldHistory]=useState<{definition:ScopedFieldDefinition;versions:ScopedFieldVersion[]}|null>(null);
  const [issues, setIssues] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [aiLocked,setAiLocked]=useState(false);
  const [history, setHistory] = useState<CardVersion[] | null>(null);
  const [historyTitle, setHistoryTitle] = useState("");
  const [conflict, setConflict] = useState<ConflictState | null>(null);
  const [unknownWrite,setUnknownWrite]=useState(false),[failureStep,setFailureStep]=useState(""),[savedProof,setSavedProof]=useState("");
  const [sourcesReady,setSourcesReady]=useState(false);
  const [requestKey,setRequestKey]=useState<string|null>(null),[notWritten,setNotWritten]=useState(false),[receiptChecked,setReceiptChecked]=useState(false);
  const editorRef=useRef<HTMLDivElement>(null);
  const restoringDraft=useRef<BusinessDraftRecovery|null>(null),requestedRef=useRef(""),saveInFlight=useRef(false),liveBook=useRef(book.id),editingScope=useRef(book.id);liveBook.current=book.id;
  const requestedCardId=initialCardId??new URLSearchParams(location.search).get("selected")??"";
  const baselineTags=useRef<string[]>([]);
  const dirty=!!editing&&(title!==editing.title||JSON.stringify(values)!==JSON.stringify(editing.values)||JSON.stringify(localValues)!==JSON.stringify(scopedFields.values)||aiDraftDecisionIds.length>0||draftTagIds!==undefined&&JSON.stringify([...draftTagIds].sort())!==JSON.stringify([...baselineTags.current].sort()));
  const preserveDraft=()=>{if(!editing&&!creating)return true;if(editingScope.current!==book.id)return false;const cardId=editing?.id??selectedType?.id,cardTypeId=editing?.cardTypeId??selectedType?.id;if(!cardId||!cardTypeId)return false;return retainBusinessDraft({version:1,bookId:book.id,cardId,cardTypeId,revision:editing?.revision??1,title,values,localValues,tagIds:draftTagIds??null,aiDecisionIds:aiDraftDecisionIds,unknownWrite,requestKey,notWritten,creating});};
  const canLeave=()=>{if(associationEditor.current?.locked||busy||aiLocked||unknownWrite||requestKey||formCommandLocked||saveInFlight.current){setError("原保存结果待核对；填写和请求记录保留，仅允许只读核对。");return false;}if(associationEditor.current&&!associationEditor.current.preserveDraft())return false;if((dirty||creating)&&!preserveDraft()){setError("未能保留编辑草稿，请先保存填写或检查网站存储权限，再切换资料。");return false;}return true;};
  const focusIssue=(path:string)=>{const key=path.split(".").filter(part=>!/^\d+$/.test(part)).at(-1)??"",label=key==="title"?editorRef.current?.querySelector('[data-business-title]'):editorRef.current?.querySelector(`[id$="-${CSS.escape(key)}-label"]`)?.closest(".nd-control");label?.querySelector<HTMLElement>("input,select,textarea,button")?.focus();label?.scrollIntoView({block:"nearest"});};
  const acceptWriteReceipt=(receipt:AuthorMaterialWriteReceipt)=>{if(receipt.bookId!==book.id||receipt.card.cardTypeId!==selectedType?.id||editing&&receipt.card.id!==editing.id)throw new Error("原资料保存回执范围不匹配，填写与凭证保留。");clearBusinessDraft(book.id,editing?.id??selectedType!.id);setEditing(receipt.card);setCreating(false);setTitle(receipt.card.title);setValues(receipt.card.values);setLocalValues(receipt.localValues);setScopedFields(bundle=>({...bundle,values:receipt.localValues}));if(receipt.tagIds){setDraftTagIds(receipt.tagIds);baselineTags.current=receipt.tagIds;}setAiDraftDecisionIds([]);setUnknownWrite(false);setRequestKey(null);setNotWritten(false);setConflict(null);setSavedProof(`原请求保存成功，资料修订 ${receipt.card.revision}；保存凭证和正式版本保留。`);onSavedReceipt?.(receipt);};
  const readSavedState=async()=>{if(busy)return;setBusy(true);let confirmed=false;try{if(requestKey){const receipt=await newDesignApi.getAuthorMaterialWriteReceipt(book.id,requestKey);if(receipt){if(receipt.requestKey!==requestKey)throw new Error("原请求凭证不匹配，当前填写保留。");acceptWriteReceipt(receipt);confirmed=true;}else setNotice("原请求回执未找到，不能断言未执行；保留原填写和请求凭证，不重复提交。");setReceiptChecked(true);}if(!confirmed&&editing){const latest=await newDesignApi.getCard(editing.id);if(latest.id!==editing.id||latest.cardTypeId!==editing.cardTypeId)throw new Error("资料来源范围不匹配，当前填写保留。");setConflict({localTitle:title,localValues:values,latest});}if(confirmed){await loadWorkspace();await onSaved?.();}}catch(caught){setFailureStep(confirmed?"读取已成功保存的资料来源":"只读核对资料保存结果");setError(caught instanceof Error?caught.message:"服务器内容未读取，已保存证据和填写保留。");}finally{setBusy(false);}};

  const selectedType = availableTypes.find((type) => type.id === selectedTypeId) ?? availableTypes[0] ?? null;
  const currentTypeVersion = typeVersions.find((version) => version.id === selectedType?.currentVersionId) ?? typeVersions[0] ?? null;
  const resolution = selectedType && currentTypeVersion
    ? resolveBusinessForm(selectedType, currentTypeVersion.fields, forms, formVersions,activeForms[selectedType.key])
    : null;
  const localFieldKeys=new Set(scopedFields.definitions.filter((item)=>item.scope==="card"&&item.status==="active").map((item)=>item.fieldKey));
  const combinedFields=resolution?[...resolution.fields,...scopedFields.definitions.filter((item)=>item.scope==="card"&&item.status==="active"&&!resolution.fields.some((field)=>field.key===item.fieldKey)).map((item)=>item.currentVersion.field)]:[];
  const repairInFlight=useRef(false),repairScope=useRef("");repairScope.current=stableWorldConsistencyValue({bookId:book.id,cardId:editing?.id,revision:editing?.revision,title,values,localValues,fields:combinedFields,tagIds:draftTagIds,aiDraftDecisionIds,repairDraft});
  const scopeLabelByKey=Object.fromEntries(scopedFields.definitions.map((item)=>[item.fieldKey,item.origin==="core"?"核心信息":item.origin==="template"?"模板信息":item.origin==="book_extension"?"本书新增":"仅此处补充"]));
  const cards = selectedType && workspace ? cardsForType(workspace.cards, selectedType) : [];
  const copy = SCOPE_COPY[scope];

  useEffect(()=>setLiveCardTypes(cardTypes),[cardTypes]);
  useEffect(()=>{setAiDraftDecisionIds([]);setDraftTagIds(creating?[]:undefined);},[book.id,selectedType?.id,editing?.id]);

  const loadWorkspace = async () => {
    const [nextWorkspace, nextForms,selection] = await Promise.all([
      newDesignApi.getBookViewWorkspace(book.id),
      newDesignApi.listCardGroupForms(book.spaceId),
      newDesignApi.getBookFormSelection(book.id),
    ]);
    if(liveBook.current!==book.id)return;
    if(nextWorkspace.bookId!==book.id||nextWorkspace.spaceId!==book.spaceId)throw new Error("资料来源不属于本书，原填写保留。");
    const versionPairs = await Promise.all(nextForms.filter((form) => form.status === "published" && form.currentVersionId).map(async (form) => [form.id, await newDesignApi.listCardGroupFormVersions(form.id)] as const));
    if(liveBook.current!==book.id)return;
    if(selection.bookId!==book.id)throw new Error("表单选择来源不属于本书。");
    setActiveForms(selection.activeForms);
    setWorkspace(nextWorkspace);
    setForms(nextForms);
    setFormVersions(new Map(versionPairs));
  };

  useEffect(() => {
    setWorkspace(null);
    setError("");
    setNotice("");
    void loadWorkspace().catch((loadError) => setError(loadError instanceof Error ? loadError.message : "本书资料暂时无法读取。"));
  }, [book.id, book.spaceId]);
  useEffect(()=>{requestedRef.current="";setEditing(null);setUnknownWrite(false);restoringDraft.current=null;},[book.id]);

  useEffect(() => {
    const nextTypeId = availableTypes.some((type) => type.id === selectedTypeId) ? selectedTypeId : availableTypes[0]?.id ?? "";
    if (nextTypeId !== selectedTypeId) setSelectedTypeId(nextTypeId);
  }, [availableTypes, selectedTypeId]);

  useEffect(() => {
    let active=true;
    setTypeVersions([]);
    setEditing(null);
    setCreating(false);
    setConflict(null);
    setIssues({});
    setError("");
    setNotice("");
    if (!selectedType) return;
    void newDesignApi.listCardTypeVersions(selectedType.id)
      .then(versions=>{if(active&&liveBook.current===book.id)setTypeVersions(versions);})
      .catch((loadError) => {if(active)setError(loadError instanceof Error ? loadError.message : "内容规格暂时无法读取。");});
    return()=>{active=false;};
  }, [selectedType?.id]);

  useEffect(()=>{
    let active=true;setSourcesReady(false);setScopedFields({definitions:[],values:{}});if(!restoringDraft.current)setLocalValues({});
    if(!selectedType)return;
    void newDesignApi.listScopedFields(book.id,selectedType.id,editing?.id).then((bundle)=>{if(!active||liveBook.current!==book.id)return;setScopedFields(bundle);const retained=restoringDraft.current;if(retained&&retained.cardId===editing?.id){setLocalValues(retained.localValues);setDraftTagIds(retained.tagIds??undefined);setAiDraftDecisionIds(retained.aiDecisionIds);restoringDraft.current=null;}else setLocalValues(bundle.values);setSourcesReady(true);}).catch((loadError)=>{if(active)setError(loadError instanceof Error?loadError.message:"信息来源暂时无法读取。");});
    return()=>{active=false;};
  },[book.id,selectedType?.id,editing?.id]);

  useEffect(() => {
    if(requestedCardId)return;
    if (creating || editing || !resolution) return;
    const retained=selectedType?readBusinessDraft(book.id,selectedType.id):null;
    if(retained?.creating){editingScope.current=book.id;setCreating(true);setTitle(retained.title);setValues(retained.values);setLocalValues(retained.localValues);setDraftTagIds(retained.tagIds??[]);setAiDraftDecisionIds(retained.aiDecisionIds);setUnknownWrite(retained.unknownWrite);setRequestKey(retained.requestKey??null);setNotWritten(retained.notWritten??false);setReceiptChecked(false);return;}
    const first = cards[0];
    if (first) {
      selectCard(first);
    }
  }, [cards, creating, editing, resolution]);

  useEffect(()=>{if(!workspace||!requestedCardId||requestedRef.current===requestedCardId||busy||unknownWrite)return;if(!businessUuid.test(requestedCardId)){setFailureStep("核对选中资料来源");setError("选中资料链接无效，请从本书资料列表重新选择。");return;}if(workspace.bookId!==book.id||workspace.spaceId!==book.spaceId)return;const card=workspace.cards.find(item=>item.id===requestedCardId&&item.status==="active"),type=availableTypes.find(item=>item.id===card?.cardTypeId);if(!card||!type){setFailureStep("核对选中资料来源");setError("这项资料不属于本书可编辑范围，保留原选中位置，不自动改选其他资料。");return;}if(editing&&editing.id!==card.id&&!canLeave())return;if(selectedType?.id!==type.id){setSelectedTypeId(type.id);return;}if(!resolution)return;requestedRef.current=requestedCardId;selectCard(card);},[workspace,requestedCardId,selectedType?.id,resolution,busy,unknownWrite]);
  useEffect(()=>{onEditorStateChange?.({dirty:associationFlags.dirty||dirty||creating,locked:associationFlags.locked||formCommandLocked||busy||aiLocked||unknownWrite||requestKey!==null||!sourcesReady,preserveDraft:()=>preserveDraft()&&(associationEditor.current?.preserveDraft()??true),save:async()=>{if((dirty||creating)&&!await save())return false;return await associationEditor.current?.save?.()??true;},discard:()=>{if(associationEditor.current?.locked||formCommandLocked||busy||aiLocked||unknownWrite||requestKey||saveInFlight.current)return false;if(associationEditor.current?.dirty&&!associationEditor.current.discard?.())return false;clearBusinessDraft(book.id,editing?.id??selectedType?.id??'');setCreating(false);setTitle(editing?.title??'');setValues(editing?.values??{});setLocalValues(scopedFields.values);setAiDraftDecisionIds([]);setDraftTagIds([...baselineTags.current]);return true;}});},[associationFlags,formCommandLocked,dirty,creating,busy,aiLocked,unknownWrite,requestKey,sourcesReady,title,values,localValues,draftTagIds,aiDraftDecisionIds,editing?.id,onEditorStateChange]);
  const createdFromEntry=useRef(false);
  useEffect(()=>{if(startCreating&&!createdFromEntry.current&&resolution&&sourcesReady&&!busy&&!unknownWrite){createdFromEntry.current=true;beginCreate();}},[startCreating,resolution,sourcesReady,busy,unknownWrite]);
  useEffect(()=>{if(!restoringDraft.current&&(dirty||unknownWrite||creating))preserveDraft();},[title,values,localValues,draftTagIds,aiDraftDecisionIds,editing?.id,unknownWrite,requestKey,notWritten,creating]);
  useEffect(()=>{const leave=(event:BeforeUnloadEvent)=>{if(dirty||busy||unknownWrite||creating){preserveDraft();event.preventDefault();event.returnValue="";}};addEventListener("beforeunload",leave);return()=>removeEventListener("beforeunload",leave);},[dirty,busy,unknownWrite,creating,title,values,localValues,draftTagIds]);

  const selectType = (typeId: string) => {
    if(!canLeave())return;
    setAiDraftDecisionIds([]);setDraftTagIds(undefined);
    setSelectedTypeId(typeId);
    setEditing(null);
    setCreating(false);
  };

  const selectCard = (card: CardSummary) => {
    if(!canLeave())return;
    const retained=readBusinessDraft(book.id,card.id);restoringDraft.current=retained;
    editingScope.current=book.id;
    setAiDraftDecisionIds([]);setDraftTagIds(undefined);
    setEditing(retained?{...card,revision:retained.revision}:card);
    setCreating(false);
    setTitle(retained?.title??card.title);
    setValues(retained?.values??card.values);
    setLocalValues(retained?.localValues??{});
    setUnknownWrite(retained?.unknownWrite??false);
    setRequestKey(retained?.requestKey??null);setNotWritten(retained?.notWritten??false);setReceiptChecked(false);
    setIssues({});
    setError("");
    setNotice("");
    setConflict(retained&&retained.revision!==card.revision?{localTitle:retained.title,localValues:retained.values,latest:null}:null);
  };

  const beginCreate = () => {
    if(!canLeave())return;
    if (!resolution) return;
    editingScope.current=book.id;setRequestKey(null);setUnknownWrite(false);setNotWritten(false);
    setAiDraftDecisionIds([]);setDraftTagIds([]);
    setEditing(null);
    setCreating(true);
    setTitle("");
    setValues(defaultValues(resolution.fields));
    setLocalValues({});
    setIssues({});
    setError("");
    setNotice("");
    setConflict(null);
  };

  const adoptBatchDraft=()=>{
    const draft=batchDraft,target=draft?.slot.target;
    if(!draft||!target||draft.bookId!==book.id||busy||aiLocked||unknownWrite||requestKey||!sourcesReady||!resolution){setError("候选来源尚未匹配，填写保留。");return;}
    if(target.cardTypeId!==selectedType?.id||target.typeVersionId!==currentTypeVersion?.id||target.cardId!==(editing?.id??null)||target.cardRevision!==(editing?.revision??null) ){setError("此候选的资料或内容规格已更新，请另行准备。");return;}
    const nextValues={...values},nextLocal={...localValues};
    let nextTitle=title;
    for(const [key,value] of Object.entries(draft.values)){
      if(key==="__title"){if(title.trim()){setError("名称已有填写，候选未覆盖人工名称。");return;}nextTitle=String(value);continue;}
      const field=combinedFields.find(item=>item.key===key);
      if(!field||field.hidden||field.aiSuggestible===false){setError("候选字段不属于此表单，填写保留。");return;}
      const actual=localFieldKeys.has(key)?localValues[key]:values[key],original=draft.slot.values[key];
      const blank=(item:unknown)=>item==null||item===""||Array.isArray(item)&&item.length===0;
      if(!(blank(actual)&&blank(original))&&JSON.stringify(actual)!==JSON.stringify(original)&&!(creating&&JSON.stringify(actual)===JSON.stringify(field.defaultValue))){setError("此字段已有新的填写，候选未覆盖。请回候选列表取消勾选此字段。");return;}
      if(localFieldKeys.has(key))nextLocal[key]=value;else nextValues[key]=value;
    }
    if(!target.cardId)setCreating(true);setTitle(nextTitle);setValues(nextValues);setLocalValues(nextLocal);setBatchApplied(draft.key);setError("");setNotice("已选候选载入填写。请检查后保存，其他字段保留。");
  };

  const adoptRepairDraft=async()=>{
    const draft=repairDraft,card=editing,field=combinedFields.find(item=>item.key===draft?.fieldKey);if(!draft||!card||!field||busy||unknownWrite||requestKey||!sourcesReady||repairInFlight.current)return;
    const capturedScope=repairScope.current;repairInFlight.current=true;setBusy(true);try{
    const hash=async(value:unknown)=>Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(stableWorldConsistencyValue(value)))),byte=>byte.toString(16).padStart(2,"0")).join("");
    const scopedSource=scopedFields.definitions.find(item=>item.fieldKey===draft.fieldKey&&item.status==="active"&&item.scope==='card')??scopedFields.definitions.find(item=>item.fieldKey===draft.fieldKey&&item.status==='active'&&item.scope==='book_type'),sourceVersion=scopedSource?.currentVersion.id??card.typeVersionId;
    // Display grouping/order are not a new formal specification.
    const formalField=scopedSource?.currentVersion.field??typeVersions.find(version=>version.id===card.typeVersionId)?.fields.find(item=>item.key===draft.fieldKey);
    if(!formalField||draft.bookId!==book.id||draft.cardId!==card.id||draft.revision!==card.revision||sourceVersion!==draft.specVersionId||await hash({...values,...localValues}[draft.fieldKey]??null)!==draft.beforeHash||await hash({...formalField,defaultValue:formalField.defaultValue??null})!==draft.specHash){setError("修复候选与同一资料的正式规格或当前填写前值不一致；人工草稿保留，不覆盖。请重新核对来源。");return;}
    if(liveBook.current!==book.id||editingScope.current!==book.id||saveInFlight.current||repairScope.current!==capturedScope)return;
    if(!window.confirm(`将“${draft.fieldLabel}”修复建议采用到当前草稿？尚未保存正式档案；其他填写保留。`))return;
    const nextValues=localFieldKeys.has(draft.fieldKey)?values:{...values,[draft.fieldKey]:draft.after},nextLocal=localFieldKeys.has(draft.fieldKey)?{...localValues,[draft.fieldKey]:draft.after}:localValues;
    if(!retainBusinessDraft({version:1,bookId:book.id,cardId:card.id,cardTypeId:card.cardTypeId,revision:card.revision,title,values:nextValues,localValues:nextLocal,tagIds:draftTagIds??null,aiDecisionIds:aiDraftDecisionIds,unknownWrite:false,requestKey:null,notWritten:false,creating:false})){setError("浏览器无法保留修复草稿；尚未采用、未发送保存，请检查网站存储。");return;}
    setValues(nextValues);setLocalValues(nextLocal);setNotice("修复已进入同一资料草稿，其他人工填写保留；请明确点击“保存资料”，正式版本尚未改变。");
    }catch{if(liveBook.current===book.id)setError("修复草稿前值核对失败；原填写保留，未保存资料，请重新核对正式来源。");}finally{repairInFlight.current=false;if(liveBook.current===book.id)setBusy(false);}
  };
  const save = async () => {
    if(resolution?.needsSelection){setError("请先明确选择本书创作表单版本，填写保留。");return false;}
    if(!selectedType||!resolution||formCommandLocked||busy||aiLocked||unknownWrite||requestKey||!sourcesReady||saveInFlight.current)return false;
    const key=crypto.randomUUID(),scopeCardId=editing?.id??selectedType.id;
    const original:BusinessDraftRecovery={version:1,bookId:book.id,cardId:scopeCardId,cardTypeId:selectedType.id,revision:editing?.revision??1,title,values,localValues,tagIds:draftTagIds??null,aiDecisionIds:aiDraftDecisionIds,unknownWrite:true,requestKey:key,notWritten:false,creating};
    if(!retainBusinessDraft(original)){setFailureStep("保留保存恢复凭证");setError("浏览器无法保留原填写，请检查网站存储权限；尚未提交保存。");return false;}
    saveInFlight.current=true;setRequestKey(key);setUnknownWrite(true);setNotWritten(false);setReceiptChecked(false);setBusy(true);setIssues({});setError("");setNotice("");let committed=false;
    try{
      const formVersionId=resolution.formVersionId;
      const input={requestKey:key,cardTypeId:selectedType.id,title,values,aiDraftDecisionIds,tagIds:draftTagIds,formVersionId,formResolutionKind:resolution.source,...(editing?{revision:editing.revision,localValues}:{})};
      const receipt=editing?await newDesignApi.updateAuthorMaterial(book.id,editing.id,input):await newDesignApi.createAuthorMaterial(book.id,input);
      if(receipt.requestKey!==key)throw new Error("保存回执未对应原请求，人工填写与凭证保留。");acceptWriteReceipt(receipt);committed=true;
      await loadWorkspace();await onSaved?.();
    }catch(caught){
      if(committed){setFailureStep("读取已成功保存的资料来源");setError(caught instanceof Error?caught.message:"保存已成功；来源读取暂未确认，请只读刷新，不重新保存。");return false;}
      const confirmedNotWritten=caught instanceof ApiError&&caught.recovery?.mutationOutcome==="not_written";setUnknownWrite(!confirmedNotWritten);setNotWritten(confirmedNotWritten);retainBusinessDraft({...original,unknownWrite:!confirmedNotWritten,notWritten:confirmedNotWritten});
      setFailureStep(caught instanceof ApiError?caught.recovery?.failedStep??"保存本书资料":"核对资料保存回执");setError(caught instanceof Error?caught.message:"保存回执未知；请保留原请求，只读核对，不重复提交。");
      if(caught instanceof ApiError){setIssues(caught.issues);if(caught.status===409&&editing)setConflict({localTitle:title,localValues:values,latest:null});}
    }finally{saveInFlight.current=false;setBusy(false);}
    return committed;
  };

  const compareLatest = async () => {
    if (!editing || !conflict) return;
    setBusy(true);
    try {
      const latest = await newDesignApi.getCard(editing.id);
      setConflict({ ...conflict, latest });
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "最新修订暂时无法读取。");
    } finally {
      setBusy(false);
    }
  };

  const useLatest = () => {
    if(unknownWrite||requestKey)return;
    if (!conflict?.latest) return;
    setEditing(conflict.latest);
    setTitle(conflict.latest.title);
    setValues(conflict.latest.values);
    setConflict(null);
    setError("");
    setNotice(`已载入服务器上的修订 ${conflict.latest.revision}，请确认后再保存。`);
  };

  const keepLocalOnLatestRevision = () => {
    if(unknownWrite||requestKey)return;
    if (!conflict?.latest) return;
    setEditing(conflict.latest);
    setTitle(conflict.localTitle);
    setValues(conflict.localValues);
    setConflict(null);
    setError("");
    setNotice(`已保留你的填写，并以服务器修订 ${conflict.latest.revision} 作为新基线。再次保存前请确认差异。`);
  };
  const reprepareNotWritten=()=>{if(busy||!requestKey||!notWritten||!receiptChecked)return;if(editing&&!conflict?.latest){setError("请先只读核对服务器最新修订，再明确重新准备；人工填写保留。");return;}if(conflict?.latest){setEditing(conflict.latest);setConflict(null);}setRequestKey(null);setUnknownWrite(false);setNotWritten(false);setReceiptChecked(false);setError("");setNotice("原请求确认未写入，填写保留；按你确认的最新资料修订重新准备，再明确保存。");};

  const openHistory = async (card: CardSummary) => {
    setBusy(true);
    setError("");
    try {
      setHistory(await newDesignApi.listCardVersions(card.id));
      setHistoryTitle(card.title);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "修改记录暂时无法读取。");
    } finally {
      setBusy(false);
    }
  };

  const refreshAfterFieldCreate=async()=>{
    if(!selectedType)return;
    const [nextTypes,nextWorkspace,nextVersions]=await Promise.all([newDesignApi.listCardTypes(book.spaceId),newDesignApi.getBookViewWorkspace(book.id),newDesignApi.listCardTypeVersions(selectedType.id)]);
    setLiveCardTypes(nextTypes);setWorkspace(nextWorkspace);setTypeVersions(nextVersions);
    if(editing){const latest=nextWorkspace.cards.find((card)=>card.id===editing.id)??editing;setEditing(latest);setTitle(latest.title);setValues(latest.values);const bundle=await newDesignApi.listScopedFields(book.id,selectedType.id,latest.id);setScopedFields(bundle);setLocalValues(bundle.values);}else{setScopedFields(await newDesignApi.listScopedFields(book.id,selectedType.id));}
    setNotice("信息已加入当前填写表单。");
  };

  const openFieldHistory=async(definition:ScopedFieldDefinition)=>{setBusy(true);try{setFieldHistory({definition,versions:await newDesignApi.listScopedFieldHistory(book.id,definition.id)});}catch(loadError){setError(loadError instanceof Error?loadError.message:"信息版本暂时无法读取。");}finally{setBusy(false);}};
  const archiveField=async(definition:ScopedFieldDefinition)=>{if(!selectedType)return;setBusy(true);setError("");try{await newDesignApi.archiveScopedField(book.id,definition.id,{expectedRevision:definition.revision,expectedTypeRevision:definition.scope==="book_type"?selectedType.revision:undefined,idempotencyKey:crypto.randomUUID()});await refreshAfterFieldCreate();setNotice(`“${definition.currentVersion.field.name}”已从填写表单隐藏，历史资料仍保留。`);}catch(archiveError){setError(archiveError instanceof Error?archiveError.message:"暂时无法隐藏这项信息。");}finally{setBusy(false);}};

  if (!workspace && !error) return <div className="nd-loading-screen" aria-live="polite"><div className="nd-loader"/><strong>正在整理{copy.title}</strong><span>正在读取本书资料和已发布的填写规格。</span></div>;
  if (!workspace) return <div className="nd-fatal"><h2>暂时无法打开填写页面</h2><p>{error}</p><button className="nd-button nd-button-primary" type="button" onClick={() => { setError(""); void loadWorkspace().catch((loadError) => setError(loadError instanceof Error ? loadError.message : "本书资料暂时无法读取。")); }}>重新读取</button></div>;
  if (availableTypes.length === 0) return <div className="nd-empty nd-empty-page"><strong>这个栏目还没有可填写的内容</strong><span>本书需要先安装并发布对应的内容规格。</span></div>;

  return <div className={`nd-business-form-workspace${embedded?" nd-business-form-embedded":""}${compact?" nd-story-form":""}`} ref={editorRef}>
    <header className="nd-business-form-header">
      <div><p className="nd-kicker">{copy.eyebrow}</p><h2>{copy.title}</h2><p>{copy.description}</p></div>
      <button className="nd-button nd-button-primary" type="button" disabled={!resolution} onClick={beginCreate}>＋ 新建{selectedType?.name ?? "资料"}</button>
    </header>

    {scope==="all"&&<nav className="nd-material-mode-tabs" aria-label="本书资料查看方式">{([['types','内容类型'],['tags','标签'],['groups','分组目录'],['views','智能视图']] as const).map(([key,label])=><button className={browserMode===key?"is-selected":""} type="button" key={key} aria-pressed={browserMode===key} onClick={()=>setBrowserMode(key)}>{label}</button>)}</nav>}

    {scope==="all"&&browserMode!=="types"?<MaterialManagementPanel scope={{bookId:book.id}} mode={browserMode} cards={workspace.cards} onOpenCard={(card)=>{selectType(card.cardTypeId);selectCard(card);setBrowserMode("types");}}/>:<div className="nd-business-form-layout">
      <aside className="nd-business-form-browser" aria-label={`${copy.title}内容类型与资料`}>
        <div className="nd-business-type-list">
          {availableTypes.map((type) => <button className={type.id === selectedType?.id ? "is-selected" : ""} type="button" key={type.id} onClick={() => selectType(type.id)}><strong>{type.name}</strong><small>{workspace.cards.filter((card) => card.cardTypeId === type.id && card.status === "active").length} 条资料</small></button>)}
        </div>
        <div className="nd-business-card-list">
          <div><strong>{selectedType?.name}</strong><span>{cards.length} 条</span></div>
          {cards.length === 0 ? <p>还没有内容，可以从空白表单开始填写。</p> : cards.map((card) => <button className={editing?.id === card.id ? "is-selected" : ""} type="button" key={card.id} onClick={() => selectCard(card)}><strong>{card.title}</strong><small>修订 {card.revision} · 内容规格 v{card.typeVersion}</small></button>)}
        </div>
      </aside>

      <section className="nd-business-form-editor" aria-label={`${selectedType?.name ?? "资料"}填写表单`}>
        {resolution?.needsSelection&&<p role="alert">本书有多份同类表单，请在关联资源或世界使用范围中明确选择表单版本。当前填写保留。</p>}
        {!resolution ? <div className="nd-empty nd-empty-page"><strong>没有可用的已发布填写规格</strong><span>发布内容规格后即可在这里填写，不会生成另一份配置。</span></div> : !creating && !editing ? <div className="nd-empty nd-empty-page"><strong>选择一条资料，或新建内容</strong><span>空白填写、模板生成和 AI 提案进入本书后，都使用同一套编辑页面。</span></div> : <>
          <div className="nd-business-editor-heading">
            <div><p className="nd-kicker">{creating ? "新建内容" : `修订 ${editing?.revision}`}</p><h2>{resolution.title}</h2><p>{selectedType?.description}</p></div>
            <div className="nd-form-provenance" aria-label="当前填写规格"><span>{resolution.sourceLabel}</span><small>内容规格 v{resolution.typeVersion}</small><button className="nd-text-button" type="button" disabled={formCommandLocked||associationFlags.locked||busy||unknownWrite||dirty} onClick={()=>setAddingInformation(true)}>＋ 添加信息</button>{editing && <button className="nd-text-button" type="button" onClick={() => void openHistory(editing)}>查看修改记录</button>}</div>
          </div>
          <label className={`nd-control${issues.title ? " has-error" : ""}`} data-business-title>
            <span>资料标题 <b aria-label="必填">*</b></span>
            <small>用于列表、搜索和关联引用，不会替代正文中的正式名称。</small>
            <input disabled={formCommandLocked||associationFlags.locked||busy||unknownWrite||requestKey!==null||!sourcesReady||resolution.needsSelection} value={title} placeholder={`输入${selectedType?.name ?? "资料"}标题`} aria-invalid={Boolean(issues.title)} onChange={(event) => setTitle(event.target.value)} />
            {issues.title && <em>{issues.title}</em>}
          </label>
          {batchDraft&&batchApplied!==batchDraft.key&&<section className="nd-message"><p>已选整组候选：只载入勾选字段，请检查后保存。</p><button className="nd-button" type="button" disabled={busy||aiLocked||unknownWrite||requestKey!==null||!sourcesReady} onClick={adoptBatchDraft}>采用已选字段到填写</button></section>}
          {repairDraft&&<section className="nd-message"><p>世界修复建议：{repairDraft.fieldLabel}。只采用到同一资料草稿，正常保存后才能记录正式修复。</p><button className="nd-button" type="button" disabled={formCommandLocked||associationFlags.locked||busy||unknownWrite||requestKey!==null||!sourcesReady||editing?.id!==repairDraft.cardId} onClick={()=>void adoptRepairDraft()}>明确采用修复到当前草稿</button></section>}
          <DynamicForm fieldSection={fieldSection} compactHelp={compact} fields={combinedFields} values={{...values,...localValues}} disabled={formCommandLocked||associationFlags.locked||busy||unknownWrite||requestKey!==null||!sourcesReady||resolution.needsSelection} issues={issues} scopeLabelByKey={scopeLabelByKey} aiContext={selectedType?.currentVersionId&&draftTagIds!==undefined?{label:compact?'AI 辅助当前项':undefined,onLockChange:setAiLocked,target:{bookId:book.id,cardTypeId:selectedType.id,cardId:editing?.id??null,typeVersionId:selectedType.currentVersionId,cardRevision:editing?.revision??null,formVersionId:resolution.formVersionId,title},tagIds:draftTagIds??[],onAdopt:result=>{if(result.title!==undefined)setTitle(result.title);setValues(Object.fromEntries(Object.entries(result.values).filter(([key])=>!localFieldKeys.has(key))));setLocalValues(Object.fromEntries(Object.entries(result.values).filter(([key])=>localFieldKeys.has(key))));setDraftTagIds(result.tagIds);setAiDraftDecisionIds(ids=>[...ids,result.decisionId]);}}:undefined} onChange={(next)=>{setValues(Object.fromEntries(Object.entries(next).filter(([key])=>!localFieldKeys.has(key))));setLocalValues(Object.fromEntries(Object.entries(next).filter(([key])=>localFieldKeys.has(key))));}}/>
          {selectedType&&<CardTagFields key={editing?.id??"new"} scope={{bookId:book.id}} spaceId={book.spaceId} cardTypeId={selectedType.id} cardId={editing?.id??""} selectedTagIds={draftTagIds} onDraftChange={setDraftTagIds} onInitialTags={ids=>{baselineTags.current=ids;setDraftTagIds(current=>current??ids);}} disabled={formCommandLocked||associationFlags.locked||busy||unknownWrite||requestKey!==null||!sourcesReady||resolution.needsSelection}/>}
          {aiDraftDecisionIds.length>0&&<details><summary>已采用的 AI 草稿来源</summary><p className="nd-help-text">保存会再次检查生成来源。若选项或关联资料变化，可复核当前表单后，以人工确认内容保存；表单不会被清空。</p><button className="nd-button nd-button-secondary" type="button" disabled={formCommandLocked||associationFlags.locked||busy||unknownWrite||requestKey!==null||!sourcesReady||resolution.needsSelection} onClick={()=>{setAiDraftDecisionIds([]);setNotice("当前表单保留，将以人工确认内容保存。AI 采用审计仍保留在历史记录中。");}}>我已复核，按人工内容保存</button></details>}

          <details className="nd-field-source-list"><summary>查看信息来源与适用范围</summary><div>{scopedFields.definitions.filter((item)=>item.status==="active").map((item)=><article key={item.id}><span><strong>{item.currentVersion.field.name}</strong><small>{scopeLabelByKey[item.fieldKey]} · {item.scope==="book_type"?"本书所有同类资料":item.scope==="card"?"当前资料":"当前关联"} · {fieldSourceDetail(item)}</small></span><span className="nd-field-source-actions"><button className="nd-text-button" type="button" onClick={()=>void openFieldHistory(item)}>查看版本</button>{item.origin==="local_supplement"&&<button className="nd-text-button" type="button" disabled={formCommandLocked||associationFlags.locked||busy||unknownWrite||dirty} onClick={()=>setEditingField(item)}>修改</button>}{item.origin!=="core"&&!(item.origin==="template"&&item.currentVersion.field.required)&&<button className="nd-text-button" type="button" disabled={formCommandLocked||associationFlags.locked||busy||unknownWrite||dirty} onClick={()=>void archiveField(item)}>隐藏</button>}</span></article>)}</div></details>

          {selectedType&&<ReferenceForms key={`${book.id}:${selectedType.key}`} bookId={book.id} primaryTypeKey={selectedType.key} primaryCardId={editing?.id} disabled={associationFlags.dirty||associationFlags.locked||dirty||creating||unknownWrite||busy||requestKey!==null} onLock={setFormCommandLocked} onChanged={loadWorkspace}/>}
          {editing&&resolution.source==="installed_form"&&<AssociationPanel
            book={book}
            onState={receiveAssociations}
            primary={editing}
            cardTypes={liveCardTypes}
            forms={forms}
            formVersions={formVersions}
            activeForms={activeForms}
            hasUnsavedChanges={dirty||unknownWrite||requestKey!==null||busy}
            onSourcesChanged={loadWorkspace}
          />}

          {conflict && <section className="nd-revision-conflict" role="alert"><strong>检测到新的服务器修订</strong><p>你的未保存内容仍保留。先读取并比较最新修订，再决定采用哪一份。</p><button className="nd-button nd-button-secondary" type="button" disabled={busy} onClick={() => void compareLatest()}>{conflict.latest ? "重新比较" : "读取最新修订并比较"}</button>{conflict.latest && <div className="nd-conflict-comparison"><div><strong>你的填写</strong><span>{conflict.localTitle}</span></div><div><strong>服务器修订 {conflict.latest.revision}</strong><span>{conflict.latest.title}</span></div>{changedKeys(conflict.localValues, conflict.latest.values).map((key) => <article key={key}><strong>{resolution.fields.find((field) => field.key === key)?.name ?? key}</strong><p>{displayValue(conflict.localValues[key], resolution.fields.find((field) => field.key === key))}</p><p>{displayValue(conflict.latest?.values[key], resolution.fields.find((field) => field.key === key))}</p></article>)}<div className="nd-conflict-actions"><button className="nd-button nd-button-secondary" type="button" disabled={formCommandLocked||associationFlags.locked||busy||unknownWrite||requestKey!==null} onClick={keepLocalOnLatestRevision}>保留我的填写</button><button className="nd-button nd-button-secondary" type="button" disabled={formCommandLocked||associationFlags.locked||busy||unknownWrite||requestKey!==null} onClick={useLatest}>采用服务器最新内容</button></div></div>}</section>}
          <div aria-live="polite">{savedProof&&<p className="nd-message is-success" role="status">{savedProof}</p>}{error&&<section className="nd-message is-error" role="alert"><strong>未完成步骤：{failureStep||"核对资料来源"}</strong><p>{error}</p><p>填写、草稿与已保存结果保留。<a href="/new-design/structure/maintenance">打开运行维护</a>；返回原页只读核对，不重发保存。</p>{Object.entries(issues).map(([key,value])=><p key={key}><button className="nd-text-button" type="button" onClick={()=>focusIssue(key)}>定位{key.endsWith("title")?"资料标题":combinedFields.find(field=>field.key===key.split(".").at(-1))?.name??"填写位置"}</button>：{value}</p>)}{(editing||requestKey)&&<button className="nd-button nd-button-secondary" type="button" disabled={busy} onClick={()=>void readSavedState()}>只读核对服务器内容</button>}</section>}{notice && <p className="nd-message is-success">{notice}</p>}{unknownWrite&&!error&&<section role="alert"><p>原保存结果未知，保留填写；仅允许只读核对，不再次提交。</p><button className="nd-button nd-button-secondary" type="button" disabled={busy} onClick={()=>void readSavedState()}>只读核对服务器内容</button></section>}{requestKey&&notWritten&&receiptChecked&&<button className="nd-button nd-button-secondary" type="button" disabled={busy} onClick={reprepareNotWritten}>保留填写，明确按最新修订重新准备</button>}</div>
          <div className="nd-editor-actions"><button className="nd-button nd-button-secondary" type="button" disabled={formCommandLocked||associationFlags.locked||busy||unknownWrite} onClick={() => { if(!canLeave())return;setCreating(false); setEditing(null); setConflict(null); setError(""); setNotice(""); }}>保留草稿并取消</button><button className="nd-button nd-button-primary" type="button" disabled={formCommandLocked||associationFlags.locked||busy || unknownWrite || requestKey!==null || !sourcesReady || !title.trim() || Boolean(conflict)} onClick={() => void save()}>{busy ? "保存中…" : "保存资料"}</button></div>
        </>}
      </section>
    </div>}

    {history && <div className="nd-dialog-backdrop" role="presentation" onMouseDown={() => setHistory(null)}><section className="nd-history-dialog" role="dialog" aria-modal="true" aria-labelledby="nd-business-history-title" onMouseDown={(event) => event.stopPropagation()}><div className="nd-section-heading"><div><p className="nd-kicker">只读修改记录</p><h2 id="nd-business-history-title">{historyTitle}</h2></div><button className="nd-dialog-close" type="button" aria-label="关闭修改记录" onClick={() => setHistory(null)}>×</button></div><div className="nd-history-list">{history.map((version) => <article key={version.id}><div><strong>修订 {version.revision}</strong><span>{historySource(version.source)} · 内容规格 v{version.typeVersion}{version.formVersion ? ` · 创作表单 v${version.formVersion}` : ""}</span></div><time>{new Date(version.createdAt).toLocaleString("zh-CN")}</time><h3>{version.title}</h3><dl>{Object.entries({...version.values,...version.localValues}).map(([key, value]) => <div key={key}><dt>{combinedFields.find((field) => field.key === key)?.name ?? key}</dt><dd>{displayValue(value, combinedFields.find((field) => field.key === key))}</dd></div>)}</dl></article>)}</div></section></div>}
    {addingInformation&&selectedType&&<AddInformationDialog bookId={book.id} cardType={selectedType} card={editing} onClose={()=>setAddingInformation(false)} onCreated={refreshAfterFieldCreate}/>}
    {editingField&&selectedType&&<AddInformationDialog bookId={book.id} cardType={selectedType} card={editing} definition={editingField} initialValue={localValues[editingField.fieldKey]} onClose={()=>setEditingField(null)} onCreated={refreshAfterFieldCreate}/>}
    {fieldHistory&&<div className="nd-dialog-backdrop" role="presentation" onMouseDown={()=>setFieldHistory(null)}><section className="nd-history-dialog nd-field-history-dialog" role="dialog" aria-modal="true" aria-labelledby="nd-field-history-title" onMouseDown={(event)=>event.stopPropagation()}><div className="nd-section-heading"><div><p className="nd-kicker">{scopeLabelByKey[fieldHistory.definition.fieldKey]}</p><h2 id="nd-field-history-title">{fieldHistory.definition.currentVersion.field.name}</h2><p>稳定标识 {fieldHistory.definition.fieldKey} · 改名不会改变资料身份</p></div><button className="nd-dialog-close" type="button" aria-label="关闭信息版本" onClick={()=>setFieldHistory(null)}>×</button></div><div className="nd-history-list">{fieldHistory.versions.map((version)=><article key={version.id}><div><strong>版本 {version.version}</strong><span>{version.field.group} · {TYPE_LABELS[version.field.type]??version.field.type}</span></div><time>{new Date(version.createdAt).toLocaleString("zh-CN")}</time><h3>{version.field.name}</h3><p>{version.field.description||"没有填写说明。"}</p></article>)}</div></section></div>}
  </div>;
}
