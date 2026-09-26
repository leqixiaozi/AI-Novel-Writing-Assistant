const test=require('node:test'),assert=require('node:assert/strict');
const {compiled}=require('./support/isolatedDatabase.cjs');
const {plannedTension,referenceTension}=compiled('common/planningRhythm');
const {preparePrompt}=compiled('server/ai/prompts');
const input={bookName:'测试书',bookDescription:'',target:{level:'chapter',title:'第一章',currentContent:{tensionCurve:{value:62,source:'user',locked:true,beatKey:'揭晓'}},parentContent:null},materials:[],adoptedPlans:[],instruction:''};
const output={title:'第一章',goal:'查明线索',storyTime:'',mustHappen:[],mustPreserve:[],forbiddenBoundaries:[],expectedChanges:[],characterArc:'',notes:'',sourceCardIds:[],stageFields:{openingHook:'发现线索',pressureTurn:'线索被夺',chapterPayoff:'确认身份',endingHook:'等待追查',tensionCurve:input.target.currentContent.tensionCurve}};
test('manual fixed tension survives AI planning and chapter fields use their declared stage',()=>{
 const prompt=preparePrompt('planning_candidate',input);assert.deepEqual(prompt.parseOutput(output),output);
 for(const tension of [{value:61,source:'ai',locked:false,beatKey:'揭晓'},{value:62,source:'user',locked:false,beatKey:'揭晓'},{value:62,source:'user',locked:true,beatKey:'其他'}])assert.throws(()=>prompt.parseOutput({...output,stageFields:{...output.stageFields,tensionCurve:tension}}));
 assert.throws(()=>prompt.parseOutput({...output,stageFields:{sellingPoint:'越权修改故事核心'}}));
 const unlocked=preparePrompt('planning_candidate',{...input,target:{...input.target,currentContent:null}});
 assert.equal(unlocked.parseOutput({...output,stageFields:{tensionCurve:{value:35,source:'ai',locked:false,beatKey:''}}}).stageFields.tensionCurve.value,35);
 assert.throws(()=>unlocked.parseOutput(output));
});
test('missing tension stays missing and reference interpolation never becomes a saved planned score',()=>{
 assert.equal(plannedTension(null),null);assert.equal(plannedTension({value:101,source:'user',locked:true}),null);
 assert.equal(plannedTension({value:null,source:'user',locked:false}).value,null);
 assert.deepEqual(referenceTension([20,40,80],0),[]);assert.deepEqual(referenceTension([20,40,80],1),[20]);assert.deepEqual(referenceTension([20,40,80],5),[20,30,40,60,80]);
});
