import type {PlanningObject} from '../contracts';
export interface PlanningWriteReceipt {requestKey:string;bookId:string;objectId:string;versionId:string;action:'create'|'revise';resultRevision:number;inputHash:string;object:PlanningObject}
/** Same canonical representation as the original planning operation ledger. */
export function canonicalWriteInput(value:unknown):string{
 if(Array.isArray(value))return `[${value.map(canonicalWriteInput).join(',')}]`;
 if(value&&typeof value==='object')return `{${Object.entries(value as Record<string,unknown>).filter(([,item])=>item!==undefined).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>`${JSON.stringify(key)}:${canonicalWriteInput(item)}`).join(',')}}`;
 const encoded=JSON.stringify(value);if(encoded===undefined)throw new Error('保存输入不能编码。');return encoded;
}
export async function writeInputHash(value:unknown):Promise<string>{return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonicalWriteInput(value))))).map(item=>item.toString(16).padStart(2,'0')).join('');}
