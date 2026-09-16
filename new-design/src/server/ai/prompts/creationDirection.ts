import {z} from "zod";
import {shortText,textList} from "./fields";
export const directionSchema=z.object({id:z.string().trim().min(1).max(160),title:shortText,premise:z.string().trim().min(1).max(4000),protagonist:z.string().trim().min(1).max(2000),centralConflict:z.string().trim().min(1).max(4000),readerPromise:z.string().trim().min(1).max(2000),styleKeywords:textList}).strict();
