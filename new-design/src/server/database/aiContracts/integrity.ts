import { createHash } from "node:crypto";
export const asDate=(value:unknown)=>value instanceof Date?value.toISOString():new Date(String(value)).toISOString();
export const asText=(value:unknown)=>value===null||value===undefined?null:String(value);
export function stable(value:unknown):string{if(Array.isArray(value))return`[${value.map(stable).join(",")}]`;if(value&&typeof value==="object")return`{${Object.entries(value as Record<string,unknown>).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>`${JSON.stringify(key)}:${stable(item)}`).join(",")}}`;return JSON.stringify(value);}
export const stableHash=(value:unknown)=>createHash("sha256").update(stable(value),"utf8").digest("hex");
