import {AsyncLocalStorage} from "node:async_hooks";
import type {Pool} from "pg";
import {z} from "zod";
import {AUTHOR_TASK_DOMAINS,AUTHOR_TASK_STATUSES,AUTHOR_TASK_TAGS,AUTHOR_TASK_KINDS,type AuthorTaskFilter,type AuthorTaskKind,type AuthorTaskPage,type AuthorTaskRecord} from "../../../common/authorTasks";
import {NewDesignError} from "../../domain/errors";
import {getNewDesignPool} from "../runtime";
import {AUTHOR_TASK_SOURCE_QUERY} from "./sourceQuery";
import {projectAuthorTask,AUTHOR_TASK_STATUS_SQL,AUTHOR_TASK_TAG_SQL,type AuthorTaskRow} from "./projection";

export const authorTaskFilterSchema=z.object({bookId:z.string().uuid().optional(),domain:z.enum(AUTHOR_TASK_DOMAINS).optional(),status:z.enum(AUTHOR_TASK_STATUSES).optional(),tag:z.enum(AUTHOR_TASK_TAGS).optional(),search:z.string().trim().max(120).optional(),cursor:z.string().max(400).optional(),limit:z.coerce.number().int().min(1).max(100).optional()}).strict();
export const authorTaskKindSchema=z.enum(AUTHOR_TASK_KINDS);
const cursorSchema=z.object({at:z.string().datetime(),kind:authorTaskKindSchema,id:z.string().uuid()}).strict();
const poolScope=new AsyncLocalStorage<Pool>();
/** Infrastructure-only isolation; never accepted as HTTP input. */
export function withAuthorTasksPool<T>(pool:Pool,run:()=>Promise<T>):Promise<T>{return poolScope.run(pool,run);}
const getPool=async()=>poolScope.getStore()??await getNewDesignPool();
const QUERY=`WITH sources AS (${AUTHOR_TASK_SOURCE_QUERY}) SELECT sources.*,book.name book_name FROM sources LEFT JOIN new_design.books book ON book.id=sources.book_id`;
function encodeCursor(row:AuthorTaskRow):string{return Buffer.from(JSON.stringify({at:row.cursor_at??new Date(row.updated_at).toISOString(),kind:row.kind,id:row.id})).toString("base64url");}
function decodeCursor(raw:string){try{return cursorSchema.parse(JSON.parse(Buffer.from(raw,"base64url").toString("utf8")));}catch{throw new NewDesignError("运行记录分页凭证无效，请从首屏重新查看。",422);}}
export async function listAuthorTasks(raw:AuthorTaskFilter={}):Promise<AuthorTaskPage>{
  const input=authorTaskFilterSchema.parse(raw),cursor=input.cursor?decodeCursor(input.cursor):null,pool=await getPool();
  // One statement, database-side filters and bounded page; no N+1 source GETs.
  const result=await pool.query<{total:string;items:AuthorTaskRow[]}>(`WITH sources AS (${AUTHOR_TASK_SOURCE_QUERY}), projected AS (
    SELECT sources.*,${AUTHOR_TASK_STATUS_SQL} projected_status FROM sources
  ), scoped AS (
    SELECT sources.*,book.name book_name,to_char(sources.updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') cursor_at FROM projected sources LEFT JOIN new_design.books book ON book.id=sources.book_id
    WHERE ($1::uuid IS NULL OR sources.book_id=$1) AND ($2::text IS NULL OR sources.domain=$2)
    AND ($3::text IS NULL OR strpos(lower(COALESCE(sources.title,'')||' '||COALESCE(book.name,'')),lower($3))>0)
  ), filtered AS (SELECT * FROM scoped WHERE ($4::text IS NULL OR projected_status=$4) AND ($5::text IS NULL OR $5=ANY(${AUTHOR_TASK_TAG_SQL}))), page AS (
    SELECT * FROM filtered WHERE ($6::timestamptz IS NULL OR (updated_at,kind,id)<($6::timestamptz,$7::text,$8::uuid))
    ORDER BY updated_at DESC,kind DESC,id DESC LIMIT $9
  ) SELECT (SELECT count(*)::text FROM filtered) total,COALESCE((SELECT jsonb_agg(page ORDER BY updated_at DESC,kind DESC,id DESC) FROM page),'[]'::jsonb) items`,
    [input.bookId??null,input.domain??null,input.search||null,input.status??null,input.tag??null,cursor?.at??null,cursor?.kind??null,cursor?.id??null,(input.limit??40)+1]);
  const rows=result.rows[0].items,selected=rows.slice(0,input.limit??40);
  return {items:selected.map(projectAuthorTask),nextCursor:rows.length>selected.length?encodeCursor(selected.at(-1)!):null,total:Number(result.rows[0].total),readAt:new Date().toISOString()};
}
export async function getAuthorTask(kind:AuthorTaskKind,id:string):Promise<AuthorTaskRecord>{
  authorTaskKindSchema.parse(kind);z.string().uuid().parse(id);
  const row=(await(await getPool()).query<AuthorTaskRow>(`${QUERY} WHERE sources.kind=$1 AND sources.id=$2::uuid`,[kind,id])).rows[0];
  if(!row)throw new NewDesignError("此运行记录不存在或不属于当前可展示的来源，请刷新列表核对。",404);
  return projectAuthorTask(row);
}
