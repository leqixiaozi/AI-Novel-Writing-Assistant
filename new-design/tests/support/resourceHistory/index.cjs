const {randomUUID}=require('node:crypto'),{compiled}=require('../isolatedDatabase.cjs'),{resourceSupplementFixture}=require('../resourceSupplementFixture.cjs');
const key=()=>randomUUID();
/** Actual published relation, author confirmations and matching adopted body. No model or synthetic database. */
exports.resourceHistoryScenario=async function(t){
 const f=await resourceSupplementFixture(t),{book,settlement}=f,types=await f.cards.listCardTypes(book.spaceId),actorType=types.find(type=>type.key==='character');
 const role=await f.fields.createBookFieldExtension(book.id,{cardTypeId:actorType.id,expectedTypeRevision:actorType.revision,field:{name:'角色登场安排',description:'作者明确定位',type:'long_text',required:false,defaultValue:null,options:[],group:'角色',aiSuggestible:true,stateSettlement:'none'},backfillStrategy:'none',idempotencyKey:key(),createdBy:'isolated_test'});
 const actor=await f.cards.updateCard(f.actor.id,{title:f.actor.title,values:{...f.actor.values,story_role:'supporting',[role.fieldKey]:'本人物是临时客串，钥匙转交后退出主线。'},revision:f.actor.revision});
 const props=[await f.create('prop','钥匙',{name:'钥匙'}),await f.create('prop','凭证',{name:'凭证'})];
 const field=(key,name,type,options=[])=>({key,name,type,description:'明确作者状态',required:false,defaultValue:null,options,group:'资源',order:1,aiSuggestible:true});
 const definition={name:'历史状态持有',description:'隔离来源',direction:'directed',sourceTypeKeys:['character'],targetTypeKeys:['prop'],sourceMax:null,targetMax:null,fields:[field('holding','持有','boolean'),field('stage','叙事状态','select',[{value:'x0',label:'可用'},{value:'x1',label:'已转交'},{value:'x2',label:'淡出'}])],capability:'optional',mode:'relation_state',dimensions:[{fieldKey:'holding',label:'持有',direction:'forward',policy:'tracked',mode:'absolute'},{fieldKey:'stage',label:'叙事状态',direction:'forward',policy:'lifecycle_only',mode:'lifecycle'}]};
 const draft=await settlement.saveSettlementRelationConfigurationDraft(book.id,{requestKey:key(),expectedRelationTypeRevision:null,definition});
 await settlement.publishSettlementRelationConfigurationDraft(book.id,{requestKey:key(),draftId:draft.draftId,expectedRevision:1,confirmPublish:true,confirmInstanceRebind:false,rebindRelations:[],createRelations:props.map(prop=>({sourceCardId:actor.id,targetCardId:prop.id}))});
 const resources=compiled('server/database/characterResources'),ledger=await resources.getCharacterResources(book.id,actor.id),choice=ledger.choices.find(item=>item.holdingDimensionKey==='holding'),selection={relationTypeId:choice.relationTypeId,holdingDimensionKey:choice.holdingDimensionKey,specificationHash:choice.specificationHash};
 const items=(await resources.getCharacterResources(book.id,actor.id,selection)).items;
 for(const item of items)for(const [stateKey,value]of [['holding',false],['stage','x0']])await f.state.saveInitialState({bookId:book.id,subjectKind:'relation',subjectId:item.relationId,stateKey,value,requestKey:key(),actor:'isolated_test',note:''});
 const drafts=last=>(workspace,content)=>items.flatMap(item=>['holding','stage'].map(stateKey=>{
  const source=workspace.catalog.subjects.find(source=>source.id===item.relationId),field=source.fields.find(field=>field.key===stateKey),after=stateKey==='holding'?!last:last?(item.resourceId===props[0].id?'x1':'x2'):'x0';
  return{category:'relationship',title:`${item.name}原确认`,subjectKind:'relation',subjectId:item.relationId,stateKey,specificationHash:field.specificationHash,baselineHash:field.baseline.hash,beforeValue:field.baseline.value,afterValue:after,valueKind:stateKey==='holding'?'boolean':'text',riskLevel:'medium',evidenceStart:0,evidenceEnd:content.length,evidenceLabel:'确切资源正文',reason:'作者明确核对原正文及资源状态',holderKind:'reader',holderKey:'default',stance:'knows',acquisitionMethod:'narration'};
 }));
 const first=await f.chapter(1,1,false,drafts(false),'临时角色拿起钥匙😀，收好凭证。数量为1。'),second=await f.chapter(2,2,false,drafts(true),'临时角色把钥匙交给主角😀，不再持有。凭证随临时身份退出后续故事。数量为2。');
 for(const prop of props)await f.cards.archiveCard(prop.id,prop.revision);
 return{...f,actor,props,roleField:role.fieldKey,items,selection,first,second};
};
