const {isolatedDatabase,compiled}=require('./isolatedDatabase.cjs');
const assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const key=()=>randomUUID();
exports.resourceSupplementFixture=async function(t,extraMigrations=[]){
 const {pool,database}=await isolatedDatabase(t,extraMigrations);t.diagnostic(`Isolated database retained: ${database}`);
 const templates=compiled('server/database/templateStore'),cards=compiled('server/database/store'),fields=compiled('server/database/fieldExtensions'),state=compiled('server/database/stateStore');
 const planning=compiled('server/database/planning'),body=compiled('server/database/chapterBodyStore'),writing=compiled('server/database/chapterWriting'),settlement=compiled('server/database/chapterSettlement'),supplements=compiled('server/database/resourceSupplements');
 let template=await templates.saveTemplate({key:`s_${key().replaceAll('-','')}`,name:'稳定补充隔离模板',description:'',draftConfig:{},requestKey:key()});template=await templates.publishTemplate(template.id,template.revision,key());
 const book=await templates.createBook({key:`s_${key().replaceAll('-','')}`,name:'稳定补充隔离书',description:'',templateVersionId:template.currentVersionId}),types=await cards.listCardTypes(book.spaceId),actorType=types.find(type=>type.key==='character');
 const extensions=[];for(const [name,type] of [['数量','number'],['持有','boolean'],['后补状态','number'],['未消耗数量','number']]){
  const current=await cards.getCardType(actorType.id);extensions.push(await fields.createBookFieldExtension(book.id,{cardTypeId:actorType.id,expectedTypeRevision:current.revision,field:{name,description:'正式状态',type,required:false,defaultValue:null,options:[],group:'资源',aiSuggestible:true,stateSettlement:'tracked'},backfillStrategy:'none',idempotencyKey:key(),createdBy:'isolated_test'}));
 }
 const [quantity,holding,late,zero]=extensions.map(item=>item.fieldKey);
 const create=(type,title,values)=>cards.createCard({cardTypeId:types.find(item=>item.key===type).id,spaceId:book.spaceId,title,values});
 const actor=await create('character','资源人物',{name:'资源人物',story_role:'protagonist',[quantity]:0,[holding]:false});
 const initialQty=await state.saveInitialState({bookId:book.id,subjectKind:'card',subjectId:actor.id,stateKey:quantity,value:0,requestKey:key(),actor:'isolated_test',note:''});
 const initialHolding=await state.saveInitialState({bookId:book.id,subjectKind:'card',subjectId:actor.id,stateKey:holding,value:false,requestKey:key(),actor:'isolated_test',note:''});
 const initialZero=await state.saveInitialState({bookId:book.id,subjectKind:'card',subjectId:actor.id,stateKey:zero,value:0,requestKey:key(),actor:'isolated_test',note:''});
 const planContent={goal:'取得资源',mustHappen:[],mustPreserve:[],forbiddenBoundaries:[],expectedChanges:[],characterArc:'',notes:''};
 async function plan(level,parent,cardId,sortOrder){let object=await planning.createPlanningObject({bookId:book.id,level,parentObjectId:parent?.id??null,basedOnParentVersionId:parent?.adoptedVersionId??null,cardId:cardId??null,title:level,sortOrder,content:planContent,source:'manual',executionMode:'ai_assisted',references:[],idempotencyKey:key()});return planning.adoptPlanningVersion(object.id,{versionId:object.currentVersionId,expectedRevision:object.revision,idempotencyKey:key()});}
 const story=await plan('story',null,null,0),volumeCard=await create('volume','资源卷',{volume_name:'资源卷',major_goal:'取得资源'}),volume=await plan('volume',story,volumeCard.id,0);
 async function chapter(order,after,withConfirmations=false,additionalDrafts,bodyContent){
  const card=await create('chapter',`第${order}章`,{chapter_name:`第${order}章`,chapter_goal:'取得资源'}),object=await plan('chapter',volume,card.id,order);
  const document=await body.createChapterDocument({bookId:book.id,chapterCardId:card.id,logicalOrder:order,title:`第${order}章`}),content=bodyContent??`资源人物取得资源😀，数量为${after}。`;
  const candidate=await writing.saveChapterCandidate(document.id,{content,operationKind:'manual_draft',expectedRevision:document.revision,idempotencyKey:key()}),version=candidate.versions[0],preparation=await writing.prepareChapterAdoption(document.id,{bodyVersionId:version.id,expectedRevision:candidate.revision,idempotencyKey:key()}),started=await settlement.startChapterAdoptionSession(preparation.id,{expectedRevision:candidate.revision,idempotencyKey:key()});
  let workspace=await settlement.getChapterSettlementEditingWorkspace(started.session.id);
  for(const category of withConfirmations?['fact','knowledge','character_state']:['character_state']){
   const field=workspace.catalog.subjects.find(item=>item.id===actor.id).fields.find(item=>item.key===quantity);assert.ok(field);
   const saved=await settlement.createChapterSettlementEditingItem(workspace.session.id,{expectedSessionRevision:workspace.session.revision,requestKey:key(),draft:{category,title:`资源数量${after}`,subjectKind:'card',subjectId:actor.id,stateKey:quantity,specificationHash:field.specificationHash,baselineHash:field.baseline.hash,beforeValue:field.baseline.value,afterValue:after,valueKind:'number',riskLevel:'medium',evidenceStart:0,evidenceEnd:content.length,evidenceLabel:'资源正文',reason:'作者明确确认正文',holderKind:'reader',holderKey:'default',stance:'knows',acquisitionMethod:'narration'}});workspace=saved.workspace;
  }
  for(const draft of additionalDrafts?additionalDrafts(workspace,content):[]){
   workspace=(await settlement.createChapterSettlementEditingItem(workspace.session.id,{expectedSessionRevision:workspace.session.revision,requestKey:key(),draft})).workspace;
  }
  workspace=(await settlement.decideChapterSettlementEditingItems(workspace.session.id,{expectedSessionRevision:workspace.session.revision,requestKey:key(),decisions:workspace.items.map(item=>({itemId:item.id,expectedRevision:item.revision,decision:'confirm'}))})).workspace;
  workspace=(await settlement.commitChapterSettlementEditing(workspace.session.id,{expectedSessionRevision:workspace.session.revision,requestKey:key()})).workspace;
  assert.equal(workspace.session.status,'stable');const checkpoint=(await pool.query("SELECT * FROM new_design.chapter_stable_checkpoints WHERE session_id=$1 AND status='stable'",[workspace.session.id])).rows[0];assert.ok(checkpoint);return{card,object,document,version,preparation,workspace,content,checkpoint};
 }
 return{pool,database,book,actor,quantity,holding,late,zero,initialQty,initialHolding,initialZero,volume,planContent,create,chapter,templates,cards,fields,state,planning,body,writing,settlement,supplements};
};
