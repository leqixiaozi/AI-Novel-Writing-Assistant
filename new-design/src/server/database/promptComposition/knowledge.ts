import type {PoolClient} from "pg";
import type {CompositionSettings} from "../../../common/promptComposition";
import type {KnowledgeReferenceCandidate} from "../../../common/knowledgeReference";
import {NewDesignError,assertFound} from "../../domain/errors";
import {resolveReadyKnowledgeVersion,resolveKnowledgeReferenceSegment} from "../knowledgeReference";
import type {ExactCompositionKnowledgeSource,LoadedCompositionRecipe} from "./contracts";

export async function loadCompositionKnowledge(client:PoolClient,settings:CompositionSettings):Promise<ExactCompositionKnowledgeSource[]>{
 const selected=settings.context.knowledgeSources??[];
 if(selected.length&&!settings.context.bookId)throw new NewDesignError("选择知识参考前必须明确选择书籍。",422);
 const results:ExactCompositionKnowledgeSource[]=[];
 for(const source of selected){
  const metadata=assertFound((await client.query("SELECT asset.id,asset.space_id,version.version FROM new_design.asset_versions version JOIN new_design.assets asset ON asset.id=version.asset_id WHERE version.id=$1 AND version.book_id=$2 AND asset.book_id=$2",[source.parsedVersionId,settings.context.bookId])).rows[0],"知识解析精确版本不属于本书。");
  const ready=assertFound(await resolveReadyKnowledgeVersion(client,settings.context.bookId!,String(metadata.id),source.parsedVersionId),"知识参考未解析、已经过期、缺少有效状态或已归档，请返回知识参考核对后明确重新选择。");
  if(ready.asset_id!==source.assetId||ready.source_version_id!==source.sourceVersionId||ready.checksum!==source.checksum)throw new NewDesignError("知识原件版本、解析版本或内容哈希已变化，原组合版本仍保留，请重新选择知识参考。",409,{"context.knowledgeSources":"知识参考精确来源已变化。"});
  let text=String(ready.text);
  if(source.segment)text=await resolveKnowledgeReferenceSegment(client,settings.context.bookId!,String(metadata.id),source.parsedVersionId,source.checksum,text,source.segment);
  results.push({...source,parsedAssetId:String(metadata.id),spaceId:String(metadata.space_id),revision:Number(metadata.version),resourceId:String(ready.resource_id),title:String(ready.title),text});
 }
 return results;
}
export async function readCompositionKnowledgeCandidates(client:PoolClient,bookId:string):Promise<{items:KnowledgeReferenceCandidate[];truncated:boolean}>{
 const rows=(await client.query("SELECT source.id asset_id,source.current_version_id source_version_id,source.title,parsed.asset_id parsed_asset_id,parsed.id parsed_version_id,content.checksum,resource.id resource_id,substring(parsed.metadata->'knowledgeReference'->>'text' FROM 1 FOR 1000) excerpt FROM new_design.assets source JOIN new_design.asset_derivations request ON request.source_asset_version_id=source.current_version_id AND request.book_id=source.book_id AND request.recipe_key='knowledge.utf8' AND request.status='succeeded' JOIN new_design.assets output ON output.id=request.output_asset_id AND output.book_id=source.book_id AND output.status='active' JOIN new_design.asset_versions parsed ON parsed.id=output.current_version_id AND parsed.book_id=source.book_id AND parsed.metadata->'knowledgeReference'->>'kind'='parsed' JOIN new_design.asset_content_objects content ON content.id=parsed.content_object_id AND content.integrity_state='verified' AND jsonb_typeof(parsed.metadata->'knowledgeReference'->'text')='string' AND content.checksum=encode(sha256(convert_to(parsed.metadata->'knowledgeReference'->>'text','UTF8')),'hex') JOIN new_design.asset_derivation_results result ON result.derivation_id=request.id AND result.book_id=source.book_id AND result.output_asset_version_id=parsed.id AND result.source_asset_version_id=source.current_version_id AND result.outcome='applied' AND result.output_checksum=content.checksum JOIN new_design.dependency_resources resource ON resource.resource_kind='asset_version' AND resource.stable_object_id=output.id AND resource.exact_version_id=parsed.id AND resource.book_id=source.book_id JOIN new_design.dependency_resource_states state ON state.resource_id=resource.id AND state.book_id=source.book_id AND state.state IN ('fresh','recomputed') WHERE source.book_id=$1 AND source.status='active' ORDER BY source.title,parsed.id LIMIT 101",[bookId])).rows;
 return{items:rows.slice(0,100).map(row=>({assetId:String(row.asset_id),sourceVersionId:String(row.source_version_id),parsedAssetId:String(row.parsed_asset_id),parsedVersionId:String(row.parsed_version_id),checksum:String(row.checksum),resourceId:String(row.resource_id),title:String(row.title),excerpt:String(row.excerpt)})),truncated:rows.length>100};
}
export const compositionContextTypes=(settings:CompositionSettings)=>settings.context.knowledgeSources?.length?["card_version","asset_version"]:["card_version"];
export const compositionFrozenReferences=(bundle:LoadedCompositionRecipe)=>[
 ...bundle.components.filter(item=>item.enabled).map(item=>({kind:"prompt_component",...item,role:"reference"})),
 ...bundle.sources.map(item=>({kind:"card_version",...item})),
 ...(bundle.knowledgeSources??[]).map(item=>({kind:"asset_version",...item,cardId:item.parsedAssetId,versionId:item.parsedVersionId,role:"reference"})),
];
