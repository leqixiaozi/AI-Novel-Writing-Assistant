import {randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import {worldInstallInputSchema,worldInstallCommitSchema,type WorldInstallInput,type WorldInstallCommit,type WorldInstallPreview,type WorldInstallTarget,type WorldInstallReceipt,type PublishedWorldPackage} from '../../../common/worldPackages';
import {WORLD_PROFESSIONAL_TYPE_KEYS} from '../../../common/worldCharacterMaintenance';
import {assertFound,NewDesignError} from '../../domain/errors';
import {getNewDesignPool} from '../runtime';
import {freezeFormContext,formHash} from '../formAssist';
import {resolveBookFormVersion} from '../referenceParity';
import {validateCardValues} from '../../domain/validation';
import {validateDictionaryTreeValues} from '../treeResources';
import {createAuthorMaterialInTransaction} from '../authorMaterials';
import {requireWorldPackageCapability} from './capability';
import {readWorldOriginal,writeWorldOriginal} from './receipts';
import {previewPackageRelation,createPackageRelation} from './relations';
import {prepareWorldCard} from './mapping';

async function installationPreview(db:PoolClient,bookId:string,input:WorldInstallInput,lock=false):Promise<WorldInstallPreview>{
 await requireWorldPackageCapability(db);
 const book=assertFound((await db.query("SELECT * FROM new_design.books WHERE id=$1 AND status='active'"+(lock?' FOR SHARE':''),[bookId])).rows[0],'书籍不存在或已归档。');
 const row=assertFound((await db.query('SELECT receipt FROM new_design.world_package_versions WHERE id=$1'+(lock?' FOR SHARE':''),[input.packageId])).rows[0],'所选公共世界包版本不存在。'),published=row.receipt.package as PublishedWorldPackage;
 const expected=published.frame.cards.map(card=>card.cardId);
 if(input.cards.length!==expected.length||expected.some(id=>!input.cards.some(card=>card.sourceCardId===id)))throw new NewDesignError('请明确映射完整世界包中的每一份资料，未按重名合并或丢弃对象。',422);
 if(input.relations.length!==published.frame.relations.length||published.frame.relations.some(source=>!input.relations.some(item=>item.sourceRelationId===source.relationId)))throw new NewDesignError('请明确映射完整公共关系网络，没有执行部分安装。',422);
 const targets:WorldInstallTarget[]=[];
 const typeKeys=new Map<string,string>();
 for(const item of input.cards){const source=published.frame.cards.find(card=>card.cardId===item.sourceCardId)!;const target=await prepareWorldCard(db,bookId,String(book.space_id),source,item,lock);typeKeys.set(item.sourceCardId,target.typeKey);targets.push(target);}
 const relationTargets=[];for(const item of input.relations)relationTargets.push(await previewPackageRelation(db,book.space_id,published.frame.relations.find(source=>source.relationId===item.sourceRelationId)!,item,typeKeys,lock));
 return{bookId,input,package:published,targets,relationTargets,previewHash:formHash({bookId,book,input,package:published,targets,relationTargets})};
}
export async function previewWorldInstallation(bookId:string,input:WorldInstallInput){const parsed=worldInstallInputSchema.parse(input),db=await(await getNewDesignPool()).connect();try{await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');const result=await installationPreview(db,bookId,parsed);await db.query('COMMIT');return result;}catch(error){await db.query('ROLLBACK');throw error;}finally{db.release();}}
export function readWorldInstallationOriginal(bookId:string,input:WorldInstallCommit){return readWorldOriginal<WorldInstallReceipt>(bookId,worldInstallCommitSchema.parse(input));}
export function installWorldPackage(bookId:string,input:WorldInstallCommit):Promise<WorldInstallReceipt>{const parsed=worldInstallCommitSchema.parse(input);return writeWorldOriginal(bookId,parsed,async db=>{
 const current=await installationPreview(db,bookId,parsed.input,true);if(current.previewHash!==parsed.previewHash)throw new NewDesignError('本书结构或安装映射来源已变化，完整填写保留，请重新预览。',409);
 const cards:WorldInstallReceipt['cards']=[];
 for(const item of parsed.input.cards){
  if((await db.query('SELECT 1 FROM new_design.card_versions WHERE author_book_id=$1 AND author_request_key=$2',[bookId,item.requestKey])).rowCount)throw new NewDesignError('资料原键已有其他保存，原资料保留，未作为新世界安装使用。',409);
  const target=current.targets.find(row=>row.sourceCardId===item.sourceCardId)!,source=current.package.frame.cards.find(card=>card.cardId===item.sourceCardId)!,saved=await createAuthorMaterialInTransaction(db,bookId,{requestKey:item.requestKey,cardTypeId:target.cardTypeId,title:item.title,values:target.values,formVersionId:target.formVersionId,formResolutionKind:target.formResolutionKind});
  cards.push({sourceCardId:source.cardId,sourceVersionId:source.versionId,targetCardId:saved.card.id,targetVersionId:saved.cardVersionId,targetTypeVersionId:saved.card.typeVersionId,mapping:item.mapping});
 }
 const relations:WorldInstallReceipt['relations']=[],spaceId=(await db.query('SELECT space_id FROM new_design.books WHERE id=$1',[bookId])).rows[0].space_id;
 for(const item of parsed.input.relations){const source=current.package.frame.relations.find(row=>row.relationId===item.sourceRelationId)!,created=await createPackageRelation(db,spaceId,item.targetTypeId,cards.find(card=>card.sourceCardId===source.sourceCardId)!.targetCardId,cards.find(card=>card.sourceCardId===source.targetCardId)!.targetCardId,item.properties);relations.push({sourceRelationId:source.relationId,sourceVersionId:source.versionId,targetRelationId:created.id,targetVersionId:created.versionId,targetTypeId:item.targetTypeId});}
 const installationId=randomUUID(),root=assertFound(cards.find(card=>card.sourceCardId===current.package.rootCardId),'安装缺少本书独立世界根。'),inputHash=formHash({scope:bookId,input:parsed}),receipt:WorldInstallReceipt={bookId,installationId,origin:'import',requestKey:parsed.input.requestKey,inputHash,input:parsed,packageId:parsed.input.packageId,cards,relations,sourceRoute:`/new-design/books/${bookId}/story-setting?tab=world&selected=${root.targetCardId}&detail=sync`,repeated:false};
 await db.query('INSERT INTO new_design.world_package_installations(id,book_id,package_id,root_card_id,sync_enabled,request_key,input_hash,input,receipt) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb)',[installationId,bookId,parsed.input.packageId,root.targetCardId,parsed.input.syncEnabled,parsed.input.requestKey,inputHash,JSON.stringify(parsed),JSON.stringify(receipt)]);
 for(const card of cards)await db.query('INSERT INTO new_design.world_package_install_card_refs(installation_id,source_card_id,source_version_id,target_card_id,target_version_id,target_type_version_id,mapping) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb)',[installationId,card.sourceCardId,card.sourceVersionId,card.targetCardId,card.targetVersionId,card.targetTypeVersionId,JSON.stringify(card.mapping)]);
 for(const relation of relations)await db.query('INSERT INTO new_design.world_package_install_relation_refs(installation_id,source_relation_id,source_version_id,target_relation_id,target_version_id,target_type_id) VALUES($1,$2,$3,$4,$5,$6)',[installationId,relation.sourceRelationId,relation.sourceVersionId,relation.targetRelationId,relation.targetVersionId,relation.targetTypeId]);
 for(const card of cards)await db.query("INSERT INTO new_design.resource_adoptions(id,resource_card_id,resource_version_id,book_id,target_card_id,action,snapshot) VALUES($1,$2,$3,$4,$5,'install_snapshot',$6::jsonb)",[randomUUID(),card.sourceCardId,card.sourceVersionId,bookId,card.targetCardId,JSON.stringify({contract:'world_package_import_v1',installationId,mapping:card.mapping})]);
 return receipt;
 });}
