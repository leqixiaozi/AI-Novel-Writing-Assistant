import type {PlanningWriteReceipt} from '../../../common/storyWorkspace';
import {getNewDesignPool} from '../runtime';
import {getPlanningObject} from './store';
import {planningOperation,planningVersion} from './records';
export async function readPlanningWriteReceipt(bookId:string,key:string):Promise<PlanningWriteReceipt|null>{
 const db=await getNewDesignPool(),row=await planningOperation(db,{book_id:bookId,idempotency_key:key});
 if(!row||!['create','revise'].includes(row.action))return null;
 const version=await planningVersion(db,row.version_id,row.object_id);if(version.book_id!==bookId)return null;
 const object=await getPlanningObject(row.object_id);
 return {requestKey:row.idempotency_key,bookId:row.book_id,objectId:row.object_id,versionId:row.version_id,action:row.action,resultRevision:Number(row.result_revision),inputHash:row.request_hash,object};
}
