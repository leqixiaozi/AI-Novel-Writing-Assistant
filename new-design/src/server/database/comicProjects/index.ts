import {createHash,randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import {comicCreateSchema,type ComicCapability,type ComicCreateInput,type ComicCreateReceipt,type ComicProjectDetail,type ComicProjectSummary,type ComicSourceSnapshot} from '../../../common/comicProjects';
import {NewDesignError} from '../../domain/errors';
import {getNewDesignPool} from '../runtime';

const hash=(value:string)=>createHash('sha256').update(value,'utf8').digest('hex');
const inputHash=(value:ComicCreateInput)=>hash(JSON.stringify(value));
function project(row:Record<string,unknown>):ComicProjectSummary{return {id:String(row.id),title:String(row.title),sourceType:row.source_type as ComicProjectSummary['sourceType'],comicFormat:row.comic_format as ComicProjectSummary['comicFormat'],stylePreset:row.style_preset as ComicProjectSummary['stylePreset'],status:'draft',revision:Number(row.revision),sourceVersionId:String(row.adopted_source_version_id),createdAt:new Date(String(row.created_at)).toISOString(),updatedAt:new Date(String(row.updated_at)).toISOString()};}
function snapshot(row:Record<string,unknown>):ComicSourceSnapshot{return {id:String(row.id),type:row.source_type as ComicSourceSnapshot['type'],sourceBookId:row.source_book_id?String(row.source_book_id):null,sourceBookName:row.source_book_name?String(row.source_book_name):null,content:String(row.content),contentHash:String(row.content_hash),manifest:row.manifest as ComicSourceSnapshot['manifest'],createdAt:new Date(String(row.created_at)).toISOString()};}

export async function getComicCapability():Promise<ComicCapability>{const pool=await getNewDesignPool();const result=await pool.query("SELECT to_regclass('new_design.comic_projects') IS NOT NULL projects,to_regclass('new_design.comic_source_versions') IS NOT NULL sources,EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid=to_regclass('new_design.comic_source_versions') AND tgname='comic_source_versions_immutable' AND tgenabled='O') immutable");const row=result.rows[0];const installed=Boolean(row.projects&&row.sources),operational=installed&&Boolean(row.immutable);return {installed,operational,reason:operational?'漫画项目与来源快照可用。':installed?'漫画来源快照保护未就绪，写入已停用。':'漫画工作台手动迁移 109 尚未启用。'};}
async function requireComicCapability(write=false){const capability=await getComicCapability();if(!capability.installed||write&&!capability.operational)throw new NewDesignError(capability.reason,503);}

const DETAIL_QUERY=`SELECT project.*,source.id source_id,source.source_type snapshot_type,source.source_book_id,source.source_book_name,source.content,source.content_hash,source.manifest,source.created_at source_created_at FROM new_design.comic_projects project JOIN new_design.comic_source_versions source ON source.project_id=project.id AND source.id=project.adopted_source_version_id WHERE project.id=$1`;
function detail(row:Record<string,unknown>):ComicProjectDetail{return {project:project(row),source:snapshot({id:row.source_id,source_type:row.snapshot_type,source_book_id:row.source_book_id,source_book_name:row.source_book_name,content:row.content,content_hash:row.content_hash,manifest:row.manifest,created_at:row.source_created_at})};}
async function detailById(db:Pick<PoolClient,'query'>,id:string):Promise<ComicProjectDetail>{const row=(await db.query(DETAIL_QUERY,[id])).rows[0];if(!row)throw new NewDesignError('漫画项目不存在。',404);return detail(row);}
export async function listComicProjects():Promise<ComicProjectSummary[]>{await requireComicCapability();const rows=await(await getNewDesignPool()).query('SELECT * FROM new_design.comic_projects ORDER BY created_at DESC,id DESC');return rows.rows.map(project);}
export async function getComicProject(id:string):Promise<ComicProjectDetail>{await requireComicCapability();return detailById(await getNewDesignPool(),id);}
export async function readComicCreateOriginal(requestKey:string):Promise<ComicCreateReceipt|null>{await requireComicCapability();const pool=await getNewDesignPool(),row=(await pool.query('SELECT id FROM new_design.comic_projects WHERE create_request_key=$1',[requestKey])).rows[0];if(!row)return null;return {...await detailById(pool,String(row.id)),requestKey,repeated:true};}

async function novelSource(db:PoolClient,bookId:string){
 const book=(await db.query("SELECT id,name FROM new_design.books WHERE id=$1 AND status='active'",[bookId])).rows[0];
 if(!book)throw new NewDesignError('来源小说不存在或已归档，请重新选择。',422);
 const rows=(await db.query("SELECT document.id document_id,document.title,body.id body_version_id,body.content FROM new_design.chapter_documents document JOIN new_design.chapter_body_versions body ON body.id=document.adopted_version_id AND body.chapter_document_id=document.id AND body.archived_at IS NULL WHERE document.book_id=$1 AND document.status='active' AND length(btrim(body.content))>0 ORDER BY document.logical_order,document.id",[bookId])).rows;
 if(!rows.length)throw new NewDesignError('来源小说尚无已采用正文，不能建立可追溯的漫画来源。',422);
 const content=rows.map(row=>`# ${row.title}\n\n${row.content}`).join('\n\n');
 if(Buffer.byteLength(content,'utf8')>4_000_000)throw new NewDesignError('已采用正文超过单次漫画来源上限，请先缩小来源范围。',422);
 return {content,sourceBookId:bookId,sourceBookName:String(book.name),manifest:{chapters:rows.map(row=>({documentId:String(row.document_id),bodyVersionId:String(row.body_version_id),title:String(row.title)}))}};
}

export async function createComicProject(raw:ComicCreateInput):Promise<ComicCreateReceipt>{
 const input=comicCreateSchema.parse(raw),fingerprint=inputHash(input);await requireComicCapability(true);
 const pool=await getNewDesignPool(),db=await pool.connect();let committing=false;
 try{
  await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
  const existing=(await db.query('SELECT id,create_input_hash FROM new_design.comic_projects WHERE create_request_key=$1',[input.requestKey])).rows[0];
  if(existing){if(existing.create_input_hash!==fingerprint)throw new NewDesignError('原创建凭证已用于不同漫画项目，请核对原请求。',409);const result=await detailById(db,String(existing.id));await db.query('COMMIT');return {...result,requestKey:input.requestKey,repeated:true};}
  const source=input.sourceType==='novel_import'?await novelSource(db,input.sourceBookId!):{content:input.sourceText!,sourceBookId:null,sourceBookName:null,manifest:{chapters:[]}};
  if(Buffer.byteLength(source.content,'utf8')>4_000_000)throw new NewDesignError('来源文本超过单次漫画来源上限。',422);
  const projectId=randomUUID(),sourceId=randomUUID();
  await db.query('INSERT INTO new_design.comic_projects(id,title,source_type,comic_format,style_preset,create_request_key,create_input_hash) VALUES($1,$2,$3,$4,$5,$6,$7)',[projectId,input.title,input.sourceType,input.comicFormat,input.stylePreset,input.requestKey,fingerprint]);
  await db.query('INSERT INTO new_design.comic_source_versions(id,project_id,version,source_type,source_book_id,source_book_name,content,content_hash,manifest) VALUES($1,$2,1,$3,$4,$5,$6,$7,$8)',[sourceId,projectId,input.sourceType,source.sourceBookId,source.sourceBookName,source.content,hash(source.content),source.manifest]);
  await db.query('UPDATE new_design.comic_projects SET adopted_source_version_id=$2 WHERE id=$1',[projectId,sourceId]);
  const result=await detailById(db,projectId);committing=true;await db.query('COMMIT');return {...result,requestKey:input.requestKey,repeated:false};
 }catch(error){await db.query('ROLLBACK').catch(()=>undefined);if(committing)throw new NewDesignError('创建结果未知，请按原请求键只读核对，不要新建重复项目。',503);if((error as {code?:string}).code==='23505'){const receipt=await readComicCreateOriginal(input.requestKey);if(receipt){const row=(await pool.query('SELECT create_input_hash FROM new_design.comic_projects WHERE id=$1',[receipt.project.id])).rows[0];if(row?.create_input_hash===fingerprint)return receipt;throw new NewDesignError('原创建凭证已用于不同漫画项目。',409);}}throw error;}finally{db.release();}
}
