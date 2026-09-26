const {test}=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {compiled}=require('./support/isolatedDatabase.cjs');
const key=()=>randomUUID();
const time={lifecycle:'planned',timeMode:'unknown',startCertainty:'unknown',endCertainty:'unknown',startInstant:null,endInstant:null,timezoneName:null,calendarKey:null,startLabel:null,endLabel:null,normalizedStart:null,normalizedEnd:null,durationValue:null,durationUnit:null,relativeToEventCardId:null,relativeRelation:null,relativeOffset:null,replacesTimingId:null,reason:'日期未知'};
test('structured biography output rejects forged ownership, source positions, facts and external event references',()=>{
 const {experienceOutputSchema}=compiled('common/characterExperiences/schema'),actors=[0,1].map(()=>({id:key(),fieldKey:'bio',text:'年少😀离乡',slotIds:[key(),key(),key()]})),event={id:key(),versionId:key(),title:'离乡'},snapshot={actors,events:[event]},schema=experienceOutputSchema(snapshot),candidate={id:actors[0].slotIds[0],characterId:actors[0].id,fieldKey:'bio',title:'离乡',summary:'待核对',evidenceStart:2,evidenceEnd:4,evidenceLabel:'😀',suggestedEventId:null,time};
 const output=item=>({candidates:[item],notes:[]});assert.equal(schema.safeParse(output(candidate)).success,true);
 for(const altered of [{...candidate,id:actors[1].slotIds[0]},{...candidate,characterId:key()},{...candidate,fieldKey:'other'},{...candidate,evidenceEnd:3},{...candidate,evidenceLabel:'猜测原文'},{...candidate,evidenceStart:0,evidenceEnd:100},{...candidate,suggestedEventId:key()},{...candidate,time:{...time,lifecycle:'occurred'}},{...candidate,time:{...time,relativeToEventCardId:key()}},{...candidate,time:{...time,startInstant:'2026-09-17T12:00:00'}},{...candidate,time:{...time,normalizedStart:Infinity}}])assert.equal(schema.safeParse(output(altered)).success,false);
 assert.equal(schema.safeParse({candidates:[candidate,candidate],notes:[]}).success,false);
});
