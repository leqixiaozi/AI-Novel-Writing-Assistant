import {settlementRecordCtes} from '../recordStorage';
import type {PoolClient} from 'pg';
import {z} from 'zod';
import {NewDesignError} from '../../../domain/errors';

type Row=Record<string,any>;
const ids=z.array(z.string().uuid()).refine(values=>new Set(values).size===values.length);
/** A merged checkpoint may retain actual confirmed records from several settlements. */
export async function readCheckpointConfirmedStateChanges(client:PoolClient,checkpoint:Row):Promise<{records:Row[];effective:Row[]}>{
  const parsed=ids.safeParse(checkpoint.summary?.confirmed?.states);
  if(!parsed.success)throw new NewDesignError('稳定检查点缺少完整状态确认清单，请核对原结算，不能按最新投影补齐。',409);
  const records=(await client.query(`WITH ${settlementRecordCtes.state_changes},
${settlementRecordCtes.state_change_proposals}
SELECT change.* FROM state_changes change
    JOIN new_design.chapter_settlements settlement ON settlement.id=change.settlement_id AND settlement.book_id=change.book_id
      AND settlement.chapter_document_id=change.chapter_document_id AND settlement.body_version_id=change.body_version_id AND settlement.status='committed'
    JOIN state_change_proposals proposal ON proposal.id=change.proposal_id AND proposal.book_id=change.book_id
      AND proposal.chapter_document_id=change.chapter_document_id AND proposal.body_version_id=change.body_version_id
      AND proposal.subject_kind=change.subject_kind AND proposal.subject_id=change.subject_id AND proposal.state_key=change.state_key
      AND proposal.status='confirmed' AND proposal.confirmed_state_change_id=change.id AND proposal.after_json=change.after_json
    LEFT JOIN new_design.text_anchors anchor ON anchor.id=change.text_anchor_id
    WHERE change.book_id=$1 AND change.chapter_document_id=$2 AND change.body_version_id=$3 AND change.status='active'
      AND change.id=ANY($4::uuid[]) AND (change.text_anchor_id IS NULL OR (anchor.status='active' AND anchor.book_id=change.book_id
        AND anchor.chapter_document_id=change.chapter_document_id AND anchor.body_version_id=change.body_version_id))
    ORDER BY change.sequence`,[checkpoint.book_id,checkpoint.chapter_document_id,checkpoint.body_version_id,parsed.data])).rows as Row[];
  if(records.length!==parsed.data.length)throw new NewDesignError('稳定检查点状态存在失效或越章来源，请保留原确认历史核对。',409);
  const effective=new Map<string,Row>();
  for(const record of records)effective.set(JSON.stringify([record.subject_kind,record.subject_id,record.state_key]),record);
  return {records,effective:[...effective.values()]};
}
