import type {PoolClient} from "pg";
import type {KnowledgeSourceSelection} from "../../../common/knowledgeReference/selection";
import type {FormAssistSnapshot} from "../../../common/formAssist";
import {resolveReadyKnowledgeVersion} from "../knowledgeReference";
import {NewDesignError,assertFound} from "../../domain/errors";
export async function freezeFormKnowledge(db:Pick<PoolClient,"query">,bookId:string,sources:KnowledgeSourceSelection[]):Promise<NonNullable<FormAssistSnapshot["knowledgeReferences"]>>{
 if(sources.length>20||new Set(sources.map(item=>item.parsedVersionId)).size!==sources.length)throw new NewDesignError("知识参考最多选择20项，精确版本不能重复。",422,{referenceKnowledgeSources:"请重新选择实际知识来源。"});
 const frozen:NonNullable<FormAssistSnapshot["knowledgeReferences"]>=[];
 for(const source of sources){
  await db.query("SELECT asset.id FROM new_design.assets asset WHERE asset.book_id=$1 AND (asset.id=$2 OR asset.id=(SELECT version.asset_id FROM new_design.asset_versions version WHERE version.id=$3 AND version.book_id=$1)) ORDER BY asset.id FOR SHARE",[bookId,source.assetId,source.parsedVersionId]);
  const parsed=assertFound((await db.query("SELECT asset_id,version FROM new_design.asset_versions WHERE id=$1 AND book_id=$2",[source.parsedVersionId,bookId])).rows[0],"知识解析版本不属于本书。");
  const row=assertFound(await resolveReadyKnowledgeVersion(db,bookId,String(parsed.asset_id),source.parsedVersionId),"知识参考已过期、归档或尚未完成真实解析，请返回知识参考核对后重新选择；当前资料填写保留。");
  if(row.asset_id!==source.assetId||row.source_version_id!==source.sourceVersionId||row.checksum!==source.checksum)throw new NewDesignError("知识原件或解析内容的精确版本已变化，请返回知识参考重新选择；原候选和当前草稿保留。",409,{referenceKnowledgeSources:"知识来源版本或内容哈希变化。"});
  frozen.push({...source,parsedAssetId:String(parsed.asset_id),revision:Number(parsed.version),resourceId:String(row.resource_id),title:String(row.title),text:String(row.text)});
 }
 if(Buffer.byteLength(JSON.stringify(frozen),"utf8")>1000000)throw new NewDesignError("知识正文超过本次资料提炼的输入上限，请减少参考或上传作者明确截取的片段，不自动截断证据。",422,{referenceKnowledgeSources:"所选正文超过1000000字节输入上限。"});
 return frozen;
}
