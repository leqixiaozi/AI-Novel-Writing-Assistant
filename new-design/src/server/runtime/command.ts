import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { NewDesignError } from "../domain/errors";

export async function runControlledCommand(executable:string,args:string[],options:{packageBin:string;passfile?:string;timeoutMs?:number;allowFailure?:boolean}):Promise<{code:number;stdout:string;stderr:string}>{
  const stat=await fs.lstat(executable).catch(()=>null);if(!stat?.isFile()||stat.isSymbolicLink())throw new NewDesignError(`受控程序不可用：${path.basename(executable)}`,503);
  if(args.some(value=>value.includes("\0")))throw new NewDesignError("受控程序参数包含非法字符。",422);
  const env:NodeJS.ProcessEnv={SystemRoot:process.env.SystemRoot,WINDIR:process.env.WINDIR,TEMP:process.env.TEMP,TMP:process.env.TMP,PATH:options.packageBin,LC_MESSAGES:"C",PGCONNECT_TIMEOUT:"5"};if(options.passfile)env.PGPASSFILE=options.passfile;
  return new Promise((resolve,reject)=>{
    const child=spawn(executable,args,{windowsHide:true,shell:false,env,stdio:["ignore","pipe","pipe"]});let stdout="",stderr="",settled=false,timedOut=false;
    const timer=setTimeout(()=>{if(!settled){timedOut=true;child.kill();}},Math.min(120000,Math.max(1000,options.timeoutMs??30000)));
    child.stdout?.on("data",chunk=>{stdout=bounded(stdout+chunk.toString("utf8"));});child.stderr?.on("data",chunk=>{stderr=bounded(stderr+chunk.toString("utf8"));});
    child.once("error",error=>{settled=true;clearTimeout(timer);reject(error);});
    child.once("exit",code=>{settled=true;clearTimeout(timer);const result={code:code??-1,stdout:scrub(stdout),stderr:scrub(stderr)};if(timedOut&&!options.allowFailure)reject(new NewDesignError(`${path.basename(executable)} 执行超时，已终止该受控工具进程。`,503));else if(result.code!==0&&!options.allowFailure)reject(new NewDesignError(`${path.basename(executable)} 执行失败（${result.code}）：${result.stderr||result.stdout||"没有可公开诊断"}`,503));else resolve(result);});
  });
}

export async function tightenWindowsAcl(target:string,directory:boolean):Promise<void>{
  if(process.platform!=="win32")throw new NewDesignError("Windows ACL 只允许在 Windows 运行包中设置。",503);
  const systemRoot=path.resolve(process.env.SystemRoot||"C:\\Windows"),icacls=path.join(systemRoot,"System32","icacls.exe"),identity=process.env.USERNAME?.trim();if(!identity||!/^[^\r\n:]+$/.test(identity))throw new NewDesignError("无法确定当前 Windows 用户，不能安全设置凭据 ACL。",503);
  const grant=directory?`${identity}:(OI)(CI)F`:`${identity}:F`;await runControlledCommand(icacls,[target,"/inheritance:r","/grant:r",grant],{packageBin:path.dirname(icacls),timeoutMs:15000});
}

export async function verifyWindowsAcl(target:string):Promise<void>{
  if(process.platform!=="win32")throw new NewDesignError("Windows ACL 诊断只支持 Windows 运行包。",503);
  const systemRoot=path.resolve(process.env.SystemRoot||"C:\\Windows"),icacls=path.join(systemRoot,"System32","icacls.exe");
  const result=await runControlledCommand(icacls,[target,"/verify"],{packageBin:path.dirname(icacls),timeoutMs:15000,allowFailure:true});
  if(result.code!==0)throw new NewDesignError("凭据目录或文件 ACL 不是可验证的规范 ACL。",503);
}

export function scrub(value:string):string{return value.replace(/(password|token|secret|authorization|cookie|database[_-]?url|pgpassword)\s*[:=]\s*\S+/gi,"$1=[redacted]").replace(/\bBearer\s+\S+/gi,"Bearer [redacted]").replace(/postgres(?:ql)?:\/\/[^\s@]+@/gi,"postgresql://[redacted]@").replace(/\b(role|user|database)\s+["'](?:ndu|ndb)_[a-f0-9]+["']/gi,"$1 [redacted]").replace(/\b(?:ndu|ndb)_[a-f0-9]{16}\b/gi,"[redacted-db-identity]").replace(/[A-Za-z]:\\[^\r\n]*/g,"[private-path]").slice(0,8000).trim();}
function bounded(value:string):string{return value.length>16000?value.slice(value.length-16000):value;}
