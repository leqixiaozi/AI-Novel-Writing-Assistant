import { z } from "zod";
import { getNewDesignPool } from "../../../database/runtime";
import { readFrozenSupplementSource } from "../../../database/chapterSettlement";
import { assertFound, NewDesignError } from "../../../domain/errors";
import { preparePrompt, type PreparedPrompt } from "../../prompts";

/** Internal read-only preparation. No claim, publication, model or candidate write. */
export async function prepareStableResourceSupplementPrompt(sessionId: string): Promise<PreparedPrompt> {
  z.string().uuid().parse(sessionId);
  const pool = await getNewDesignPool(), client = await pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const row = assertFound((await client.query(`SELECT session.*,body.content_hash AS body_hash
      FROM new_design.chapter_adoption_sessions session
      JOIN new_design.books book ON book.id=session.book_id AND book.status='active'
      JOIN new_design.chapter_documents document ON document.id=session.chapter_document_id
        AND document.book_id=book.id AND document.status='active' AND document.adopted_version_id=session.body_version_id
      JOIN new_design.chapter_body_versions body ON body.id=session.body_version_id
        AND body.chapter_document_id=document.id AND body.archived_at IS NULL
      WHERE session.id=$1`,[sessionId])).rows[0],"原补充会话或采用正文不可用，请保留原请求核对。");
    if (row.adoption_kind !== "resource_supplement"
      || !["adopted_pending_proposals","pending_review","partially_confirmed","failed"].includes(row.status))
      throw new NewDesignError("请选择待核对的稳定章资源补充清单。",409);
    const source = await readFrozenSupplementSource(client,row,String(row.body_hash));
    const prompt = preparePrompt("stable_resource_supplement",{sessionId,sessionRevision:Number(row.revision),source});
    await client.query("COMMIT");
    return prompt;
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch { /* No mutation or model invocation. */ }
    throw error;
  } finally { client.release(); }
}
