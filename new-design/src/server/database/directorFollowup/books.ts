import type {PoolClient} from 'pg';
import type {FollowupBook} from '../../../common/directorFollowup';
import {assertFound} from '../../domain/errors';
const BOOK_QUERY=`SELECT book.id,book.name,book.revision,book.status,book.updated_at,
 (SELECT count(*) FROM new_design.ai_tasks WHERE book_id=book.id) tasks_total,
 (SELECT count(*) FROM new_design.ai_tasks WHERE book_id=book.id AND status='running') tasks_running,
 (SELECT count(*) FROM new_design.ai_tasks WHERE book_id=book.id AND status='failed') tasks_failed,
 (SELECT count(*) FROM new_design.ai_tasks WHERE book_id=book.id AND status='waiting_approval') tasks_waiting,
 (SELECT count(*) FROM new_design.production_director_runs WHERE book_id=book.id) directors_total,
 (SELECT count(*) FROM new_design.production_director_runs WHERE book_id=book.id AND status='running') directors_running,
 (SELECT count(*) FROM new_design.production_director_runs WHERE book_id=book.id AND status='paused') directors_paused,
 (SELECT count(*) FROM new_design.production_director_runs WHERE book_id=book.id AND status='waiting_recovery') directors_recovery,
 (SELECT count(*) FROM new_design.quality_issues WHERE book_id=book.id) quality_total,
 (SELECT count(*) FROM new_design.quality_issues WHERE book_id=book.id AND current_status IN ('open','acknowledged','deferred','fix_proposed')) quality_unresolved,
 (SELECT count(*) FROM new_design.quality_issues WHERE book_id=book.id AND is_quality_debt=true AND current_status IN ('open','acknowledged','deferred','fix_proposed')) quality_debt,
 (SELECT count(*) FROM new_design.quality_issues issue JOIN new_design.quality_audit_reports report ON report.id=issue.report_id WHERE issue.book_id=book.id AND (issue.current_status='stale' OR report.stale_at IS NOT NULL)) quality_stale
 FROM new_design.books book`;
function project(row:Record<string,unknown>):FollowupBook{return{id:String(row.id),name:String(row.name),revision:Number(row.revision),status:row.status==='active'?'active':'archived',statusLabel:row.status==='active'?'当前书籍':'已归档书籍',updatedAt:new Date(String(row.updated_at)).toISOString(),tasks:{total:Number(row.tasks_total),running:Number(row.tasks_running),failed:Number(row.tasks_failed),waitingApproval:Number(row.tasks_waiting)},directors:{total:Number(row.directors_total),running:Number(row.directors_running),paused:Number(row.directors_paused),waitingRecovery:Number(row.directors_recovery)},quality:{total:Number(row.quality_total),unresolved:Number(row.quality_unresolved),debt:Number(row.quality_debt),stale:Number(row.quality_stale)}};}
export async function readFollowupBooks(client:PoolClient,status:'active'|'archived'|'all'){const rows=(await client.query(`${BOOK_QUERY} WHERE ($1='all' OR book.status=$1) ORDER BY book.updated_at DESC,book.id DESC LIMIT 101`,[status])).rows,total=Number((await client.query("SELECT count(*) FROM new_design.books WHERE ($1='all' OR status=$1)",[status])).rows[0].count);return{books:rows.slice(0,100).map(project),total,truncated:rows.length>100};}
export async function readFollowupBook(client:PoolClient,id:string):Promise<FollowupBook>{return project(assertFound((await client.query(`${BOOK_QUERY} WHERE book.id=$1`,[id])).rows[0],'选定书籍不存在，不选择其他书代替。'));}
