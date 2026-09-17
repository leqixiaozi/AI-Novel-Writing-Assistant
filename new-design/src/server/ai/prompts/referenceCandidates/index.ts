import {chapterSettlementAsset,type ChapterSettlementPromptInput} from "../chapterSettlement";
import {z} from 'zod';
import type {StoryBatchPromptInput} from '../../../../common/storyWorkspace';
import type {PromptAsset} from '../contracts';
import {fieldInput,fieldsOutput} from '../fields';
import {fieldInCharacterSection} from '../../../../common/formPresentation';
export function storyBatchTask(mode:StoryBatchPromptInput['mode']):'visible_prepare'|'visible_adjust'|'story_workspace_batch'{return mode==='visible_prepare'?'visible_prepare':mode==='visible_adjust'?'visible_adjust':'story_workspace_batch';}
export const referenceCandidateAssets:PromptAsset[]=(['visible_prepare','visible_adjust'] as const).map(taskType=>({
 assetId:`new_design.character.${taskType}`,version:'v1',taskType,label:taskType==='visible_prepare'?'准备人物外显':'调整人物外显',contextPolicy:'explicit_task_snapshot_only',temperature:0.5,maxTokens:16000,
 instruction:taskType==='visible_prepare'?'为确切列出的每个人物及已发布外显字段准备协调的写作候选。尊重已有档案、背景、意图与已填写外显；需要调整已有值时只提出候选，不能自行覆盖。外显是档案表达，不建立正式状态、成长、经历、资源持有或认知事实。不得输出未列出的字段、人物或名称，不得声称已保存或采用。':'按本次要求调整确切列出的每个人物及已发布外显字段，说明性要求只作为创作资料。已有填写完整保留用于比较；提出候选不代表用户同意覆盖。不得改变人物身份、正式状态、经历、资源持有、认知或范围。不得输出未列出的字段或人物，不得声称保存或采用。',
 prepare(value){
  const input=value as StoryBatchPromptInput;z.object({bookName:z.string().max(300),bookDescription:z.string().max(30000),mode:z.literal(taskType),instruction:z.string().max(2000),slots:z.array(z.object({id:z.string().uuid(),fields:z.array(fieldInput).min(1).max(300)}).passthrough()).min(1).max(20),materials:z.array(z.unknown()).max(300),adoptedPlans:z.array(z.unknown()).max(300)}).strict().parse(input);
  if(new Set(input.slots.map(slot=>slot.id)).size!==input.slots.length)throw new Error('人物候选身份重复。');
  const shape:Record<string,z.ZodType>=Object.create(null);
  for(const slot of input.slots){if(slot.fields.some(field=>!fieldInCharacterSection(field,'visible')))throw new Error('外显候选含非外显字段。');shape[slot.id]=fieldsOutput(slot.fields.map(field=>fieldInput.parse({...field,required:false})),false).refine(output=>Object.keys(output).length>0,'每个人物至少返回一项外显候选。');}
  return {input:{bookName:input.bookName,bookDescription:input.bookDescription,mode:input.mode,instruction:input.instruction,slots:input.slots.map(slot=>({id:slot.id,title:slot.title,currentValues:slot.values,fields:slot.fields})),materials:input.materials,adoptedPlans:input.adoptedPlans},schema:z.object({candidates:z.object(shape).strict()}).strict()};
 }
}));

const resourceFrozenScope=z.object({relationTypeId:z.string().uuid(),holdingDimensionKey:z.string().min(1).max(100),specificationHash:z.string().regex(/^[a-f0-9]{64}$/),characterId:z.string().uuid(),characterVersionId:z.string().uuid(),characterRevision:z.number().int().positive(),resourceIds:z.array(z.string().uuid()).min(1).max(200),relationIds:z.array(z.string().uuid()).min(1).max(200),resources:z.array(z.object({id:z.string().uuid(),versionId:z.string().uuid(),relationId:z.string().uuid(),relationVersionId:z.string().uuid()}).strict()).min(1).max(200),anchors:z.array(z.object({id:z.string().uuid(),subjectCardId:z.string().uuid(),start:z.number().int().nonnegative(),end:z.number().int().positive(),excerpt:z.string().min(1)}).strict()).max(10000)}).strict();
/** Uses the same typed settlement output; only the explicit resource subset is eligible. */
export const characterResourceBackfillAsset:PromptAsset={
 ...chapterSettlementAsset,assetId:"new_design.character.resource_backfill",version:"v1",taskType:"character_resource_backfill",label:"从采用正文回填人物资源候选",
 instruction:chapterSettlementAsset.instruction+"本次范围只包含明确列出的人物资源、已有持有关系及其已发布字段；resources固定真实资料版本，anchors固定采用正文锚点。不得创建资源、关系、初始基线或猜测未知数量，不得从创作关联或图片推断持有。只提取范围内真实发生的资源与持有状态变化，其他人物与普通档案均禁止输出。",
 prepare(value){const input=value as ChapterSettlementPromptInput;const {resourceScope:scope,...base}=input;const resourceScope=resourceFrozenScope.parse(scope);if(resourceScope.resourceIds.length!==new Set(resourceScope.resourceIds).size||resourceScope.relationIds.length!==new Set(resourceScope.relationIds).size)throw new Error("资源回填范围不完整或重复。");if(base.catalog.subjects.some(subject=>subject.subjectKind==="card"?!resourceScope.resourceIds.includes(subject.id):!resourceScope.relationIds.includes(subject.id)))throw new Error("候选规格越过已确认资源范围。");if(resourceScope.resources.length!==resourceScope.relationIds.length||new Set(resourceScope.resources.map(item=>item.relationId)).size!==resourceScope.relationIds.length||resourceScope.resources.some(item=>!resourceScope.resourceIds.includes(item.id)||!resourceScope.relationIds.includes(item.relationId))||new Set(resourceScope.resources.map(item=>item.id)).size!==resourceScope.resourceIds.length||resourceScope.anchors.some(anchor=>anchor.subjectCardId!==resourceScope.characterId&&!resourceScope.resourceIds.includes(anchor.subjectCardId)||base.bodyContent.slice(anchor.start,anchor.end)!==anchor.excerpt))throw new Error("冻结资源、关系版本或锚点与确切范围不同。");const prepared=chapterSettlementAsset.prepare(base);return {...prepared,input:{...base,resourceScope}};}
};
