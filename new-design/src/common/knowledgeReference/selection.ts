import type {KnowledgeReferenceInput} from "./index";
export type KnowledgeSourceSelection=KnowledgeReferenceInput["sources"][number];
/** URL data proposes a selection only; the server and picker must still match real current candidates. */
export function knowledgeSelectionFromQuery(query:URLSearchParams):KnowledgeSourceSelection|null{
 const names=["knowledgeAsset","sourceVersion","parsedVersion","checksum"] as const;
 if(names.every(name=>!query.has(name)))return null;
 for(const name of names)if(query.getAll(name).length!==1)throw new Error("知识来源参数不完整或重复，请返回知识参考重新选择。");
 const [assetId,sourceVersionId,parsedVersionId,checksum]=names.map(name=>query.get(name)!);
 const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
 if(![assetId,sourceVersionId,parsedVersionId].every(value=>uuid.test(value))||!/^[a-f0-9]{64}$/.test(checksum))throw new Error("知识精确来源参数格式不正确，请返回知识参考重新选择。");
 return{assetId,sourceVersionId,parsedVersionId,checksum};
}
export function sameKnowledgeSelection(a:KnowledgeSourceSelection,b:KnowledgeSourceSelection):boolean{return a.assetId===b.assetId&&a.sourceVersionId===b.sourceVersionId&&a.parsedVersionId===b.parsedVersionId&&a.checksum===b.checksum;}
