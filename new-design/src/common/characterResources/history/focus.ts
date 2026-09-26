import {z} from 'zod';
import type {CharacterResourceHistory} from '.';
import {formAiFieldVisible} from '../../formAssist';
import type {FieldDefinition} from '../../contracts';
const uuid=z.string().uuid();
export interface ResourceHistoryEvidenceSource {relationId:string;resourceId:string;changeId:string;bodyVersionId:string;chapterOrder:number;fieldLabel:string;beforeDisplay:string;afterDisplay:string;start:number;end:number;text:string;}
export function resourceHistoryEvidenceSources(history:CharacterResourceHistory):ResourceHistoryEvidenceSource[]{
 return history.items.flatMap(item=>{
  const seen=new Set<string>();return item.changes.flatMap(change=>{
   const key=JSON.stringify([change.subjectKind,change.subjectId,change.stateKey]);if(seen.has(key))return[];seen.add(key);
   const anchor=change.original.anchor,contract=change.original.editingContract as {field?:{field?:FieldDefinition}}|null;
   const field=contract?.field?.field,values=change.subjectKind==='relation'?change.original.relationVersion?.properties:change.original.resourceVersion?.values;
   if(!change.available||!change.fieldAvailable||!anchor||!field||field.key!==change.stateKey||field.hidden||!values||typeof values!=='object'||!formAiFieldVisible(field,values as Record<string,unknown>))return[];
   return[{relationId:item.relationId,resourceId:item.resourceId,changeId:change.id,bodyVersionId:change.bodyVersionId,chapterOrder:change.chapterOrder,fieldLabel:change.fieldLabel,beforeDisplay:change.beforeDisplay,afterDisplay:change.afterDisplay,start:Number(anchor.start_offset),end:Number(anchor.end_offset),text:String(anchor.excerpt)}];
  });
 });
}
const evidence=z.object({changeId:uuid,bodyVersionId:uuid,start:z.number().int().nonnegative(),end:z.number().int().positive(),excerpt:z.string().min(1).max(4000)}).strict();
export const resourceHistoryFocusOutputSchema=z.array(z.object({relationId:uuid,resourceId:uuid,status:z.enum(['transferred','stale','other','unknown']),explanation:z.string().trim().min(1).max(2000),evidence:z.array(evidence).max(10)}).strict()).max(200);
export type ResourceHistoryFocusOutput=z.infer<typeof resourceHistoryFocusOutputSchema>;
/** Status here is an AI display suggestion, not a state transition or new confirmation. */
export function resourceHistoryFocusSchemaFor(history:CharacterResourceHistory){
 if(history.contract!=='character_resource_history_v1'||history.truncated||history.items.length>200||new Set(history.items.map(item=>item.relationId)).size!==history.items.length)throw new Error('历史显示判断需要完整实际范围。');
 const sources=resourceHistoryEvidenceSources(history);
 return resourceHistoryFocusOutputSchema.superRefine((output,ctx)=>{
  if(output.length!==history.items.length)ctx.addIssue({code:'custom',message:'必须覆盖全部原历史资源。'});
  const seen=new Set<string>();output.forEach((result,index)=>{
   const item=history.items.find(item=>item.relationId===result.relationId&&item.resourceId===result.resourceId);
   if(!item||seen.has(result.relationId))ctx.addIssue({code:'custom',path:[index],message:'历史判断必须使用唯一原关系和资源。'});seen.add(result.relationId);
   if(result.status!=='unknown'&&!result.evidence.length)ctx.addIssue({code:'custom',path:[index],message:'历史判断缺证据须保持未知。'});
   if(result.status!=='unknown'&&!result.evidence.some(proof=>proof.changeId===item?.changes[0]?.id))ctx.addIssue({code:'custom',path:[index],message:'须同时引用最近确认，不能忽略后续变化而仅取较早转交。'});
   result.evidence.forEach((proof,n)=>{const source=sources.find(source=>source.relationId===result.relationId&&source.resourceId===result.resourceId&&source.changeId===proof.changeId&&source.bodyVersionId===proof.bodyVersionId);
    if(!source||proof.start<source.start||proof.start>=proof.end||proof.end>source.end||source.text.slice(proof.start-source.start,proof.end-source.start)!==proof.excerpt)ctx.addIssue({code:'custom',path:[index,'evidence',n],message:'须引用最新有效原确认及确切UTF-16正文，不能按较早转交或当前零值补猜。'});
   });
  });
 });
}
