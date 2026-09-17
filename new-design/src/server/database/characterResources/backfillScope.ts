import type {PoolClient} from 'pg';
import type {ChapterSettlementEditingWorkspace} from '../../../common/chapterSettlementEditing';
import type {ResourceBackfillScope,ResourceBackfillFrozenScope} from '../../../common/characterResources';
import {NewDesignError} from '../../domain/errors';
import {stableHash} from '../aiContracts';
import {readCharacterResourcesInTransaction} from './index';
export async function freezeResourceBackfillScope(db:PoolClient,workspace:ChapterSettlementEditingWorkspace,scope:ResourceBackfillScope):Promise<{catalog:ChapterSettlementEditingWorkspace['catalog'];resourceScope:ResourceBackfillFrozenScope}>{
 const resourceScope=await freezeResourceBackfillSources(db,workspace.session.bookId,workspace.session.bodyVersionId,workspace.candidate.content,scope);
 const subjectIds=new Set([...scope.resourceIds,...scope.relationIds]),subjects=workspace.catalog.subjects.filter(subject=>subjectIds.has(subject.id)).map(subject=>({...subject,categories:subject.categories.filter(category=>subject.subjectKind==='relation'?category==='relationship':category==='prop')}));
 if(subjects.length!==subjectIds.size||!subjects.some(subject=>!subject.unavailableReason&&subject.categories.length&&subject.fields.some(field=>field.baseline.known&&!field.baseline.stale)))throw new NewDesignError('所选资源没有可用的正式字段或已确认前值，请在原章节核对规格并明确建立初始状态后再准备。',409);
 return{catalog:{...workspace.catalog,subjects,objectChoices:workspace.catalog.objectChoices.filter(object=>object.id===scope.characterId||scope.resourceIds.includes(object.id)),holderChoices:workspace.catalog.holderChoices.filter(holder=>holder.id===scope.characterId)},resourceScope};
}
async function freezeResourceBackfillSources(db:PoolClient,bookId:string,bodyVersionId:string,bodyContent:string,scope:ResourceBackfillScope):Promise<ResourceBackfillFrozenScope>{
 const ledger=await readCharacterResourcesInTransaction(db,bookId,scope.characterId,{relationTypeId:scope.relationTypeId,holdingDimensionKey:scope.holdingDimensionKey,specificationHash:scope.specificationHash});
 if(ledger.truncated||ledger.characterVersionId!==scope.characterVersionId||ledger.characterRevision!==scope.characterRevision)throw new NewDesignError('人物或资源范围已变化，请重新读取后确认；本次未发送模型请求。',409);
 const items=ledger.items.filter(item=>scope.relationIds.includes(item.relationId)&&scope.resourceIds.includes(item.resourceId));
 if(items.length!==scope.relationIds.length||new Set(items.map(item=>item.resourceId)).size!==scope.resourceIds.length||items.some(item=>!item.available))throw new NewDesignError('资源与持有关系不属于本书所选完整范围，请保留选择后核对。',409);
 const rows=(await db.query("SELECT id,subject_card_id,start_offset,end_offset,excerpt FROM new_design.chapter_text_anchors WHERE book_id=$1 AND body_version_id=$2 AND status='active' AND subject_card_id=ANY($3::uuid[]) ORDER BY start_offset,id",[bookId,bodyVersionId,[scope.characterId,...scope.resourceIds]])).rows;
 if(rows.some(row=>bodyContent.slice(Number(row.start_offset),Number(row.end_offset))!==row.excerpt))throw new NewDesignError('采用正文锚点与原文不一致，请在原章节核对，未发送模型请求。',409);
 const resourceScope:ResourceBackfillFrozenScope={...scope,resources:items.map(item=>({id:item.resourceId,versionId:item.resourceVersionId,relationId:item.relationId,relationVersionId:item.relationVersionId})),anchors:rows.map(row=>({id:String(row.id),subjectCardId:row.subject_card_id?String(row.subject_card_id):null,start:Number(row.start_offset),end:Number(row.end_offset),excerpt:String(row.excerpt)}))};
 return resourceScope;
}

export async function verifyFrozenResourceBackfillScope(db:PoolClient,bookId:string,bodyVersionId:string,bodyContent:string,scope:ResourceBackfillFrozenScope):Promise<void>{
 if(!(await db.query("SELECT body.id FROM new_design.chapter_body_versions body JOIN new_design.chapter_documents document ON document.id=body.chapter_document_id AND document.adopted_version_id=body.id AND document.status='active' WHERE document.book_id=$1 AND body.id=$2 AND body.content=$3 AND body.archived_at IS NULL",[bookId,bodyVersionId,bodyContent])).rowCount)throw new NewDesignError('资源回填必须使用本书当前确切采用正文。',422);
 const actual=await freezeResourceBackfillSources(db,bookId,bodyVersionId,bodyContent,scope);
 if(stableHash(actual)!==stableHash(scope))throw new NewDesignError('资源回填快照必须使用本书确切人物、资源、正式持有关系及采用正文锚点。',422);
}
