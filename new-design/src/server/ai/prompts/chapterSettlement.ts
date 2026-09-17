import { z } from "zod";
import type { SettlementEditingCatalog, SettlementEditingDraft } from "../../../common/chapterSettlementEditing";
import type { PromptAsset } from "./contracts";
import { fieldInput,fieldOutput } from "./fields";
import { selectableTreeNodeIds,validateTreeSelection } from "../../../common/treePolicy";

export interface ChapterSettlementPromptInput {
  sessionId:string;bodyVersionId:string;bodyContentHash:string;
  catalog:SettlementEditingCatalog;bodyContent:string;expectedChanges:string[];resourceScope?:import("../../../common/characterResources").ResourceBackfillFrozenScope;
  stableSupplement?:{sessionRevision:number;source:import("../../../common/resourceSupplements").ResourceSupplementPreview};
}
export interface ChapterSettlementPromptOutput {items:SettlementEditingDraft[];notes:string[]}
const scalar=z.union([z.string().max(30000),z.number().finite(),z.boolean(),z.array(z.string()).max(300),z.null()]);
export const chapterSettlementAsset:PromptAsset={
  assetId:"new_design.chapter.settlement_candidates",version:"v1",taskType:"chapter_settlement",label:"整理章节变化",
  contextPolicy:"explicit_task_snapshot_only",temperature:0.2,maxTokens:8000,
  instruction:"只从给定正文提取有原文证据的对象字段状态变化、确定事实或角色所知候选。不得创作正文未发生的变化，不得直接确认或结算。只能使用catalog提供的对象、允许类别、正式字段与精确规格哈希；beforeValue必须等于已知baseline.value，未知或stale基线不能生成候选。stateKey保持原值，dictionary选项只能用提供节点id；不得把故事时间、事件因果或并发关系塞进状态值。event仅表示对象字段的事件结果，relationship仅表示已有资料关系的状态变化。随情节变化的体力、持有、境界或关系维度应使用允许的状态类别；fact用于正文证实的事实，不能以fact绕过状态变化账本。每个对象字段最多一条，以该章前后净变化为准；delta字段给出数值changeValue且afterValue=beforeValue+changeValue。证据偏移按JavaScript UTF-16位置，evidenceLabel为不超过240字的原文摘录且严格匹配[start,end)。knowledge仅使用catalog.holderChoices里的角色或reader，并说明获知方式和立场；不可把读者确定事实混同角色信念。无充分证据或正式字段时返回空items并在中文notes说明待补条件。所有候选均需作者逐项审阅，无自动确认或写正式事实权。",
  prepare(value){
    const input=z.object({sessionId:z.string().uuid(),bodyVersionId:z.string().uuid(),bodyContentHash:z.string().length(64),catalog:z.custom<SettlementEditingCatalog>(v=>Boolean(v)&&typeof v==="object"&&!Array.isArray(v)),bodyContent:z.string().min(1).max(300000),expectedChanges:z.array(z.string()).max(300)}).strict().parse(value);
    if(input.catalog.sessionId!==input.sessionId||input.catalog.bodyVersionId!==input.bodyVersionId||input.catalog.bodyContentHash!==input.bodyContentHash)throw new Error("正文与可结算规格不是同一次冻结资料。");
    const variants:z.ZodType[]=[];
    for(const subject of input.catalog.subjects){
      if(subject.unavailableReason||!subject.categories.length)continue;
      for(const choice of subject.fields){
        if(!choice.baseline.known||choice.baseline.stale||choice.field.hidden||choice.field.aiSuggestible===false)continue;
        let after:z.ZodType;
        if(choice.field.optionSource?.kind==="dictionary_tree"){
          const permitted=selectableTreeNodeIds(choice.dictionaryNodes,choice.field.optionSource.rule);
          const nodes=choice.dictionaryNodes.filter(node=>permitted.has(node.id)).map(node=>node.id);
          if(!nodes.length)continue;
          const node=z.enum(nodes as [string,...string[]]);
          after=choice.field.type==="multi_select"?z.array(node).min(Math.max(choice.field.required?1:0,choice.field.optionSource.rule.minSelections)).max(Math.min(300,choice.field.optionSource.rule.maxSelections??300)):node;
        }else after=fieldOutput(fieldInput.parse(choice.field));
        variants.push(z.object({
          category:z.enum(subject.categories as [SettlementEditingDraft["category"],...SettlementEditingDraft["category"][]]),
          title:z.string().trim().min(1).max(240),subjectKind:z.literal(subject.subjectKind),subjectId:z.literal(subject.id),stateKey:z.literal(choice.key),
          specificationHash:z.literal(choice.specificationHash),baselineHash:z.literal(choice.baseline.hash),beforeValue:scalar,afterValue:after,
          changeValue:choice.mode==="delta"?z.number().finite():z.never().optional(),riskLevel:z.enum(["low","medium","high","critical"]),
          confidence:z.number().min(0).max(1),confidenceNote:z.string().max(1000),planAlignment:z.enum(["matches","deviates","missing","not_applicable"]),
          planExpectation:z.string().max(2000),evidenceStart:z.number().int().nonnegative(),evidenceEnd:z.number().int().positive(),
          evidenceLabel:z.string().min(1).max(240),reason:z.string().min(1).max(3000),holderKind:z.enum(["character","reader"]).optional(),
          holderCardId:z.string().uuid().optional(),holderKey:z.string().max(160).optional(),stance:z.enum(["knows","believes","suspects","misunderstands","unknown"]).optional(),
          acquisitionMethod:z.enum(["witnessed","told","inferred","read","narration","assumed","forgotten","manual"]).optional(),
        }).strict());
      }
    }
    const candidate=variants.length===0?z.never():variants.length===1?variants[0]!:z.union([variants[0]!,variants[1]!,...variants.slice(2)]);
    const schema=z.object({items:z.array(candidate).max(100),notes:z.array(z.string().max(4000)).max(30)}).strict().superRefine((output,ctx)=>{
      const seen=new Set<string>();
      for(const [index,item] of output.items.entries()){
        const entry=item as SettlementEditingDraft,subject=input.catalog.subjects.find(s=>s.id===entry.subjectId&&s.subjectKind===entry.subjectKind),choice=subject?.fields.find(f=>f.key===entry.stateKey),identity=`${entry.subjectKind}:${entry.subjectId}:${entry.stateKey}`;
        if(!choice||JSON.stringify(entry.beforeValue)!==JSON.stringify(choice.baseline.value)||seen.has(identity))ctx.addIssue({code:"custom",path:["items",index],message:"变化前值必须匹配已知基线，每个对象字段只能提取一次。"});
        seen.add(identity);
        if(entry.evidenceEnd>input.bodyContent.length||input.bodyContent.slice(entry.evidenceStart,entry.evidenceEnd)!==entry.evidenceLabel)ctx.addIssue({code:"custom",path:["items",index,"evidenceLabel"],message:"证据摘录与本章正文位置不匹配。"});
        if(choice?.mode==="delta"&&(typeof entry.beforeValue!=="number"||typeof entry.afterValue!=="number"||typeof entry.changeValue!=="number"||entry.beforeValue+entry.changeValue!==entry.afterValue))ctx.addIssue({code:"custom",path:["items",index,"afterValue"],message:"数值增减与变化前后值不一致。"});
        if(choice?.field.optionSource?.kind==="dictionary_tree"){
          const validation=validateTreeSelection(choice.dictionaryNodes,choice.field.optionSource.rule,Array.isArray(entry.afterValue)?entry.afterValue as string[]:[entry.afterValue as string]);
          if(!validation.valid)ctx.addIssue({code:"custom",path:["items",index,"afterValue"],message:validation.message??"树选项不符合正式字段规则。"});
        }
        if(entry.category==="knowledge"&&(entry.holderKind!=="reader"&&(entry.holderKind!=="character"||!input.catalog.holderChoices.some(h=>h.id===entry.holderCardId))))ctx.addIssue({code:"custom",path:["items",index,"holderCardId"],message:"角色所知必须引用本次提供的角色。"});
      }
    });
    return {input,schema,describeOutputError(error:unknown,output:unknown){
      const first=error instanceof z.ZodError?error.issues[0]:null,index=first?.path.find(part=>typeof part==="number");
      const rows=output&&typeof output==="object"&&!Array.isArray(output)?(output as Record<string,unknown>).items:null;
      const raw=typeof index==="number"&&Array.isArray(rows)&&rows[index]&&typeof rows[index]==="object"?rows[index] as Record<string,unknown>:{};
      const subject=input.catalog.subjects.find(item=>item.id===raw.subjectId&&item.subjectKind===raw.subjectKind),choice=subject?.fields.find(item=>item.key===raw.stateKey);
      const labels:Record<string,string>={category:"变化类别",title:"变化说明",subjectId:"变化对象",subjectKind:"对象类别",stateKey:"正式字段",specificationHash:"正式字段规格",baselineHash:"状态前值",beforeValue:"变化前值",afterValue:"变化后值",changeValue:"数值变化量",evidenceStart:"正文证据位置",evidenceEnd:"正文证据位置",evidenceLabel:"正文证据摘录",holderCardId:"知识持有人物",holderKind:"知识持有者",stance:"所知立场",acquisitionMethod:"获知方式",reason:"变化依据",confidenceNote:"把握说明",planExpectation:"规划预期"};
      const field=[...(first?.path??[])].reverse().find(part=>typeof part==="string"&&Object.hasOwn(labels,part)),key=typeof field==="string"?field:"afterValue",position=typeof index==="number"?`第 ${index+1} 项变化`:"本章变化候选";
      const summary=`${position}${subject?` · ${subject.label}`:""}${choice?` · ${choice.label}`:""}：${typeof field==="string"?labels[field]:"所选对象、正式字段或填写值"}不符合本次规格。请核对正文证据与正式字段，调整后明确重新提取；没有候选入库。`;
      return{summary,issues:{[typeof index==="number"?`items.${index}.${key}`:"items"]:summary}};
    }};
  },
};
