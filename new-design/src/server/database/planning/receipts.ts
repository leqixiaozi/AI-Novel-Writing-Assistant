import type {PlanningWriteReceipt} from '../../../common/storyWorkspace';
import {getNewDesignPool} from '../runtime';
import {getPlanningObject} from './store';
export async function readPlanningWriteReceipt(bookId:string,key:string):Promise<PlanningWriteReceipt|null>{
 const row=(await (await getNewDesignPool()).query(`SELECT event.* FROM new_design.planning_operation_events event JOIN new_design.planning_versions version ON version.id=event.version_id AND version.object_id=event.object_id AND version.book_id=event.book_id WHERE event.book_id=$1 AND event.idempotency_key=$2 AND event.action IN ('create','revise')`,[bookId,key])).rows[0];
 if(!row)return null;
 const object=await getPlanningObject(row.object_id);
 return {requestKey:row.idempotency_key,bookId:row.book_id,objectId:row.object_id,versionId:row.version_id,action:row.action,resultRevision:Number(row.result_revision),inputHash:row.request_hash,object};
}
