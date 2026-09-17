import type {ExperienceRequest,ExperienceRecord,ExperienceSeriesInput,ExperienceSeriesSources} from '../../../../common/characterExperiences';
import {experienceRequestSchema,validExperienceRecord} from '../../../../common/characterExperiences/schema';

export interface ExperienceSeries {
 format:1;id:string;bookId:string;characterId:string;parts:ExperienceRequest[];
 next:number;stage:'ready'|'pending'|'complete'|'stopped';records:ExperienceRecord[];message:string;
}
interface Ports {
 storage:Pick<Storage,'getItem'|'setItem'>;key:string;bookId:string;characterId:string;uuid:()=>string;
 prepare:(input:ExperienceSeriesInput)=>Promise<ExperienceSeriesSources>;
 write:(input:ExperienceRequest)=>Promise<ExperienceRecord>;
 read:(input:ExperienceRequest)=>Promise<ExperienceRecord|null>;
 endUnknown:(input:ExperienceRequest)=>Promise<ExperienceRecord>;
 notWritten:(error:unknown)=>boolean;
 changed:()=>void;result:(record:ExperienceRecord)=>void;
}
function canonical(value:unknown):unknown {return Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>[key,canonical(item)])):value;}
const same=(a:unknown,b:unknown)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
export function validSeries(value:unknown,bookId:string,characterId:string):value is ExperienceSeries {
 try{
  const plan=value as ExperienceSeries;
  if(!plan||plan.format!==1||plan.bookId!==bookId||plan.characterId!==characterId||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(plan.id)||!Array.isArray(plan.parts)||!plan.parts.length||plan.parts.length>15||!Number.isInteger(plan.next)||plan.next<0||plan.next>plan.parts.length||!['ready','pending','complete','stopped'].includes(plan.stage)||typeof plan.message!=='string'||!Array.isArray(plan.records)||plan.records.length!==plan.next)return false;
  if(plan.stage==='complete'?plan.next!==plan.parts.length:plan.stage!=='stopped'&&plan.next===plan.parts.length)return false;
  const actors=new Set<string>(),requests=new Set<string>();
  for(const [index,part]of plan.parts.entries()){if(!experienceRequestSchema.safeParse(part).success||requests.has(part.requestKey)||part.instruction!==plan.parts[0]!.instruction||index<plan.parts.length-1&&part.sources.length!==20)return false;requests.add(part.requestKey);for(const source of part.sources){if(!source.sourceHash||actors.has(source.characterId)||source.fieldKey!==plan.parts[0]!.sources[0]!.fieldKey)return false;actors.add(source.characterId);}}
  if(!actors.has(characterId)||actors.size>300)return false;
  for(const [index,record]of plan.records.entries()){if(!validExperienceRecord(record)||record.bookId!==bookId||!same(record.request,plan.parts[index])||record.status==='running'||index<plan.records.length-1&&record.status!=='review')return false;}
  if(plan.records.some(record=>record.status!=='review')&&plan.stage!=='stopped')return false;
  return true;
 }catch{return false;}
}

/** Persist the whole range and each send before contacting the server. Restoring
 * never calls a model; a pending send can only be recovered through its full read. */
export class ExperienceSeriesController {
 plan:ExperienceSeries|null=null;busy=false;blocked=false;message='';private active=true;
 constructor(private readonly ports:Ports){}
 restore(){this.active=true;try{const raw=this.ports.storage.getItem(this.ports.key);if(raw){const plan=JSON.parse(raw);if(!validSeries(plan,this.ports.bookId,this.ports.characterId))throw new Error();this.plan=plan;this.message=plan.stage==='pending'?'原分批请求待核对，剩余人物尚未继续。':plan.stage==='ready'?'原分批范围保留，请明确继续剩余人物。':plan.message;}}catch{this.blocked=true;this.message='原分批凭证无法完整读取，保留浏览器记录并核对运行维护。';}this.notify();}
 cancel(){this.active=false;}
 isLocked(){return this.blocked||this.busy||this.plan?.stage==='pending'||this.plan?.stage==='ready';}
 private notify(){if(this.active)this.ports.changed();}
 private persist(plan:ExperienceSeries){try{this.ports.storage.setItem(this.ports.key,JSON.stringify(plan));this.plan=plan;this.message=plan.message;this.notify();return true;}catch{this.blocked=true;this.message='分批凭证或原结果无法保存，已停止后续人物，原请求保留。';this.notify();return false;}}
 async start(input:ExperienceSeriesInput,instruction:string){
  if(!this.active||this.isLocked())return;this.busy=true;this.notify();
  try{
   const sources=await this.ports.prepare(input);if(!this.active)return;
   if(sources.bookId!==this.ports.bookId||sources.sources.length!==input.characterIds.length||sources.sources.some((source,index)=>source.characterId!==input.characterIds[index]||source.fieldKey!==input.fieldKey))throw new Error('分批来源与明确选择的人物范围不同。');
   const parts:ExperienceRequest[]=[];for(let i=0;i<sources.sources.length;i+=20)parts.push({requestKey:this.ports.uuid(),instruction:instruction.trim(),sources:sources.sources.slice(i,i+20)});
   const plan:ExperienceSeries={format:1,id:this.ports.uuid(),bookId:this.ports.bookId,characterId:this.ports.characterId,parts,next:0,stage:'ready',records:[],message:'人物来源已核对，按每批最多20人依次准备。'};
   if(!validSeries(plan,this.ports.bookId,this.ports.characterId))throw new Error('分批来源未完整冻结，请保留原选择。');
   if(this.plan)this.ports.storage.setItem(`${this.ports.key}:history:${this.plan.id}`,JSON.stringify(this.plan));
   if(this.persist(plan))await this.run();
  }catch(error){if(this.active){this.message=error instanceof Error?error.message:'分批来源尚未准备，未发送经历模型请求。';this.notify();}}
  finally{if(this.active){this.busy=false;this.notify();}}
 }
 private accept(record:ExperienceRecord,input:ExperienceRequest){
  if(!this.plan||!validExperienceRecord(record)||record.bookId!==this.ports.bookId||!same(record.request,input))throw new Error('原分批结果与完整人物、来源版本或要求不同。');
  if(record.status==='running')throw new Error(record.error||'原分批调用或结果保存待核对，未继续后续人物。');
  const next=this.plan.next+1,stage=record.status!=='review'?'stopped':next===this.plan.parts.length?'complete':'ready';
  if(!this.persist({...this.plan,next,stage,records:[...this.plan.records,record],message:stage==='complete'?'本次人物分批准备已完成，请逐项检查候选。':stage==='stopped'?'原批次未生成可检查结果，已停止后续人物；原结果保留。':'原批次结果已保留，继续下一批人物。'}))return false;
  this.ports.result(record);return true;
 }
 private async run(){
  while(this.active&&!this.blocked&&this.plan?.stage==='ready'){
   const input=this.plan.parts[this.plan.next]!;
   if(!this.persist({...this.plan,stage:'pending',message:`准备第${this.plan.next+1}／${this.plan.parts.length}批，原请求保留。`}))return;
   try{const record=await this.ports.write(input);if(!this.active)return;if(!this.accept(record,input))return;}
   catch(error){if(!this.active)return;if(this.ports.notWritten(error)&&!this.blocked)this.persist({...this.plan!,stage:'stopped',message:'本批尚未写入，已停止后续人物；原范围与已保存结果保留。'});else{this.message=`${error instanceof Error?error.message:'原回复中断'}；只读核对原批次，未继续后续人物。`;this.notify();}return;}
  }
 }
 async resume(){
  if(!this.active||this.busy||this.blocked||!this.plan||!['ready','pending'].includes(this.plan.stage))return;this.busy=true;this.notify();
  try{if(this.plan.stage==='pending'){const input=this.plan.parts[this.plan.next]!,record=await this.ports.read(input);if(!this.active)return;if(!record)throw new Error('原分批回执未读取，不能证明未发送。');if(!this.accept(record,input))return;}await this.run();}
  catch(error){if(this.active){this.message=error instanceof Error?error.message:'原批次尚未核对，原凭证保留。';this.notify();}}
  finally{if(this.active){this.busy=false;this.notify();}}
 }
 async endUnknown(){
  if(!this.active||this.busy||this.blocked||this.plan?.stage!=='pending')return;this.busy=true;this.notify();
  try{const input=this.plan.parts[this.plan.next]!,record=await this.ports.endUnknown(input);if(this.active)this.accept(record,input);}
  catch(error){if(this.active){this.message=error instanceof Error?error.message:'未知占用未结束，原分批凭证保留。';this.notify();}}
  finally{if(this.active){this.busy=false;this.notify();}}
 }
 stop(){if(this.active&&!this.busy&&!this.blocked&&this.plan?.stage==='ready')this.persist({...this.plan,stage:'stopped',message:'本次分批已明确结束，未发送剩余人物，原范围与已保存结果保留。'});}
}
