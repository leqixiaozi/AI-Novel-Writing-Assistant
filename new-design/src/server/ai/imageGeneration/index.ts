import {createHash} from "node:crypto";
import {imageReplySchema,type ImageConnectionVersion,type ImageGenerationInput,type ImageGenerationReply} from "../../../common/imageGeneration";
import {validateVisualBytes} from "../../database/visualAssets/files";
import {NewDesignError} from "../../domain/errors";
import {prepareImageContract} from "./contract";
/** One explicit protocol request; no URL downloads, alternate models or automatic retries. */
export async function executeImageProtocol(input:ImageGenerationInput,connection:ImageConnectionVersion,credential:string|null):Promise<ImageGenerationReply>{
 const start=Date.now(),controller=new AbortController(),timer=setTimeout(()=>controller.abort(),connection.timeoutMs);
 try{
  const endpoint=new URL(connection.endpoint);endpoint.pathname=`${endpoint.pathname.replace(/\/$/,"")}/images/generations`;
  const response=await fetch(endpoint,{method:"POST",redirect:"error",signal:controller.signal,headers:{"Content-Type":"application/json",...(credential?{Authorization:`Bearer ${credential}`}:{})},body:JSON.stringify({model:connection.model,prompt:prepareImageContract(input).prompt,n:1,size:input.size,response_format:"b64_json"})});
  if(!response.ok)throw new NewDesignError(response.status===401||response.status===403?"图片服务未接受凭据；本次请求结果未确认，请核对原请求和专属连接。":"图片服务未返回可读取的单图回复；原请求保留，不自动重试或切换模型。",503);
  if(!response.body)throw new NewDesignError("图片服务回复为空，不能判定模型未执行。",503);
  const reader=response.body.getReader(),parts:Uint8Array[]=[];let bytes=0;
  try{while(true){const item=await reader.read();if(item.done)break;bytes+=item.value.byteLength;if(bytes>15*1024*1024){await reader.cancel();throw new NewDesignError("图片回复超过受控容量；原调用状态保留，不重复生成。",422);}parts.push(item.value);}}finally{reader.releaseLock();}
  const raw:unknown=JSON.parse(Buffer.concat(parts).toString("utf8"));
  if(!raw||typeof raw!=="object"||!("data" in raw)||!Array.isArray(raw.data)||raw.data.length!==1)throw new NewDesignError("图片服务必须返回一张受控图片，未采用多图或未知格式回复。",422);
  const item:unknown=raw.data[0];if(!item||typeof item!=="object"||!("b64_json" in item)||typeof item.b64_json!=="string"||"url" in item)throw new NewDesignError("图片服务没有返回受控图片内容；禁止从远程链接下载或借用其他图片。",422);
  const base64=item.b64_json;if(base64.length>13981016||!base64.length||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64))throw new NewDesignError("图片回复编码不符合受控规格。",422);
  const binary=Buffer.from(base64,"base64");if(binary.toString("base64")!==base64)throw new NewDesignError("图片回复编码未通过原内容核对。",422);
  const mimeType=binary.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))?"image/png":binary[0]===255&&binary[1]===216?"image/jpeg":binary.subarray(0,4).toString()==="RIFF"&&binary.subarray(8,12).toString()==="WEBP"?"image/webp":null;
  if(!mimeType)throw new NewDesignError("图片回复不是支持的 PNG、JPEG 或 WebP 内容。",422);validateVisualBytes(binary,mimeType);
  const usage="usage" in raw&&raw.usage&&typeof raw.usage==="object"?raw.usage:null;
  const token=(key:string)=>{if(!usage||!(key in usage))return null;const value=Reflect.get(usage,key);return typeof value==='number'&&Number.isSafeInteger(value)&&value>=0?value:null;};
  return imageReplySchema.parse({base64,mimeType,checksum:createHash("sha256").update(binary).digest("hex"),byteSize:binary.length,inputTokens:token("input_tokens"),outputTokens:token("output_tokens"),durationMs:Date.now()-start});
 }finally{clearTimeout(timer);}
}
