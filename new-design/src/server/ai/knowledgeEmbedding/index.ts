import {z} from "zod";
import type {KnowledgeEmbeddingReply} from "../../../common/knowledgeIndex";
export interface EmbeddingConnection {provider:"ollama"|"openai-compatible";endpoint:string;model:string;timeoutMs:number;apiKey:string}
export class KnowledgeEmbeddingTransportError extends Error {constructor(message:string,public readonly requestSent:boolean,public readonly responseReceived:boolean,public readonly inputTokens:number|null=null){super(message);}}
async function boundedReply(response:Response):Promise<unknown>{const limit=256*1024,length=response.headers.get("content-length");if(length&&Number(length)>limit||!response.body)throw new KnowledgeEmbeddingTransportError("嵌入回复体积超限或为空，不能作为原向量录入。",true,true);const reader=response.body.getReader(),parts:Uint8Array[]=[];let total=0;try{for(;;){const piece=await reader.read();if(piece.done)break;total+=piece.value.byteLength;if(total>limit)throw new KnowledgeEmbeddingTransportError("嵌入回复超过受控体积上限，未进入索引。",true,true);parts.push(piece.value);}const bytes=new Uint8Array(total);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.byteLength;}return JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(bytes));}finally{await reader.cancel().catch(()=>undefined);reader.releaseLock();}}
export function validateKnowledgeEmbeddingVector(value:unknown,dimensions:number,normalize:boolean):number[]{
 if(!Number.isInteger(dimensions)||dimensions<1||dimensions>2000)throw new KnowledgeEmbeddingTransportError("嵌入规格维度无效，尚未发送请求。",false,false);
 const vector=z.array(z.number().finite()).length(dimensions).parse(value),length=Math.hypot(...vector);
 if(!Number.isFinite(length)||length===0)throw new KnowledgeEmbeddingTransportError("模型返回零向量或不可用向量，不能建立语义索引。",true,true);
 const result=normalize?vector.map(number=>number/length):vector;
 if(result.some(number=>!Number.isFinite(Math.fround(number))))throw new KnowledgeEmbeddingTransportError("模型向量超出索引数值范围，原回复保留，不写入索引。",true,true);
 const indexed=result.map(Math.fround);if(Math.hypot(...indexed)===0)throw new KnowledgeEmbeddingTransportError("模型向量转换为索引数值后为零，不能进入语义索引。",true,true);return indexed;
}
export async function invokeKnowledgeEmbedding(connection:EmbeddingConnection,input:string,dimensions:number,normalize:boolean,fetcher:typeof fetch=fetch):Promise<KnowledgeEmbeddingReply>{
 if(!input||input.length>50000||!Number.isInteger(connection.timeoutMs)||connection.timeoutMs<1000||connection.timeoutMs>600000)throw new KnowledgeEmbeddingTransportError("嵌入输入或等待预算超限，尚未发送请求。",false,false);
 let endpoint:URL;try{endpoint=new URL(connection.endpoint);}catch{throw new KnowledgeEmbeddingTransportError("嵌入连接地址无效，尚未发送请求。",false,false);}
 if(!["http:","https:"].includes(endpoint.protocol)||endpoint.username||endpoint.password||endpoint.search||endpoint.hash||endpoint.protocol==="http:"&&!["localhost","127.0.0.1","[::1]"].includes(endpoint.hostname))throw new KnowledgeEmbeddingTransportError("嵌入连接必须使用受控本地地址或无凭据的 HTTPS 地址。",false,false);
 const suffix=connection.provider==="ollama"?"/api/embed":"/embeddings",body=connection.provider==="ollama"?{model:connection.model,input,truncate:false}:{model:connection.model,input,encoding_format:"float"};
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),connection.timeoutMs);let sent=false,received=false,inputTokens:number|null=null;
 try{sent=true;const response=await fetcher(`${endpoint.href.replace(/\/$/,"")}${suffix}`,{method:"POST",redirect:"error",signal:controller.signal,headers:{"Content-Type":"application/json",...(connection.apiKey?{Authorization:`Bearer ${connection.apiKey}`}:{})},body:JSON.stringify(body)});received=true;
  if(!response.ok)throw new KnowledgeEmbeddingTransportError(response.status===401||response.status===403?"嵌入模型拒绝授权，请检查原模型连接凭据。":response.status===429?"嵌入服务额度或频率受限，原请求保留。":"嵌入服务拒绝请求，请检查模型是否支持嵌入及输入长度。",sent,received);
  const raw=await boundedReply(response),usage=z.object({prompt_eval_count:z.number().int().nonnegative().optional(),usage:z.object({prompt_tokens:z.number().int().nonnegative().optional()}).passthrough().optional()}).passthrough().safeParse(raw);if(usage.success)inputTokens=connection.provider==="ollama"?usage.data.prompt_eval_count??null:usage.data.usage?.prompt_tokens??null;
  const data=z.object({model:z.string(),embeddings:z.array(z.unknown()).optional(),data:z.array(z.object({index:z.number().int(),embedding:z.unknown()})).optional()}).passthrough().parse(raw);
  if(data.model!==connection.model)throw new KnowledgeEmbeddingTransportError("嵌入回复模型与明确选择的模型不一致。",sent,received);
  const values=connection.provider==="ollama"?data.embeddings:data.data?.filter(item=>item.index===0).map(item=>item.embedding);
  if(values?.length!==1||connection.provider==="openai-compatible"&&data.data?.length!==1)throw new KnowledgeEmbeddingTransportError("嵌入回复数量与原输入不一致。",sent,received,inputTokens);
  return{provider:connection.provider,model:connection.model,vector:validateKnowledgeEmbeddingVector(values[0],dimensions,normalize),inputTokens,responseReceived:true};
 }catch(error){if(error instanceof KnowledgeEmbeddingTransportError)throw new KnowledgeEmbeddingTransportError(error.message,error.requestSent,error.responseReceived,error.inputTokens??inputTokens);throw new KnowledgeEmbeddingTransportError(received?"嵌入回复不符合冻结维度和数值规格，未进入索引。":controller.signal.aborted?"等待嵌入回复超时，原请求可能仍在处理；仅核对原请求，不再次调用。":"无法取得嵌入回执；原调用情况未知，仅核对原请求。",sent,received,inputTokens);}finally{clearTimeout(timer);}
}
