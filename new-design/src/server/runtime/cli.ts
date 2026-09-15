#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { getDatabaseRuntimeStatus, getPrivateRuntimeDiagnostics, stopNewDesignDatabase } from "../database/runtime";
import { NewDesignError } from "../domain/errors";
import { requestTransferExport } from "../transfers";
import { scrub } from "./command";
import { getPrivateRuntimeManager } from "./manager";
import { inspectRuntimeUpgradeCandidate, requireRuntimeUpgradeExecutor } from "./maintenance";

type Command="start"|"stop"|"status"|"doctor"|"backup"|"upgrade";
interface Options {command:Command;json:boolean;plain:boolean;quiet:boolean;plan:boolean;confirm?:string;}

export async function runRuntimeCli(argv:string[]):Promise<number>{
  let options:Options;try{options=parse(argv);}catch(error){writeError(error);return 2;}
  if(options.command==="upgrade"&&options.plan){const result=await inspectRuntimeUpgradeCandidate();write(options,result);return result.targetRuntimeId?0:3;}
  try{
    let result:unknown;
    switch(options.command){
      case"start":result=await getDatabaseRuntimeStatus();break;
      case"stop":await stopNewDesignDatabase();result={phase:"stopped",detail:"后台领取已排空后执行受控 PostgreSQL fast stop。"};break;
      case"status":result=await getPrivateRuntimeManager().status();break;
      case"doctor":result=await getPrivateRuntimeDiagnostics();break;
      case"backup":result=await requestTransferExport({operationKind:"full_backup",profileKey:"full_system",requestedBy:"local.runtime-cli",idempotencyKey:`runtime-backup-${randomUUID()}`});break;
      case"upgrade":{const readiness=await inspectRuntimeUpgradeCandidate();await requireRuntimeUpgradeExecutor(readiness,options.confirm,undefined);result=readiness;break;}
    }
    write(options,result);return 0;
  }catch(error){writeError(error,options.json);return exitCode(error);}
}

function parse(argv:string[]):Options{
  if(argv.includes("--help")||argv.includes("-h")){process.stdout.write(help());process.exit(0);}
  if(argv.includes("--version")){process.stdout.write("new-design-runtime 0.1.0\n");process.exit(0);}
  const command=argv[0] as Command;if(!["start","stop","status","doctor","backup","upgrade"].includes(command))throw new Error("首个参数必须是 start、stop、status、doctor、backup 或 upgrade。");
  const options:Options={command,json:false,plain:false,quiet:false,plan:false};
  for(let index=1;index<argv.length;index+=1){const arg=argv[index];if(arg==="--json")options.json=true;else if(arg==="--plain")options.plain=true;else if(arg==="--quiet")options.quiet=true;else if(arg==="--plan"&&command==="upgrade")options.plan=true;else if(arg==="--confirm"&&command==="upgrade"){const value=argv[++index];if(!value||!/^[a-f0-9]{64}$/.test(value))throw new Error("--confirm 必须是 upgrade --plan 返回的 64 位摘要。");options.confirm=value;}else throw new Error(`不支持的参数：${arg}`);}
  if(Number(options.json)+Number(options.plain)+Number(options.quiet)>1)throw new Error("--json、--plain、--quiet 只能选择一个。");
  if(command!=="upgrade"&&(options.plan||options.confirm))throw new Error("--plan/--confirm 只允许用于 upgrade。");
  return options;
}

function write(options:Options,value:unknown):void{if(options.quiet)return;if(options.json){process.stdout.write(`${JSON.stringify({ok:true,data:value})}\n`);return;}if(options.plain){process.stdout.write(`${plain(value)}\n`);return;}process.stdout.write(`${JSON.stringify(value,null,2)}\n`);}
function writeError(error:unknown,json=false):void{const message=scrub(error instanceof Error?error.message:String(error));process.stderr.write(json?`${JSON.stringify({ok:false,error:message})}\n`:`新设计运行时：${message}\n`);}
function exitCode(error:unknown):number{if(error instanceof NewDesignError){if(error.status===403)return 4;if(error.status===409)return 5;if(error.status===422)return 2;if(error.status===503)return 3;}return 6;}
function plain(value:unknown):string{if(!value||typeof value!=="object")return String(value);return Object.entries(value as Record<string,unknown>).filter(([,item])=>typeof item!=="object").map(([key,item])=>`${key}=${String(item)}`).join("\n");}
function help():string{return`用法：node cli.js <command> [--json|--plain|--quiet]\n命令：start stop status doctor backup upgrade\nupgrade 仅支持 --plan 或 --confirm <digest>；候选包固定为 runtime-package.next，不接受路径、端口、SQL 或命令参数。\n退出码：0 成功；2 用法错误；3 运行包/执行器不可用；4 本机确认失败；5 状态冲突；6 未分类运行失败。\n`;}

if(require.main===module){void runRuntimeCli(process.argv.slice(2)).then(code=>{process.exitCode=code;setImmediate(()=>process.exit(code));});}
