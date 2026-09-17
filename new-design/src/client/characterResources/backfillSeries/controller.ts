import type {ChapterSettlementAiReceipt} from '../../../common/chapterSettlementAi';
import type {ResourceSupplementStartInput,ResourceSupplementStartReceipt} from '../../../common/resourceSupplements';
import {resourceSupplementStartReceiptSchema} from '../../../common/resourceSupplements';
import type {ResourceBackfillSeries,ResourceBackfillSeriesInput,ResourceBackfillSeriesPart,ResourceBackfillAiCommand} from '../../../common/characterResources/backfillSeries';
import {resourceBackfillSeriesInputSchema,resourceBackfillSeriesPartSchema,resourceBackfillAiReceiptSchema} from '../../../common/characterResources/backfillSeries';
import {sameResourceBackfillInput as same} from './preflight';
interface Ports {
 bookId:string;characterId:string;key:string;storage:Pick<Storage,'getItem'|'setItem'>;uuid:()=>string;changed:()=>void;
 lock:(run:()=>Promise<void>)=>Promise<void>;
 prepare:(input:ResourceBackfillSeriesInput)=>Promise<ResourceBackfillSeriesPart[]>;
 prepareAi:(part:ResourceBackfillSeriesPart,input:ResourceBackfillSeriesInput)=>Promise<ResourceBackfillAiCommand>;
 start:(input:ResourceSupplementStartInput)=>Promise<ResourceSupplementStartReceipt>;
 readStart:(input:ResourceSupplementStartInput)=>Promise<ResourceSupplementStartReceipt|null>;
 ai:(command:ResourceBackfillAiCommand)=>Promise<ChapterSettlementAiReceipt>;
 readAi:(command:ResourceBackfillAiCommand)=>Promise<ChapterSettlementAiReceipt|null>;
 notWritten:(error:unknown)=>boolean;
}
export function validResourceBackfillSeries(value:unknown,book:string,actor:string):value is ResourceBackfillSeries{
 try{
  const plan=value as ResourceBackfillSeries;
  if(!plan||plan.format!==1||plan.bookId!==book||plan.characterId!==actor||typeof plan.id!=='string'||!resourceSupplementStartReceiptSchema.shape.requestKey.safeParse(plan.id).success||Object.keys(plan).some(key=>!['format','id','bookId','characterId','input','parts','next','stage','message'].includes(key))||!resourceBackfillSeriesInputSchema.safeParse(plan.input).success||plan.input.resourceScope.characterId!==actor||!Array.isArray(plan.parts)||plan.parts.length!==plan.input.documentIds.length||!Number.isInteger(plan.next)||plan.next<0||plan.next>plan.parts.length||!['ready','pending_start','pending_ai','complete','stopped'].includes(plan.stage)||typeof plan.message!=='string')return false;
  if(plan.stage==='complete'?plan.next!==plan.parts.length:plan.stage!=='stopped'&&plan.next===plan.parts.length)return false;
  const ids=new Set<string>(),requests=new Set<string>();
  for(const [index,part]of plan.parts.entries()){
   if(!resourceBackfillSeriesPartSchema.safeParse(part).success||ids.has(part.chapter.documentId)||!plan.input.documentIds.includes(part.chapter.documentId)||index>0&&part.chapter.logicalOrder<plan.parts[index-1]!.chapter.logicalOrder)return false;ids.add(part.chapter.documentId);
   if(requests.has(part.aiRequestKey))return false;requests.add(part.aiRequestKey);
   if(part.kind==='stable'?!part.startInput:part.startInput!==null||part.startReceipt!==null||!part.ai)return false;
   if(part.startInput){if(!same(part.startInput.resourceScope,plan.input.resourceScope)||requests.has(part.startInput.requestKey))return false;requests.add(part.startInput.requestKey);}
   if(part.startReceipt){const r=part.startReceipt;if(r.bookId!==book||r.chapterDocumentId!==part.chapter.documentId||r.bodyVersionId!==part.chapter.bodyVersionId||!same(r.input,part.startInput)||r.sourceHash!==part.startInput?.expectedSourceHash)return false;}
   if(part.ai){if(!same(part.ai.input.resourceScope,plan.input.resourceScope)||part.ai.input.requestKey!==part.aiRequestKey||part.kind==='stable'&&part.ai.sessionId!==part.startReceipt?.sessionId)return false;}
   if(part.receipt!==null){if(!resourceBackfillAiReceiptSchema.safeParse(part.receipt).success||!Object.hasOwn(part.receipt,'failure')||part.receipt.sessionId!==part.ai?.sessionId||part.receipt.requestKey!==part.ai?.input.requestKey||part.receipt.sourceRoute!==`/new-design/books/${book}/writing?chapterDocument=${part.chapter.documentId}&session=${part.ai?.sessionId}`||part.receipt.status==='running'||index<plan.next&&(part.receipt.status!=='succeeded'||!part.receipt.proposalsSaved||part.receipt.canImportSavedResult||part.receipt.ledgerPending)&&plan.stage!=='stopped')return false;}
   if(index<plan.next&&!part.receipt||index>=plan.next&&part.receipt!==null||index>plan.next&&part.startReceipt!==null)return false;
  }
  const current=plan.parts[plan.next];
  if(plan.stage==='pending_start'&&(!current?.startInput||current.startReceipt)||plan.stage==='pending_ai'&&(!current?.ai||current.receipt))return false;
  return true;
 }catch{return false;}
}
/** One explicit range, durable per-step commands, and read-only unknown recovery. */
export class ResourceBackfillSeriesController {
 plan:ResourceBackfillSeries|null=null;busy=false;blocked=false;message='';private active=true;private stored:string|null=null;
 constructor(private readonly ports:Ports){}
 restore(){this.active=true;try{const raw=this.ports.storage.getItem(this.ports.key);if(raw){const saved=JSON.parse(raw);if(!validResourceBackfillSeries(saved,this.ports.bookId,this.ports.characterId))throw new Error();this.plan=saved;this.message=this.pending()?'原章节请求待核对，剩余章节未继续。':saved.message;}this.stored=raw;}catch{this.blocked=true;this.message='原章节范围或完整凭证无法读取，请保留浏览器记录并核对运行维护。';}this.notify();}
 cancel(){this.active=false;}
 pending(){return this.plan?.stage==='pending_start'||this.plan?.stage==='pending_ai';}
 isLocked(){return Boolean(this.busy||this.blocked||this.pending()||this.plan?.stage==='ready');}
 private notify(){if(this.active)this.ports.changed();}
 private sync(){try{const raw=this.ports.storage.getItem(this.ports.key);if(raw===this.stored)return true;
  const latest=raw?JSON.parse(raw):null,frame=(part:ResourceBackfillSeriesPart)=>({chapter:part.chapter,kind:part.kind,aiRequestKey:part.aiRequestKey,startInput:part.startInput});
  if(!this.plan||!validResourceBackfillSeries(latest,this.ports.bookId,this.ports.characterId)||latest.id!==this.plan.id||!same(latest.input,this.plan.input)||!same(latest.parts.map(frame),this.plan.parts.map(frame)))throw new Error();
  this.plan=latest;this.stored=raw;this.message=latest.stage==='ready'?'另一页面已更新本次原范围，请核对结果后再明确继续。':'另一页面已更新本次原范围，请核对各章原结果。';this.notify();return false;
 }catch{this.blocked=true;this.message='其他页面的范围或原凭证与本页不同，本页停止后续操作；原结果保留。';this.notify();return false;}}
 private persist(plan:ResourceBackfillSeries){try{if(!validResourceBackfillSeries(plan,this.ports.bookId,this.ports.characterId))throw new Error('Invalid complete range');if(!this.sync())return false;const raw=JSON.stringify(plan);this.ports.storage.setItem(this.ports.key,raw);this.stored=raw;this.plan=plan;this.message=plan.message;this.notify();return true;}catch{this.blocked=true;this.message='完整范围或结果未能保留，后续章节已停止；原请求凭证保留。';this.notify();return false;}}
 private replace(part:ResourceBackfillSeriesPart,stage:ResourceBackfillSeries['stage'],message:string,next=this.plan!.next){const parts=[...this.plan!.parts];parts[this.plan!.next]=part;return this.persist({...this.plan!,parts,next,stage,message});}
 private async withLock(run:()=>Promise<void>){try{await this.ports.lock(run);}catch{if(this.active){this.blocked=true;this.message='浏览器未能锁定本次原范围，请保留凭证并核对其他页面；后续章节未继续。';this.notify();}}}
 async start(input:ResourceBackfillSeriesInput){await this.withLock(()=>this.startLocked(input));}
 private async startLocked(input:ResourceBackfillSeriesInput){
  if(!this.active||this.isLocked()||!this.sync())return;this.busy=true;this.notify();
  try{const frozen=resourceBackfillSeriesInputSchema.parse(structuredClone(input));if(frozen.resourceScope.characterId!==this.ports.characterId)throw new Error('人物范围与当前来源不同。');
   const parts=await this.ports.prepare(frozen);if(!this.active)return;
   const plan:ResourceBackfillSeries={format:1,id:this.ports.uuid(),bookId:this.ports.bookId,characterId:this.ports.characterId,input:frozen,parts,next:0,stage:'ready',message:'完整采用正文与资源范围已核对，逐章准备候选。'};
   if(!validResourceBackfillSeries(plan,this.ports.bookId,this.ports.characterId))throw new Error('章节预检与完整原范围不同，未发送请求。');
   if(this.plan)this.ports.storage.setItem(`${this.ports.key}:history:${this.plan.id}`,JSON.stringify(this.plan));
   if(this.persist(plan))await this.run();
  }catch(error){if(this.active){this.message=error instanceof Error?error.message:'章节来源未核对，未发送本次请求。';this.notify();}}
  finally{if(this.active){this.busy=false;this.notify();}}
 }
 private acceptStart(result:ResourceSupplementStartReceipt,part:ResourceBackfillSeriesPart){const parsed=resourceSupplementStartReceiptSchema.safeParse(result);
  if(!parsed.success||parsed.data.bookId!==this.ports.bookId||parsed.data.chapterDocumentId!==part.chapter.documentId||parsed.data.bodyVersionId!==part.chapter.bodyVersionId||!same(parsed.data.input,part.startInput)||parsed.data.sourceHash!==part.startInput?.expectedSourceHash)throw new Error('原独立清单结果与完整原输入不同，凭证保留。');
  return this.replace({...part,startReceipt:parsed.data},'ready','独立清单原结果已核对；候选生成仍按原范围进行。');
 }
 private acceptAi(result:ChapterSettlementAiReceipt,part:ResourceBackfillSeriesPart){
  if(!resourceBackfillAiReceiptSchema.safeParse(result).success||!Object.hasOwn(result,'failure')||result.sessionId!==part.ai?.sessionId||result.requestKey!==part.ai?.input.requestKey||result.sourceRoute!==`/new-design/books/${this.ports.bookId}/writing?chapterDocument=${part.chapter.documentId}&session=${part.ai.sessionId}`)throw new Error('原候选结果与完整原请求不同，凭证保留。');
  if(result.status==='running'||result.status==='succeeded'&&(!result.proposalsSaved||result.canImportSavedResult||result.ledgerPending))throw new Error('原候选或用量结果仍待核对，请回原章节处理；后续章节未继续。');
  const next=this.plan!.next+1,stage=result.status!=='succeeded'?'stopped':next===this.plan!.parts.length?'complete':'ready';
  return this.replace({...part,receipt:result},stage,stage==='complete'?'本次章节候选已准备，请回各章逐项人工核对。':stage==='stopped'?'本章原结果未成功，后续章节已停止，完整范围与原结果保留。':'本章候选与原结果已保留。',next);
 }
 private async run(){
  while(this.active&&!this.blocked&&this.plan?.stage==='ready'){
   let part=this.plan.parts[this.plan.next]!;
   if(part.kind==='stable'&&!part.startReceipt){
    if(!this.replace(part,'pending_start',`准备${part.chapter.title}的独立补充清单，原请求保留。`))return;
    try{const result=await this.ports.start(part.startInput!);if(!this.active||!this.acceptStart(result,part))return;part=this.plan!.parts[this.plan!.next]!;}
    catch(error){this.fail(error);return;}
   }
   try{const command=await this.ports.prepareAi(part,this.plan!.input);if(!this.active)return;
    if(part.ai&&!same(part.ai,command))throw new Error('原候选完整输入被替换，后续请求未发送。');
    part={...part,ai:command};if(!this.replace(part,'pending_ai',`整理${part.chapter.title}的正文资源候选，完整原请求保留。`))return;
    const result=await this.ports.ai(command);if(!this.active||!this.acceptAi(result,part))return;
   }catch(error){this.fail(error);return;}
  }
 }
 private fail(error:unknown){if(!this.active)return;
  if(!this.blocked&&(this.plan?.stage==='ready'||this.ports.notWritten(error)))this.persist({...this.plan!,stage:'stopped',message:`${error instanceof Error?error.message:'来源未核对'}；后续章节已停止，已保存结果保留。`});
  else{this.message=`${error instanceof Error?error.message:'原回复中断'}；只读核对原请求，未继续后续章节。`;this.notify();}
 }
 async verify(){await this.withLock(()=>this.verifyLocked());}
 private async verifyLocked(){if(!this.active||this.busy||this.blocked||!this.sync()||!this.pending())return;this.busy=true;this.notify();try{
  const part=this.plan!.parts[this.plan!.next]!;
  if(this.plan!.stage==='pending_start'){const result=await this.ports.readStart(part.startInput!);if(!this.active)return;if(!result)throw new Error('原清单回执未读取，不能证明未写入。');this.acceptStart(result,part);}
  else{const result=await this.ports.readAi(part.ai!);if(!this.active)return;if(!result)throw new Error('原候选回执未读取，不能证明未发送。');this.acceptAi(result,part);}
 }catch(error){if(this.active){this.message=error instanceof Error?error.message:'原请求尚未核对，凭证保留。';this.notify();}}finally{if(this.active){this.busy=false;this.notify();}}}
 async resume(){await this.withLock(()=>this.resumeLocked());}
 private async resumeLocked(){if(!this.active||this.busy||this.blocked||!this.sync()||this.plan?.stage!=='ready')return;this.busy=true;this.notify();try{await this.run();}finally{if(this.active){this.busy=false;this.notify();}}}
 async stop(){await this.withLock(async()=>{if(this.active&&!this.busy&&!this.blocked&&this.sync()&&this.plan?.stage==='ready')this.persist({...this.plan,stage:'stopped',message:'本次范围已明确结束，未发送剩余章节；原清单与候选保留。'});});}
}
