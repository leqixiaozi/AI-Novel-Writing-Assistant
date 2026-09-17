import {useEffect,useRef,useState} from "react";
import type {ScopedFieldDefinition} from "../../../common/contracts";
import {newDesignApi,ApiError} from "../../api";
export type FieldCommand=
  |{operation:"book";input:Parameters<typeof newDesignApi.createBookFieldExtension>[1]}
  |{operation:"card";cardId:string;input:Parameters<typeof newDesignApi.createCardLocalField>[2]}
  |{operation:"revise";fieldId:string;input:Parameters<typeof newDesignApi.reviseCardLocalField>[2]}
  |{operation:"mount";mountId:string;input:Parameters<typeof newDesignApi.addAssociationLocalField>[2]};
type Pending={format:1;target:string;command:FieldCommand;raw:Record<string,unknown>};
export function useFieldWriteRecovery(bookId:string,cardTypeId:string,context:Record<string,string|null>,restore:(raw:Record<string,unknown>)=>void,refresh:()=>Promise<void>){
  const target=JSON.stringify({bookId,cardTypeId,...context}),storage=`nd-field-write:${target}`;
  const [pending,setPending]=useState<Pending|null>(null),[blocked,setBlocked]=useState(false),[working,setWorking]=useState(false),[message,setMessage]=useState(""),[issues,setIssues]=useState<Record<string,string>>({});
  const current=useRef<Pending|null>(null),running=useRef(false),storageBlocked=useRef(false);
  useEffect(()=>{try{const raw=localStorage.getItem(storage);if(!raw)return;const value=JSON.parse(raw) as Pending;if(value.format!==1||value.target!==target||!value.raw||!['book','card','revise','mount'].includes(value.command?.operation)||typeof value.command.input?.idempotencyKey!=="string"||!value.command.input.field)throw new Error();current.current=value;setPending(value);restore(value.raw);setMessage("原保存结果尚未确认，已恢复原填写与请求凭证。请先核对原请求。");}catch{storageBlocked.current=true;setBlocked(true);setMessage("原请求凭证无法读取，请保留浏览器记录并打开运行维护核对，不重新提交。");}},[storage]);
  function matches(result:ScopedFieldDefinition,command:FieldCommand){return result.cardTypeId===cardTypeId&&(command.operation==='book'?result.scope==='book_type':command.operation==='card'?result.scope==='card'&&result.cardId===command.cardId:command.operation==='revise'?result.id===command.fieldId:false);}
  async function finish(value:Pending,result?:ScopedFieldDefinition){if(value.command.operation!=='mount'&&(!result||!matches(result,value.command)))throw new Error("原保存返回值与填写范围不一致，保留原凭证核对。");await refresh();localStorage.removeItem(storage);current.current=null;setPending(null);setMessage("原保存结果已确认。");return true;}
  async function perform(command:FieldCommand,raw:Record<string,unknown>){if(current.current||running.current||storageBlocked.current)return false;
    const value:Pending={format:1,target,command:structuredClone(command),raw:structuredClone(raw)};
    try{localStorage.setItem(storage,JSON.stringify(value));}catch{storageBlocked.current=true;setBlocked(true);setMessage("发送前无法保留原填写与凭证，尚未提交，请恢复浏览器存储。");return false;}
    current.current=value;setPending(value);running.current=true;setWorking(true);setMessage("");setIssues({});
    let confirmed=false;
    try{let result:ScopedFieldDefinition|undefined;switch(command.operation){case 'book':result=await newDesignApi.createBookFieldExtension(bookId,command.input);break;case 'card':result=await newDesignApi.createCardLocalField(bookId,command.cardId,command.input);break;case 'revise':result=await newDesignApi.reviseCardLocalField(bookId,command.fieldId,command.input);break;case 'mount':await newDesignApi.addAssociationLocalField(bookId,command.mountId,command.input);break;}
      confirmed=true;
      return await finish(value,result);
    }catch(error){if(error instanceof ApiError)setIssues(error.issues);if(!confirmed&&error instanceof ApiError&&error.recovery?.mutationOutcome==='not_written'){try{localStorage.removeItem(storage);current.current=null;setPending(null);setMessage(`${error.message}。本次未写入，请核对后重新预览。`);}catch{storageBlocked.current=true;setBlocked(true);setMessage("本次未写入，但原凭证清理失败，请恢复浏览器存储后核对。");}}else setMessage(`${error instanceof Error?error.message:'响应中断'}。原保存结果待核对，填写与原凭证保留，禁止重复新增。`);return false;}
    finally{running.current=false;setWorking(false);}
  }
  async function verify(){const value=current.current;if(!value||running.current)return false;if(value.command.operation==='mount'){setMessage("关联补充信息结果待核对，请保留原凭证并打开运行维护，不重新添加。");return false;}
    running.current=true;setWorking(true);try{const receipt=await newDesignApi.verifyFieldWriteReceipt(bookId,value.command);if(!receipt){setMessage("尚未读取原回执，不能证明未保存；保留原请求继续核对。");return false;}const operations={book:'book_field_create',card:'card_field_create',revise:'card_field_revise'};
      if(receipt.bookId!==bookId||receipt.requestKey!==value.command.input.idempotencyKey||receipt.operation!==operations[value.command.operation])throw new Error("回执与原请求范围不一致。");return await finish(value,receipt.result);
    }catch(error){setMessage(`核对原保存结果：${error instanceof Error?error.message:'读取失败'}。原凭证保留。`);return false;}finally{running.current=false;setWorking(false);}}
  return{locked:!!pending||blocked||working,isLocked:()=>!!current.current||running.current||storageBlocked.current,pending,working,message,issues,perform,verify};
}
