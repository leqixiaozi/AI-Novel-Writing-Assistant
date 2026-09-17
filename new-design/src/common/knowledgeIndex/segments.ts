import {z} from "zod";
import {knowledgeSelectionFromQuery} from "../knowledgeReference/selection";
import type {KnowledgeSourceSelection} from "../knowledgeReference/selection";
export const knowledgeSegmentSchema=z.object({chunkId:z.string().uuid(),start:z.number().int().nonnegative().max(2097152),end:z.number().int().positive().max(2097152),checksum:z.string().regex(/^[a-f0-9]{64}$/)}).strict().refine(value=>value.end>value.start&&value.end-value.start<=50000,"知识段落范围无效。");
export type KnowledgeSegment=z.infer<typeof knowledgeSegmentSchema>;
export function compositionKnowledgeSelectionFromQuery(query:URLSearchParams):(KnowledgeSourceSelection&{segment?:KnowledgeSegment})|null{
 const source=knowledgeSelectionFromQuery(query),names=["chunkId","segmentStart","segmentEnd","segmentChecksum"] as const;
 if(!names.some(name=>query.has(name)))return source;
 if(!source||names.some(name=>query.getAll(name).length!==1))throw new Error("知识段落参数不完整或重复，请重新选择原段落。");
 const rawStart=query.get("segmentStart")!,rawEnd=query.get("segmentEnd")!;
 if(!/^(0|[1-9][0-9]*)$/.test(rawStart)||!/^[1-9][0-9]*$/.test(rawEnd))throw new Error("知识段落字位无效，请重新选择原段落。");
 const result=knowledgeSegmentSchema.safeParse({chunkId:query.get("chunkId"),start:Number(rawStart),end:Number(rawEnd),checksum:query.get("segmentChecksum")});
 if(!result.success)throw new Error("知识段落锚点无效，请重新选择原段落。");
 return {...source,segment:result.data};
}
