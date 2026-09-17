import {z} from 'zod';
import type {StoryBatchPromptInput} from '../../../common/storyWorkspace';
import type {PromptAsset} from './contracts';
import {fieldInput,fieldsOutput,text} from './fields';

export const storyWorkspaceAsset:PromptAsset={
 assetId:'new_design.story_workspace.batch',version:'v1',taskType:'story_workspace_batch',label:'准备整组故事候选',
 contextPolicy:'explicit_task_snapshot_only',temperature:0.5,maxTokens:16000,
 instruction:'为本次明确列出的每个 slot 准备相互协调的中文创作候选。只能返回指定 slot 的字段，不扩大对象或规划范围。设定只补充空白字段，尊重已有手填资料、字段类型和允许选项；不得替换现有名称。规划遵循本次冻结的已采用上级依据，在原粒度上提出目标、时间、必要事件、边界和人物弧。规划安排是未来创作建议，不代表事实或结算已经发生。不得生成正文，不得声称保存或采用。无依据的事实应作为待确认问题写入备注。候选以 slot.id 为稳定键，所有指定 slot 均须返回。',
 prepare(value){
  const input=value as StoryBatchPromptInput;
  z.object({bookName:z.string().max(300),bookDescription:text,mode:z.enum(['setting','planning']),instruction:z.string().max(2000),slots:z.array(z.object({id:z.string().uuid(),fields:z.array(fieldInput).max(300)}).passthrough()).min(1).max(30),materials:z.array(z.unknown()).max(300),adoptedPlans:z.array(z.unknown()).max(300)}).strict().parse(value);
  if(new Set(input.slots.map(slot=>slot.id)).size!==input.slots.length)throw new Error('候选对象重复。');
  const planning=z.object({goal:z.string().trim().min(1).max(5000),storyTime:z.string().trim().max(500),mustHappen:z.array(z.string().trim().min(1).max(1000)).max(100),mustPreserve:z.array(z.string().trim().min(1).max(1000)).max(100),forbiddenBoundaries:z.array(z.string().trim().min(1).max(1000)).max(100),expectedChanges:z.array(z.string().trim().min(1).max(1000)).max(100),characterArc:z.string().trim().max(5000),notes:z.string().trim().max(5000)}).strict();
  const shape:Record<string,z.ZodType>=Object.create(null);
  for(const slot of input.slots){
   if(input.mode==='setting'){shape[slot.id]=fieldsOutput(slot.fields.map(field=>fieldInput.parse(field)),true).refine(output=>Object.keys(output).length>0,'每项设定至少需要一项字段建议。');continue;}
   const events:Record<string,z.ZodType>=Object.create(null);
   for(const ref of slot.references??[])if(ref.role==='event')events[ref.cardId]=z.object({occurrenceOrder:z.number().finite().nullable(),timeLabel:z.string().trim().max(500)}).strict().optional();
   const ids=input.materials.filter(material=>material.typeKey==='character').map(material=>material.id),person=ids.length?z.enum(ids as [string,...string[]]):z.never();
   shape[slot.id]=planning.extend({eventSchedule:z.object(events).strict().optional(),relationshipPlans:z.array(z.object({sourceId:person,targetId:person,description:z.string().trim().min(1).max(2000)}).strict().refine(row=>row.sourceId!==row.targetId,'关系计划需要两个不同人物。')).max(30).optional()});
  }
  // Keep the full provenance in the batch snapshot, and send only creative inputs.
  // No material values or objects are truncated to make a budget appear sufficient.
  const taskData={bookName:input.bookName,bookDescription:input.bookDescription,mode:input.mode,instruction:input.instruction,
   slots:input.slots.map(slot=>({id:slot.id,title:slot.title,level:slot.level,currentValues:slot.values,references:slot.references??[],fields:slot.fields.map(field=>({key:field.key,name:field.name,description:field.description,type:field.type,required:field.required,options:field.options,...(field.optionSource?.kind==='dictionary_tree'?{minSelections:field.optionSource.rule.minSelections,maxSelections:field.optionSource.rule.maxSelections}:{})}))})),
   materials:input.materials.map(({id,title,typeKey,values})=>({id,title,typeKey,values})),adoptedPlans:input.adoptedPlans.map(({id,title,content})=>({id,title,content})),
  };
  return {input:taskData,schema:z.object({candidates:z.object(shape).strict()}).strict()};
 },
};
