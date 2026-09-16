const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {creationCatalog,creationCardsHash,validateFormalReview,saveFormalReviewInputSchema}=require('../dist/server/database/bookCreationProduction');
const uuid=n=>`40000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const field={key:'trust',name:'信任',description:'',type:'number',required:false,defaultValue:null,options:[],group:'关系',order:0};
const cards=[{id:uuid(1),typeKey:'character',title:'主角',values:{},sourceKind:'manual',sourceId:null,sourceVersionId:null,originalTitle:'主角',originalValues:{}},{id:uuid(2),typeKey:'character',title:'同伴',values:{},sourceKind:'manual',sourceId:null,sourceVersionId:null,originalTitle:'同伴',originalValues:{}}];
const template={cardTypes:[],dictionaries:[],relationTypes:[{sourceId:uuid(3),key:'companion',name:'同伴关系',description:'',direction:'directed',sourceTypeKeys:['character'],targetTypeKeys:['character'],sourceMax:1,targetMax:null,propertiesSchema:[field]}],forms:[],seedCards:[],menu:{defaultPage:'overview',pages:[]}};
const input=()=>({expectedSessionRevision:1,expectedFormalRevision:null,requestKey:uuid(4),templateVersionId:uuid(5),reviewCardsHash:creationCardsHash(cards),relations:[],plans:[]});
const relation=()=>({id:uuid(6),relationTypeSourceId:uuid(3),sourceReviewCardId:uuid(1),targetReviewCardId:uuid(2),properties:{trust:5},decision:'include'});
test('empty manual production review is not forced into an unrelated four-layer adoption gate',()=>{const value=input();assert.doesNotThrow(()=>validateFormalReview(value,creationCatalog(uuid(5),template,cards),cards,true));});
test('formal relations use exact template and review IDs, never matching titles',()=>{const value={...input(),relations:[{...relation(),targetReviewCardId:uuid(99)}]};assert.throws(()=>validateFormalReview(value,creationCatalog(uuid(5),template,cards),cards),error=>error.status===422);});
test('typed properties and formal endpoint constraints apply to included relationships',()=>{for(const properties of [{trust:'错误类型'},{unknown:5}])assert.throws(()=>validateFormalReview({...input(),relations:[{...relation(),properties}]},creationCatalog(uuid(5),template,cards),cards),error=>error.status===422);});
test('changed author sources are not silently rebased while saving formal drafts',()=>{assert.throws(()=>validateFormalReview({...input(),reviewCardsHash:'0'.repeat(64)},creationCatalog(uuid(5),template,cards),cards),error=>error.status===409);});
test('pending decisions are explicitly reviewed before installation',()=>{assert.throws(()=>validateFormalReview({...input(),relations:[{...relation(),decision:'pending'}]},creationCatalog(uuid(5),template,cards),cards,true),error=>error.status===422);});
test('unrecognized historical relation schema is shown unavailable rather than stripped and published',()=>{const catalog=creationCatalog(uuid(5),{...template,relationTypes:[{...template.relationTypes[0],propertiesSchema:null}]},cards);assert.equal(catalog.relationSpecs[0].editable,false);assert.ok(catalog.relationSpecs[0].unavailableReason);});
test('formal save schema preserves typed fields and rejects browser contract overrides',()=>{assert.equal(saveFormalReviewInputSchema.parse(input()).requestKey,uuid(4));assert.throws(()=>saveFormalReviewInputSchema.parse({...input(),catalog:{}}));});

const blankContent=()=>({goal:'  ',storyTime:'',mustHappen:[],mustPreserve:[],forbiddenBoundaries:[],expectedChanges:[],characterArc:'',notes:''});
const blankPlan=()=>({id:uuid(7),parentDraftId:'  ',reviewCardId:'',level:'chapter',title:'  ',sortOrder:0,content:blankContent(),executionMode:'manual',references:[{role:'event',reviewCardId:' ',action:null,note:'',sortOrder:0}],decision:'pending'});
const blankRelation=()=>({...relation(),relationTypeSourceId:' ',sourceReviewCardId:'',targetReviewCardId:'',properties:{},decision:'pending'});
test('pending blank selections and titles parse and save without pretending to be installable',()=>{
 const value=saveFormalReviewInputSchema.parse({...input(),relations:[blankRelation()],plans:[blankPlan()]});assert.equal(value.relations[0].relationTypeSourceId,'');assert.equal(value.plans[0].parentDraftId,null);assert.equal(value.plans[0].title,'');assert.equal(value.plans[0].content.goal,'');assert.doesNotThrow(()=>validateFormalReview(value,creationCatalog(uuid(5),template,cards),cards));assert.throws(()=>validateFormalReview(value,creationCatalog(uuid(5),template,cards),cards,true),error=>error.status===422);
});
test('excluded incomplete drafts may remain while selected invalid references or filled properties are rejected',()=>{
 const excluded=saveFormalReviewInputSchema.parse({...input(),relations:[{...blankRelation(),decision:'exclude'}],plans:[{...blankPlan(),decision:'exclude'}]});assert.doesNotThrow(()=>validateFormalReview(excluded,creationCatalog(uuid(5),template,cards),cards,true));
 for(const draft of [{...blankRelation(),relationTypeSourceId:uuid(3),sourceReviewCardId:uuid(99)},{...blankRelation(),relationTypeSourceId:uuid(3),properties:{trust:'错误类型'}}]){const value=saveFormalReviewInputSchema.parse({...input(),relations:[draft]});assert.throws(()=>validateFormalReview(value,creationCatalog(uuid(5),template,cards),cards),error=>error.status===422);}
 assert.throws(()=>saveFormalReviewInputSchema.parse({...input(),relations:[{...blankRelation(),sourceReviewCardId:'伪造编号'}]}));
});
test('include and adopted planning cannot use blank draft choices',()=>{
 for(const value of [{...input(),relations:[{...blankRelation(),decision:'include'}]},{...input(),plans:[{...blankPlan(),decision:'adopt'}]}]){const parsed=saveFormalReviewInputSchema.parse(value);assert.throws(()=>validateFormalReview(parsed,creationCatalog(uuid(5),template,cards),cards),error=>error.status===422);}
});
test('append-only same-session receipts and real version chains remain additive',()=>{
 const migration=fs.readFileSync(path.join(__dirname,'../migrations/058_book_creation_production.sql'),'utf8');assert.match(migration,/creation_request_key_unique/);assert.match(migration,/NEW\.production_receipts @> jsonb_build_array\(receipt_entry\)/);assert.doesNotMatch(migration,/\b(?:DROP|TRUNCATE)\b/i);
 const install=fs.readFileSync(path.join(__dirname,'../src/server/database/bookCreationProduction/install.ts'),'utf8');assert.ok(install.includes('INSERT INTO new_design.card_relation_versions'));assert.ok(install.includes('adoptInitialPlanningVersionInTransaction'));assert.ok(install.includes('mapping.cards.get(reviewId)'));
 const commands=fs.readFileSync(path.join(__dirname,'../src/server/database/bookCreationProduction/commands.ts'),'utf8');assert.doesNotMatch(commands,/COMMIT[^\n]*getBookCreationSession\(/);assert.ok(commands.includes('appendCreationReceipt(client,id,hash,receipt)'));
});

test('cumulative adoption preserves actual field batch provenance and explicit direction choice',()=>{
 const adoption=fs.readFileSync(path.join(__dirname,'../src/server/database/bookCreationProduction/adoption.ts'),'utf8');assert.ok(adoption.includes('plan.sourceBatches'));assert.ok(adoption.includes('stableHash(previous.output_payload)!==source.outputHash'));assert.ok(adoption.includes('preparation_generated_output'));assert.ok(adoption.includes('[key]:origin.batchId'));assert.ok(adoption.includes('$title:origin.batchId'));assert.ok(adoption.includes('direction_candidates=$6::jsonb,selected_direction_id=$7'));assert.ok(adoption.includes('row.director_active_command_key'));
});
