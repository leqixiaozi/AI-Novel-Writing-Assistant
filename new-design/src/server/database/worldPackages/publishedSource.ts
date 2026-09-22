import {randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import type {WorldLibraryCandidate,WorldLibraryPublish,PublishedWorldPackage,WorldInstallReceipt} from '../../../common/worldPackages';
import {formHash} from '../formAssist';
import {NewDesignError} from '../../domain/errors';
import {recordWorkflowAction} from '../cardWorkflow';
import {createRecordCard,listRecordCards} from '../recordCards';

/** Link the original book materials to their new public copies. This is source
 * provenance, not an import or another author save. The complete library command
 * remains the authority for recovery. */
export async function linkPublishedSource(db:PoolClient,bookId:string,input:WorldLibraryPublish,candidate:WorldLibraryCandidate,published:PublishedWorldPackage,created:Map<string,{id:string;versionId:string}>,relationCopies:Map<string,{id:string;versionId:string}>):Promise<WorldInstallReceipt>{
 if((await listRecordCards(db,'world_package_installation')).some(row=>row.book_id===bookId&&row.root_card_id===candidate.input.rootCardId))throw new NewDesignError('当前世界已有公共来源，请从同步管理准备推送，原来源保留。',409);
 const installationId=randomUUID(),inputHash=formHash({scope:bookId,input}),cards:WorldInstallReceipt['cards']=candidate.input.cards.map(item=>{const original=candidate.preview.sourceFrame.cards.find(card=>card.cardId===item.sourceCardId)!,source=created.get(item.sourceCardId)!;return{sourceCardId:source.id,sourceVersionId:source.versionId,targetCardId:original.cardId,targetVersionId:original.versionId,targetTypeVersionId:original.typeVersionId,mapping:item.mapping.map(map=>({sourceKey:map.targetKey,targetKey:map.sourceKey,value:({...original.values,...original.localValues})[map.sourceKey]}))};}),relations:WorldInstallReceipt['relations']=candidate.input.relations.map(item=>{const original=candidate.preview.sourceFrame.relations.find(relation=>relation.relationId===item.sourceRelationId)!,source=relationCopies.get(item.sourceRelationId)!;return{sourceRelationId:source.id,sourceVersionId:source.versionId,targetRelationId:original.relationId,targetVersionId:original.versionId,targetTypeId:String(original.type.id)};});
 const receipt:WorldInstallReceipt={bookId,installationId,origin:'published_source',requestKey:input.requestKey,inputHash,input,packageId:published.id,cards,relations,sourceRoute:`/new-design/books/${bookId}/story-setting?tab=world&selected=${candidate.input.rootCardId}&detail=sync`,repeated:false};
 const book=await db.query('SELECT space_id FROM new_design.books WHERE id=$1',[bookId]),saved=await createRecordCard(db,{spaceId:String(book.rows[0].space_id),typeKey:'world_package_installation',title:'本书发布为公共世界来源',values:{id:installationId,book_id:bookId,package_id:published.id,root_card_id:candidate.input.rootCardId,sync_enabled:true,origin:'published_source',request_key:input.requestKey,input_hash:inputHash,input,receipt,cards,relations}});
 await recordWorkflowAction(db,{cardId:saved.recordCardId,actionKey:'world_package.publish_source',requestKey:input.requestKey,inputHash,payload:{bookId,installationId,packageId:published.id,cards,relations}});
 return receipt;
}
