import {createHash} from "node:crypto";
import type {PoolClient} from "pg";
import {knowledgeSegmentSchema} from "../../../../common/knowledgeIndex/segments";
import {NewDesignError,assertFound} from "../../../domain/errors";

/** Validate against the original parsed text; never replace a missing segment with full text. */
export async function resolveKnowledgeReferenceSegment(client:Pick<PoolClient,"query">,bookId:string,parsedAssetId:string,parsedVersionId:string,checksum:string,text:string,value:unknown):Promise<string>{
 const segment=knowledgeSegmentSchema.parse(value);
 const chunk=assertFound((await client.query(`SELECT chunk.chunk_text,chunk.anchor FROM new_design.embedding_chunks chunk
 JOIN new_design.embedding_source_snapshots snapshot ON snapshot.id=chunk.source_snapshot_id AND snapshot.book_id=chunk.book_id AND snapshot.profile_version_id=chunk.profile_version_id AND snapshot.status='current'
 JOIN new_design.books book ON book.id=snapshot.book_id AND book.space_id=snapshot.space_id
 JOIN new_design.dependency_resources snapshot_resource ON snapshot_resource.resource_kind='embedding_source_snapshot' AND snapshot_resource.stable_object_id=snapshot.id AND snapshot_resource.exact_version_id=snapshot.id AND snapshot_resource.book_id=book.id AND snapshot_resource.space_id=book.space_id AND snapshot_resource.content_hash=snapshot.source_hash
 JOIN new_design.dependency_resource_states snapshot_state ON snapshot_state.resource_id=snapshot_resource.id AND snapshot_state.book_id=book.id AND snapshot_state.state IN ('fresh','recomputed')
 JOIN new_design.dependency_resources chunk_resource ON chunk_resource.resource_kind='embedding_chunk' AND chunk_resource.stable_object_id=chunk.id AND chunk_resource.exact_version_id=chunk.id AND chunk_resource.book_id=book.id AND chunk_resource.space_id=book.space_id AND chunk_resource.content_hash=chunk.content_hash
 JOIN new_design.dependency_resource_states chunk_state ON chunk_state.resource_id=chunk_resource.id AND chunk_state.book_id=book.id AND chunk_state.state IN ('fresh','recomputed')
 WHERE chunk.id=$1 AND chunk.book_id=$2 AND snapshot.book_id=$2 AND chunk.status='current' AND chunk.anchor_kind='character_range' AND snapshot.source_kind='asset_parsed_text' AND snapshot.source_stable_id=$3 AND snapshot.source_version_id=$4 AND snapshot.source_hash=$5`,[segment.chunkId,bookId,parsedAssetId,parsedVersionId,checksum])).rows[0],"原检索段落已失效、缺少有效状态或不属于此书；旧引用保留，请重新上传解析参考或明确保存新嵌入规格后准备分块，不能用全文或其他段落替代。");
 const selected=text.slice(segment.start,segment.end);
 if(segment.end>text.length||chunk.anchor?.start!==segment.start||chunk.anchor?.end!==segment.end||selected!==chunk.chunk_text||createHash("sha256").update(selected,"utf8").digest("hex")!==segment.checksum)throw new NewDesignError("知识段落的精确字位、原分块或校验已变化，请重新选择原段落。",409);
 return selected;
}
