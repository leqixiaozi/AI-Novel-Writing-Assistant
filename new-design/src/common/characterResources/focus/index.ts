import type {CharacterResourceLedger, ResourceLedgerSelection} from '..';
import type {ProfessionalObject} from '../../worldCharacterMaintenance';
import {z} from 'zod';

const uuid=z.string().uuid(), hash=z.string().regex(/^[a-f0-9]{64}$/);
export const resourceFocusSelectionSchema=z.object({relationTypeId:uuid,holdingDimensionKey:z.string().min(1).max(100),specificationHash:hash}).strict();
export const resourceFocusRequestSchema=z.object({requestKey:uuid,characterId:uuid,selection:resourceFocusSelectionSchema,expectedSourceHash:hash,instruction:z.string().trim().max(2000)}).strict();
export type ResourceFocusRequest=z.infer<typeof resourceFocusRequestSchema>;
export interface ResourceFocusEvidenceSource {cardId:string;versionId:string;fieldKey:string;text:string;}
export interface ResourceFocusSnapshot {
 contract:'character_resource_focus_v1';bookId:string;characterId:string;selection:ResourceLedgerSelection;
 ledger:CharacterResourceLedger;objects:ProfessionalObject[];evidenceSources:ResourceFocusEvidenceSource[];
}
export interface ResourceFocusPreview {sourceHash:string;snapshot:ResourceFocusSnapshot;}
export interface ResourceFocusPromptInput {snapshot:ResourceFocusSnapshot;instruction:string;}
const evidenceSchema=z.object({cardId:uuid,versionId:uuid,fieldKey:z.string().min(1).max(100),start:z.number().int().nonnegative(),end:z.number().int().positive(),excerpt:z.string().min(1).max(4000)}).strict();
const explanation=z.string().trim().min(1).max(2000);
export const resourceFocusOutputSchema=z.object({
 role:z.object({value:z.enum(['protagonist','long_term','temporary','unknown']),explanation,evidence:z.array(evidenceSchema).max(10)}).strict(),
 resources:z.array(z.object({relationId:uuid,resourceId:uuid,importance:z.enum(['key','ordinary','unknown']),reasons:z.array(z.enum(['cross_chapter','conflict','promise','hidden_card','transfer_plan'])).max(5),explanation,evidence:z.array(evidenceSchema).max(10)}).strict()).max(200),
 notes:z.array(z.string().max(4000)).max(30),
}).strict();
export type ResourceFocusOutput=z.infer<typeof resourceFocusOutputSchema>;
export function sameResourceFocusValue(left:unknown,right:unknown):boolean {
 if(left===right)return true;if(Array.isArray(left)||Array.isArray(right))return Array.isArray(left)&&Array.isArray(right)&&left.length===right.length&&left.every((value,index)=>sameResourceFocusValue(value,right[index]));
 if(!left||!right||typeof left!=='object'||typeof right!=='object')return false;
 const a=left as Record<string,unknown>,b=right as Record<string,unknown>,keys=Object.keys(a);return keys.length===Object.keys(b).length&&keys.every(key=>Object.hasOwn(b,key)&&sameResourceFocusValue(a[key],b[key]));
}
export interface ResourceFocusRecord {id:string;bookId:string;request:ResourceFocusRequest;status:string;stage:string;error:string;snapshot:ResourceFocusSnapshot;output:ResourceFocusOutput|null;createdAt:string;sourceRoute:string;}
export interface ResourceFocusApi {
 previewResourceFocus:(bookId:string,characterId:string,selection:ResourceLedgerSelection)=>Promise<ResourceFocusPreview>;
 generateResourceFocus:(bookId:string,input:ResourceFocusRequest)=>Promise<ResourceFocusRecord>;
 readResourceFocusOriginal:(bookId:string,input:ResourceFocusRequest)=>Promise<ResourceFocusRecord|null>;
 getResourceFocusRecord:(bookId:string,characterId:string,requestKey:string)=>Promise<ResourceFocusRecord|null>;
 endUnknownResourceFocus:(bookId:string,input:ResourceFocusRequest)=>Promise<ResourceFocusRecord>;
}
export function validResourceFocusRecord(value:unknown,bookId:string,characterId:string):value is ResourceFocusRecord {
 try{
  const record=value as ResourceFocusRecord,request=resourceFocusRequestSchema.parse(record.request);
  if(record.bookId!==bookId||record.id!==request.requestKey||request.characterId!==characterId||!uuid.safeParse(record.id).success||!['running','review','failed','discarded'].includes(record.status)||typeof record.stage!=='string'||typeof record.error!=='string'||typeof record.createdAt!=='string'||!Number.isFinite(Date.parse(record.createdAt))||record.snapshot.bookId!==bookId||record.snapshot.characterId!==characterId||JSON.stringify(resourceFocusSelectionSchema.parse(record.snapshot.selection))!==JSON.stringify(request.selection)||record.sourceRoute!==`/new-design/books/${bookId}/story-setting?tab=characters&selected=${characterId}&detail=resources&resourceFocus=${record.id}`)return false;
  const schema=resourceFocusSchemaFor({snapshot:record.snapshot,instruction:request.instruction});
  return record.status==='review'?record.output!==null&&schema.safeParse(record.output).success:record.output===null;
 }catch{return false;}
}

export function resourceFocusEvidenceText(value:unknown):string|null {
 if(value===undefined||value===null)return null;
 const text=typeof value==='string'?value:JSON.stringify(value);
 return text?.length?text:null;
}

/** Evidence is from actual saved fields; inference never becomes a holding or fact. */
export function resourceFocusSchemaFor(input:ResourceFocusPromptInput){
 const {snapshot}=input;
 if(!snapshot||snapshot.contract!=='character_resource_focus_v1'||!uuid.safeParse(snapshot.bookId).success||!uuid.safeParse(snapshot.characterId).success||snapshot.ledger.bookId!==snapshot.bookId||snapshot.ledger.characterId!==snapshot.characterId||snapshot.ledger.truncated||snapshot.ledger.items.length>200||!snapshot.ledger.selection||snapshot.ledger.selection.relationTypeId!==snapshot.selection.relationTypeId||snapshot.ledger.selection.holdingDimensionKey!==snapshot.selection.holdingDimensionKey||snapshot.ledger.selection.specificationHash!==snapshot.selection.specificationHash)throw new Error('人物资源判断需要完整实际来源。');
 const objects=new Map(snapshot.objects.map(object=>[object.id,object]));
 if(objects.size!==snapshot.objects.length||!objects.has(snapshot.characterId)||snapshot.ledger.items.some(item=>objects.get(item.resourceId)?.versionId!==item.resourceVersionId)||snapshot.evidenceSources.some(source=>objects.get(source.cardId)?.versionId!==source.versionId||!objects.get(source.cardId)?.fields.some(item=>item.field.key===source.fieldKey&&!item.field.hidden)||resourceFocusEvidenceText(objects.get(source.cardId)?.values[source.fieldKey])!==source.text))throw new Error('人物资源证据与实际档案版本不同。');
 return resourceFocusOutputSchema.superRefine((output,ctx)=>{
  const check=(proof:z.infer<typeof evidenceSchema>,path:(string|number)[])=>{const source=snapshot.evidenceSources.find(source=>source.cardId===proof.cardId&&source.versionId===proof.versionId&&source.fieldKey===proof.fieldKey);if(!source||proof.start>=proof.end||proof.end>source.text.length||source.text.slice(proof.start,proof.end)!==proof.excerpt)ctx.addIssue({code:'custom',path,message:'原档案证据的版本或UTF-16位置不匹配。'});};
  output.role.evidence.forEach((proof,index)=>{check(proof,['role','evidence',index]);if(proof.cardId!==snapshot.characterId)ctx.addIssue({code:'custom',path:['role','evidence',index],message:'人物定位只能引用当前人物原档案。'});});
  if(output.role.value!=='unknown'&&(!output.role.evidence.length||objects.get(snapshot.characterId)?.unavailableReason))ctx.addIssue({code:'custom',path:['role'],message:'定位缺少有效原档案证据时须保持未知。'});
  const seen=new Set<string>();
  if(output.resources.length!==snapshot.ledger.items.length)ctx.addIssue({code:'custom',path:['resources'],message:'必须逐项说明完整原资源范围，不能静默省略。'});
  output.resources.forEach((item,index)=>{
   const original=snapshot.ledger.items.find(original=>original.relationId===item.relationId&&original.resourceId===item.resourceId);
   if(!original||seen.has(item.relationId))ctx.addIssue({code:'custom',path:['resources',index],message:'资源必须使用原范围内真实且唯一的持有关系。'});seen.add(item.relationId);
   if(new Set(item.reasons).size!==item.reasons.length||item.importance!=='key'&&item.reasons.length||item.importance==='key'&&!item.reasons.length||item.importance!=='unknown'&&!item.evidence.length)ctx.addIssue({code:'custom',path:['resources',index],message:'重要性、理由和出处不完整；未知不能伪造判断。'});
   if(item.importance!=='unknown'&&(!original?.available||objects.get(item.resourceId)?.unavailableReason))ctx.addIssue({code:'custom',path:['resources',index],message:'资源原来源无效时须保持未知。'});
   item.evidence.forEach((proof,proofIndex)=>{check(proof,['resources',index,'evidence',proofIndex]);if(proof.cardId!==item.resourceId&&proof.cardId!==snapshot.characterId)ctx.addIssue({code:'custom',path:['resources',index,'evidence',proofIndex],message:'只能引用当前人物与该资源的原档案。'});});
  });
 });
}
