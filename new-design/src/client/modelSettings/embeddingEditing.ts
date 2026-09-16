import type {ManagedEmbeddingConnectionVersion,ManagedEmbeddingSaveResult,SaveManagedEmbeddingConnectionInput} from "../../common/modelRouting";
export type EmbeddingDraft=Omit<SaveManagedEmbeddingConnectionInput,"idempotencyKey"|"expectedConfigId"|"expectedRevision">;
export interface EmbeddingPending {input:SaveManagedEmbeddingConnectionInput;notWritten:boolean;checked:boolean;}
export const blankEmbeddingDraft=():EmbeddingDraft=>({provider:"ollama",endpoint:"",model:"",credentialId:null,timeoutMs:120000,maxRetries:0,retryDelayMs:1000});
export const copyEmbeddingConnection=(value:ManagedEmbeddingConnectionVersion):EmbeddingDraft=>({provider:value.provider,endpoint:value.endpoint,model:value.model,credentialId:value.credentialId,timeoutMs:value.timeoutMs,maxRetries:value.maxRetries,retryDelayMs:value.retryDelayMs});
/** Exactly the trim semantics of the original connectionSchema; no URL rewriting. */
export function normalizedEmbeddingInput(value:SaveManagedEmbeddingConnectionInput):SaveManagedEmbeddingConnectionInput {return {...value,endpoint:value.endpoint.trim(),model:value.model.trim()};}
export async function matchesEmbeddingSave(result:ManagedEmbeddingSaveResult,original:SaveManagedEmbeddingConnectionInput):Promise<boolean> {
 const input=normalizedEmbeddingInput(original),connection=result.connection;
 // Original configs start at revision 1; first publication increments it to 2.
 if(result.savedVersionId!==connection.connectionVersionId||connection.id!==result.savedVersionId||result.savedVersion!==connection.version||result.configRevision!==(input.expectedRevision??1)+1||input.expectedConfigId!==null&&connection.configId!==input.expectedConfigId||connection.provider!==input.provider||connection.endpoint!==input.endpoint||connection.model!==input.model||connection.credentialId!==input.credentialId||connection.timeoutMs!==input.timeoutMs||connection.maxRetries!==input.maxRetries||connection.retryDelayMs!==input.retryDelayMs)return false;
 // This original contract contains only flat primitive fields. Sorted JSON matches
 // database/aiContracts.stableHash, including the original key and revision.
 const canonical=JSON.stringify(Object.fromEntries(Object.entries(input).sort(([a],[b])=>a.localeCompare(b)))),digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(canonical));
 return connection.connectionHash===Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,"0")).join("");
}
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const draftKeys=["provider","endpoint","model","credentialId","timeoutMs","maxRetries","retryDelayMs"];
function record(value:unknown):value is Record<string,unknown> {return Boolean(value)&&typeof value==="object"&&!Array.isArray(value);}
function identifier(value:unknown):value is string {return typeof value==="string"&&uuid.test(value);}
function integer(value:unknown,min:number,max=Number.MAX_SAFE_INTEGER):value is number {return typeof value==="number"&&Number.isSafeInteger(value)&&value>=min&&value<=max;}
function draft(value:unknown):value is EmbeddingDraft {
 if(!record(value)||(value.provider!=="ollama"&&value.provider!=="openai-compatible")||typeof value.endpoint!=="string"||value.endpoint.trim().length>1000||typeof value.model!=="string"||value.model.trim().length>300||value.credentialId!==null&&!identifier(value.credentialId)||!integer(value.timeoutMs,1000,600000)||!integer(value.maxRetries,0,3)||!integer(value.retryDelayMs,0,10000))return false;
 if(value.endpoint){try{const url=new URL(value.endpoint);if(!["http:","https:"].includes(url.protocol)||url.username||url.password||url.search||url.hash||url.protocol==="http:"&&!["localhost","127.0.0.1","[::1]"].includes(url.hostname))return false;}catch{return false;}}
 return true;
}
/** Validate the complete frozen write, not only its editable draft subset. */
function savedInput(value:unknown):value is SaveManagedEmbeddingConnectionInput {
 if(!record(value)||!identifier(value.idempotencyKey))return false;
 if(value.expectedConfigId===null){if(value.expectedRevision!==null)return false;}
 else if(!identifier(value.expectedConfigId)||!integer(value.expectedRevision,1))return false;
 if(Object.keys(value).some(key=>![...draftKeys,"expectedConfigId","expectedRevision","idempotencyKey"].includes(key)))return false;
 return draft(value);
}
function savedBase(value:unknown):value is {id:string;revision:number}|null {return value===null||record(value)&&identifier(value.id)&&integer(value.revision,1);}
export function parseEmbeddingEditor(raw:string|null):{draft:EmbeddingDraft;base:{id:string;revision:number}|null;pending:EmbeddingPending|null}|null {
 try{
  if(!raw||raw.length>30000)return null;
  const value:unknown=JSON.parse(raw);
  if(!record(value)||value.version!==1||!draft(value.draft)||Object.keys(value.draft).some(key=>!draftKeys.includes(key))||!savedBase(value.base))return null;
  let pending:EmbeddingPending|null=null;
  if(value.pending!==null){
   if(!record(value.pending)||!savedInput(value.pending.input))return null;
   // Stored flags are not proof of server rollback or of a completed read.
   pending={input:value.pending.input,notWritten:false,checked:false};
  }
  return {draft:value.draft,base:value.base,pending};
 }catch{return null;}
}
export function embeddingDifferences(server:ManagedEmbeddingConnectionVersion|null,value:EmbeddingDraft):string[]{if(!server)return ["尚无专属连接版本"];return ([['provider','模型服务'],['endpoint','连接地址'],['model','向量模型'],['credentialId','凭据引用'],['timeoutMs','单次等待'],['maxRetries','技术重试次数'],['retryDelayMs','重试间隔']] as const).filter(([key])=>server[key]!==value[key]).map(([,label])=>label);}
