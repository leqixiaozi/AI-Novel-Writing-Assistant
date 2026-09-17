import {fieldInCharacterSection} from "../../../common/formPresentation";
import {resolveBookFormVersion} from "../referenceParity";
import {randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import type {StoryBatchPromptInput,StoryBatchRequest,StoryBatchSlot} from '../../../common/storyWorkspace';
import type {FormAssistTarget} from '../../../common/formAssist';
import {aiFormFields} from '../../domain/formAssist';
import {assertFound,NewDesignError} from '../../domain/errors';
import {freezeFormContext,formHash} from '../formAssist';

export async function freezeStoryBatch(db:PoolClient,bookId:string,request:StoryBatchRequest):Promise<StoryBatchPromptInput>{
 const book=assertFound((await db.query("SELECT id,space_id,name,description FROM new_design.books WHERE id=$1 AND status='active'",[bookId])).rows[0],'书籍不存在或已归档。');
 const materials=(await db.query(`SELECT card.id,card.current_version_id,card.card_type_id,card.revision,card.title,card.values,type.type_key FROM new_design.cards card JOIN new_design.card_types type ON type.id=card.card_type_id WHERE card.space_id=$1 AND card.status='active' AND card.current_version_id IS NOT NULL ORDER BY card.id LIMIT 301`,[book.space_id])).rows;
 if(materials.length>300)throw new NewDesignError('本书资料超过单次准备范围，请缩小资料数量后再准备候选。',422);
 const plans=(await db.query(`SELECT object.*,version.content,parent.adopted_version_id parent_version_id FROM new_design.planning_objects object JOIN new_design.planning_versions version ON version.id=object.current_version_id LEFT JOIN new_design.planning_objects parent ON parent.id=object.parent_object_id WHERE object.book_id=$1 AND object.status='active' ORDER BY object.sort_order,object.id`,[bookId])).rows;
 const adoptedPlans=(await db.query(`SELECT object.id,object.title,version.id version_id,version.content FROM new_design.planning_objects object JOIN new_design.planning_versions version ON version.id=object.adopted_version_id WHERE object.book_id=$1 AND object.status='active' ORDER BY object.id LIMIT 301`,[bookId])).rows;
 if(adoptedPlans.length>300)throw new NewDesignError('本书已采用规划超过单次上下文范围。请先整理规划范围。',422);
 const references=(await db.query("SELECT planning_version_id,reference_role,card_id FROM new_design.planning_version_references WHERE book_id=$1 AND planning_version_id=ANY($2::uuid[])",[bookId,plans.map(plan=>plan.current_version_id)])).rows;
 const slots:StoryBatchSlot[]=[];
 if(request.mode==='setting'){
  const types=(await db.query("SELECT id,current_version_id FROM new_design.card_types WHERE space_id=$1 AND status='published' AND current_version_id IS NOT NULL AND id=ANY($2::uuid[])",[book.space_id,request.typeIds])).rows;
  if(types.length!==request.typeIds.length||!types.some(type=>type.id===request.newTypeId))throw new NewDesignError('指定内容类型不属于本书已发布规格。',422);
  const cards=materials.filter(card=>request.typeIds.includes(card.card_type_id));
  if(cards.length+request.newCount>20)throw new NewDesignError('整组准备最多 20 项；请减少新增数量或选择更小的内容分组。',422);
  const targets:Array<{card:typeof cards[number]|null;type:typeof types[number]}>=cards.map(card=>({card,type:types.find(type=>type.id===card.card_type_id)!}));
  for(let index=0;index<request.newCount;index++)targets.push({card:null,type:types.find(type=>type.id===request.newTypeId)!});
  for(const {card,type} of targets){
   const target:FormAssistTarget={bookId,cardTypeId:type.id,cardId:card?.id??null,typeVersionId:type.current_version_id,cardRevision:card?Number(card.revision):null,formVersionId:null,title:card?.title??''};
   // Scoped values are read with their original definitions by the existing source contract.
   const locals=card?(await db.query(`SELECT definition.field_key,local.value FROM new_design.cards card JOIN new_design.card_version_local_values local ON local.card_version_id=card.current_version_id JOIN new_design.field_definitions definition ON definition.id=local.field_definition_id WHERE card.id=$1 AND definition.scope='card' AND definition.status='active'`,[card.id])).rows:[];
   const values={...(card?.values??{}),...Object.fromEntries(locals.map(local=>[local.field_key,local.value]))};
   const snapshot=await freezeFormContext(db,target,values,[]);
   const fields=aiFormFields(snapshot,'prepare_all',[]);
   if(!fields.length)continue;
   slots.push({id:card?.id??randomUUID(),title:target.title||'新增设定',values,fields,target,planningId:null,revision:target.cardRevision,baseVersionId:null,parentVersionId:null,level:null,sourceHash:snapshot.sourceHash});
  }
 }else if(request.mode==='visible_prepare'||request.mode==='visible_adjust'){
  const cards=materials.filter(card=>request.cardIds.includes(card.id)&&card.type_key==='character');
  if(cards.length!==request.cardIds.length)throw new NewDesignError('指定人物不属于本书已发布人物资料，未扩大或替换范围。',422);
  for(const card of cards){
   const type=assertFound((await db.query("SELECT current_version_id FROM new_design.card_types WHERE id=$1 AND space_id=$2 AND status='published'",[card.card_type_id,book.space_id])).rows[0],'人物填写规格未发布。');
   const selected=await resolveBookFormVersion(db,String(book.space_id),'character');
   const target:FormAssistTarget={bookId,cardTypeId:card.card_type_id,cardId:card.id,typeVersionId:type.current_version_id,cardRevision:Number(card.revision),formVersionId:selected?String(selected.id):null,title:card.title};
   const locals=(await db.query("SELECT definition.field_key,local.value FROM new_design.cards card JOIN new_design.card_version_local_values local ON local.card_version_id=card.current_version_id JOIN new_design.field_definitions definition ON definition.id=local.field_definition_id WHERE card.id=$1 AND definition.scope='card' AND definition.status='active'",[card.id])).rows;
   const values={...card.values,...Object.fromEntries(locals.map(local=>[local.field_key,local.value]))},snapshot=await freezeFormContext(db,target,values,[]),keys=snapshot.fields.filter(field=>fieldInCharacterSection(field,'visible')).map(field=>field.key);
   const fields=keys.length?aiFormFields(snapshot,'adjust',keys):[];
   if(!fields.length)throw new NewDesignError(`“${card.title}”没有实际已发布且允许 AI 建议的外显字段，请先完善本书规格。`,422);
   slots.push({id:card.id,title:card.title,values,fields,target,planningId:null,revision:target.cardRevision,baseVersionId:card.current_version_id,parentVersionId:null,level:null,sourceHash:snapshot.sourceHash});
  }
 }else{
  let selected=plans;
  if(request.scopeId!=='book'){
   const root=plans.find(plan=>plan.id===request.scopeId);
   if(!root||!['volume','chapter'].includes(root.level))throw new NewDesignError('指定卷章范围不存在，未改成全书范围。',422);
   const ids=new Set<string>([root.id]);let added=true;
   while(added){added=false;for(const plan of plans)if(plan.parent_object_id&&ids.has(plan.parent_object_id)&&!ids.has(plan.id)){ids.add(plan.id);added=true;}}
   selected=plans.filter(plan=>ids.has(plan.id));
  }
  if(selected.length>30)throw new NewDesignError('一次最多准备 30 项规划，请选择一卷或一章缩小范围。',422);
  for(const plan of selected){
   if(plan.level!=='story'&&!plan.parent_version_id)throw new NewDesignError(`请先采用“${plan.title}”的上级规划，再准备此范围。`,409);
   slots.push({id:plan.id,title:plan.title,values:plan.content,fields:[],target:null,planningId:plan.id,revision:Number(plan.revision),baseVersionId:plan.current_version_id,parentVersionId:plan.parent_version_id??null,level:plan.level,references:references.filter(ref=>ref.planning_version_id===plan.current_version_id).map(ref=>({role:ref.reference_role,cardId:ref.card_id})),sourceHash:formHash({id:plan.id,revision:plan.revision,current:plan.current_version_id,parent:plan.parent_version_id??null})});
  }
  if(!selected.length&&request.scopeId==='book')slots.push({id:randomUUID(),title:'故事总览',values:{},fields:[],target:null,planningId:null,revision:null,baseVersionId:null,parentVersionId:null,level:'story',sourceHash:formHash({bookId,empty:true})});
 }
 if(!slots.length)throw new NewDesignError('此组没有可补充的空白字段，请填写新增数量或选择其他分组。',422);
 const result:StoryBatchPromptInput={bookName:book.name,bookDescription:book.description??'',mode:request.mode,instruction:request.instruction,slots,materials:materials.map(card=>({id:card.id,versionId:card.current_version_id,title:card.title,typeKey:card.type_key,values:card.values})),adoptedPlans:adoptedPlans.map(plan=>({id:plan.id,versionId:plan.version_id,title:plan.title,content:plan.content}))};
 if(JSON.stringify(result).length>180000)throw new NewDesignError('本次参考内容过长，请整理资料并缩小准备范围。',422);
 return result;
}
