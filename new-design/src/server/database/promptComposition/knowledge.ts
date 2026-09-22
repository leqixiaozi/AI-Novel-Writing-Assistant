import type {PoolClient} from "pg";
import type {CompositionSettings} from "../../../common/promptComposition";
import type {KnowledgeReferenceCandidate} from "../../../common/knowledgeReference";
import {NewDesignError,assertFound} from "../../domain/errors";
import {resolveReadyKnowledgeVersion,resolveKnowledgeReferenceSegment,readReadyKnowledgeRows} from "../knowledgeReference";
import {requireRecordCard} from '../recordCards';
import type {ExactCompositionKnowledgeSource,LoadedCompositionRecipe} from "./contracts";

export async function loadCompositionKnowledge(client:PoolClient,settings:CompositionSettings):Promise<ExactCompositionKnowledgeSource[]>{
 const selected=settings.context.knowledgeSources??[];
 if(selected.length&&!settings.context.bookId)throw new NewDesignError("选择知识参考前必须明确选择书籍。",422);
 const results:ExactCompositionKnowledgeSource[]=[];
 for(const source of selected){
  const version=assertFound((await client.query('SELECT asset_id,version FROM new_design.asset_versions WHERE id=$1 AND book_id=$2',[source.parsedVersionId,settings.context.bookId])).rows[0],'知识解析精确版本不属于本书。');
  const asset=await requireRecordCard(client,String(version.asset_id),'asset','知识解析资产不存在。');
  if(asset.book_id!==settings.context.bookId)throw new NewDesignError('知识解析资产不属于本书。',404);
  const metadata={id:asset.id,space_id:asset.space_id,version:version.version};
  const ready=assertFound(await resolveReadyKnowledgeVersion(client,settings.context.bookId!,String(metadata.id),source.parsedVersionId),"知识参考未解析、已经过期、缺少有效状态或已归档，请返回知识参考核对后明确重新选择。");
  if(ready.asset_id!==source.assetId||ready.source_version_id!==source.sourceVersionId||ready.checksum!==source.checksum)throw new NewDesignError("知识原件版本、解析版本或内容哈希已变化，原组合版本仍保留，请重新选择知识参考。",409,{"context.knowledgeSources":"知识参考精确来源已变化。"});
  let text=String(ready.text);
  if(source.segment)text=await resolveKnowledgeReferenceSegment(client,settings.context.bookId!,String(metadata.id),source.parsedVersionId,source.checksum,text,source.segment);
  results.push({...source,parsedAssetId:String(metadata.id),spaceId:String(metadata.space_id),revision:Number(metadata.version),resourceId:String(ready.resource_id),title:String(ready.title),text});
 }
 return results;
}
export async function readCompositionKnowledgeCandidates(client:PoolClient,bookId:string):Promise<{items:KnowledgeReferenceCandidate[];truncated:boolean}>{
 const rows=(await readReadyKnowledgeRows(client,bookId)).map(row=>({...row,excerpt:String(row.text??'').slice(0,1000)}));
 return{items:rows.slice(0,100).map(row=>({assetId:String(row.asset_id),sourceVersionId:String(row.source_version_id),parsedAssetId:String(row.parsed_asset_id),parsedVersionId:String(row.parsed_version_id),checksum:String(row.checksum),resourceId:String(row.resource_id),title:String(row.title),excerpt:String(row.excerpt)})),truncated:rows.length>100};
}
export const compositionContextTypes=(settings:CompositionSettings)=>settings.context.knowledgeSources?.length?["card_version","asset_version"]:["card_version"];
export const compositionFrozenReferences=(bundle:LoadedCompositionRecipe)=>[
 ...bundle.components.filter(item=>item.enabled).map(item=>({kind:"prompt_component",...item,role:"reference"})),
 ...bundle.sources.map(item=>({kind:"card_version",...item})),
 ...(bundle.knowledgeSources??[]).map(item=>({kind:"asset_version",...item,cardId:item.parsedAssetId,versionId:item.parsedVersionId,role:"reference"})),
];
