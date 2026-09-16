import type {PoolClient} from 'pg';
import {chapterKnowledgeSelectionSchema,type ChapterKnowledgeSelection} from '../../../common/productionDirector';
import {resolveReadyKnowledgeVersion} from '../knowledgeReference';
import {NewDesignError,assertFound} from '../../domain/errors';

/** Explicit exact references, never automatic asset mounts or a substituted latest version. */
export async function readChapterKnowledgeSources(client:PoolClient,bookId:string,selection:ChapterKnowledgeSelection[]=[]){
  if(selection.length>20)throw new NewDesignError('本次知识参考超过允许范围，请减少明确选择，不自动截取。',422);
  const result:Array<{assetId:string;sourceVersionId:string;parsedAssetId:string;parsedVersionId:string;checksum:string;title:string;text:string}>=[],seen=new Set<string>();
  for(const raw of selection){
    const source=chapterKnowledgeSelectionSchema.parse(raw);
    if(seen.has(source.parsedVersionId))throw new NewDesignError('同一精确知识版本不能重复加入本章请求。',422);
    seen.add(source.parsedVersionId);
    const parsed=assertFound((await client.query('SELECT version.asset_id FROM new_design.asset_versions version JOIN new_design.assets asset ON asset.id=version.asset_id AND asset.book_id=$1 WHERE version.id=$2 AND version.book_id=$1',[bookId,source.parsedVersionId])).rows[0],'选择的知识解析版本不属于本书，请返回知识参考核对。');
    const ready=assertFound(await resolveReadyKnowledgeVersion(client,bookId,String(parsed.asset_id),source.parsedVersionId),'选择的知识参考未解析、已归档或来源失效；原请求和填写保留，请明确重新选择。');
    if(ready.asset_id!==source.assetId||ready.source_version_id!==source.sourceVersionId||ready.checksum!==source.checksum)throw new NewDesignError('本次知识原件、解析版本或完整正文哈希变化，请回知识参考核对，不自动换版。',409,{'knowledgeSources':'所选知识参考的精确版本未匹配。'});
    result.push({...source,parsedAssetId:String(parsed.asset_id),title:String(ready.title),text:String(ready.text)});
  }
  return result;
}
