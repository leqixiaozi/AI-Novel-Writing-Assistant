import type {ResourceFocusRequest,ResourceFocusRecord} from '../../../common/characterResources/focus';
import {resourceFocusRequestSchema,validResourceFocusRecord,sameResourceFocusValue} from '../../../common/characterResources/focus';
export class ResourceFocusRecoveryError extends Error {}
/** Own only focus commands: a stale page must never clear another complete original. */
export class ResourceFocusRecovery {
 constructor(private readonly bookId:string,private readonly characterId:string,private readonly key:string,private readonly storage:Pick<Storage,'getItem'|'setItem'>,private readonly lock:(run:()=>Promise<void>)=>Promise<void>){}
 async exclusive(input:ResourceFocusRequest,write:boolean,run:()=>Promise<void>){
  const parsed=resourceFocusRequestSchema.parse(input);if(parsed.characterId!==this.characterId)throw new Error('人物范围与原显示建议不同。');
  await this.lock(async()=>{
   const raw=this.storage.getItem(this.key);
   if(raw){let saved;try{saved=JSON.parse(raw);}catch{throw new ResourceFocusRecoveryError('完整原请求凭证无法读取，请保留记录核对。');}if(saved.format!==1||saved.storage!==this.key||!resourceFocusRequestSchema.safeParse(saved.input).success||!sameResourceFocusValue(saved.input,parsed)||write)throw new ResourceFocusRecoveryError('另一页面有完整原请求待核对，本页未改写凭证或发送其他请求。');}
   await run();
  });
 }
 private read(raw:string|null){
  if(!raw)return null;const saved=JSON.parse(raw);
  if(saved.format!==1||saved.bookId!==this.bookId||saved.characterId!==this.characterId||typeof saved.applied!=='boolean'||!validResourceFocusRecord(saved.record,this.bookId,this.characterId))throw new Error('完整原显示结果或选择无法读取，请保留凭证核对。');
  return saved as {format:1;bookId:string;characterId:string;record:ResourceFocusRecord;applied:boolean};
 }
 save(record:ResourceFocusRecord,apply:boolean,preserveChoice=false,explicit=false):boolean {
  if(!validResourceFocusRecord(record,this.bookId,this.characterId))throw new Error('原显示建议与本书人物不同。');
  const latest=this.read(this.storage.getItem(`${this.key}:result`)),historyKey=`${this.key}:history:${record.id}`,prior=this.read(this.storage.getItem(historyKey));
  const applied=preserveChoice&&sameResourceFocusValue((prior??latest)?.record,record)?(prior??latest)!.applied:apply;
  const saved={format:1,bookId:this.bookId,characterId:this.characterId,record,applied},raw=JSON.stringify(saved);
  this.storage.setItem(historyKey,raw);
  if(!explicit&&latest&&latest.record.id!==record.id&&Date.parse(latest.record.createdAt)>=Date.parse(record.createdAt))return false;
  this.storage.setItem(`${this.key}:result`,raw);return applied;
 }
}
