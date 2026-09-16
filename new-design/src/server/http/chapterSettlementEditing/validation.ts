import {z} from "zod";

const revision=z.number().int().positive();
export const settlementSessionId=z.string().uuid("请选择有效的章节确认会话。");
export const settlementRequestKey=z.string().trim().min(8,"缺少原请求凭证，请保留输入并重新准备。").max(160);
const value=z.json();
const draft=z.object({
  category:z.enum(["fact","knowledge","character_state","relationship","prop","event","foreshadow"]),
  majorCategory:z.string().trim().max(120).nullable().optional(),
  title:z.string().trim().min(1,"请填写变化标题。").max(240),
  subjectKind:z.enum(["card","relation"]),subjectId:z.string().uuid(),subjectCardId:z.string().uuid().optional(),
  stateKey:z.string().trim().min(1,"请选择正式可结算字段。").max(160),
  beforeValue:value,changeValue:value.optional(),afterValue:value,
  valueKind:z.enum(["text","number","boolean","json","card_reference"]).optional(),
  objectCardId:z.string().uuid().nullable().optional(),
  holderKind:z.enum(["character","reader"]).optional(),holderKey:z.string().trim().max(160).optional(),holderCardId:z.string().uuid().nullable().optional(),
  stance:z.enum(["knows","believes","suspects","misunderstands","unknown"]).optional(),
  acquisitionMethod:z.enum(["witnessed","told","inferred","read","narration","assumed","forgotten","manual"]).optional(),
  riskLevel:z.enum(["low","medium","high","critical"]),confidence:z.number().min(0).max(1).nullable().optional(),
  confidenceNote:z.string().trim().max(1000).optional(),planAlignment:z.enum(["matches","deviates","missing","not_applicable"]).optional(),
  planExpectation:z.string().trim().max(2000).optional(),
  evidenceStart:z.number().int().min(0),evidenceEnd:z.number().int().positive(),
  evidenceLabel:z.string().trim().min(1,"请填写证据说明。").max(240),reason:z.string().trim().min(1,"请说明变化原因。").max(3000),
  specificationHash:z.string().trim().min(1,"请读取正式字段规格后再保存。").max(160),
  baselineHash:z.string().trim().min(1,"请读取变化前的状态后再保存。").max(160),
}).strict().superRefine((input,context)=>{
  if(input.evidenceEnd<=input.evidenceStart)context.addIssue({code:"custom",path:["evidenceEnd"],message:"正文证据范围无效，请重新选择原文。"});
  if((input.category==="relationship")!==(input.subjectKind==="relation"))context.addIssue({code:"custom",path:["subjectId"],message:"关系变化请选择正式关系；其他变化请选择本书资料。"});
  if(input.subjectCardId&&input.subjectCardId!==input.subjectId)context.addIssue({code:"custom",path:["subjectId"],message:"变化对象与资料引用不一致。"});
  if(input.category==="knowledge"&&input.holderKind==="character"&&!input.holderCardId)context.addIssue({code:"custom",path:["holderCardId"],message:"请选择获知内容的人物。"});
});
const mutation=z.object({expectedSessionRevision:revision,requestKey:settlementRequestKey,actor:z.string().trim().max(160).default("user")});
export const settlementEditingCreateSchema=mutation.extend({draft}).strict();
export const settlementEditingUpdateSchema=mutation.extend({draft,expectedRevision:revision,note:z.string().trim().max(2000).default("")}).strict();
export const settlementEditingDecisionsSchema=mutation.extend({decisions:z.array(z.object({itemId:z.string().uuid(),expectedRevision:revision,decision:z.enum(["confirm","reject","defer"]),note:z.string().trim().max(2000).default("")}).strict()).min(1,"请选择要核对的变化。").max(500)}).strict();
export const settlementEditingCommitSchema=mutation.extend({note:z.string().trim().max(2000).default("")}).strict();
export const settlementEditingInitialSchema=mutation.extend({
  subjectId:z.string().uuid(),subjectKind:z.enum(["card","relation"]),stateKey:z.string().trim().min(1).max(160),
  specificationHash:z.string().trim().min(1).max(160),value,note:z.string().trim().min(1,"请说明建立初始状态的依据。").max(2000),
}).strict();

export const settlementFieldLabels:Record<string,string>={
  form:"本次输入",id:"章节确认会话",requestKey:"原请求凭证",expectedSessionRevision:"确认清单版本",expectedRevision:"变化提案版本",
  draft:"变化内容",category:"变化类型",title:"变化标题",subjectKind:"对象类型",subjectId:"变化对象",subjectCardId:"变化资料",
  stateKey:"可结算字段",beforeValue:"变化前",changeValue:"变化量",afterValue:"变化后",valueKind:"字段类型",objectCardId:"关联资料",
  holderKind:"知情对象",holderKey:"知情对象",holderCardId:"知情人物",stance:"认知状态",acquisitionMethod:"获知方式",
  riskLevel:"风险级别",confidence:"可信程度",confidenceNote:"可信说明",planAlignment:"与规划的关系",planExpectation:"规划预期",
  evidenceStart:"正文证据起点",evidenceEnd:"正文证据终点",evidenceLabel:"证据说明",reason:"变化原因",specificationHash:"正式字段规格",
  baselineHash:"变化前的状态",catalogHash:"正式对象与字段范围",value:"初始状态",decisions:"核对选择",itemId:"变化提案",decision:"核对决定",note:"核对说明",actor:"操作来源",
};
