import {NewDesignError} from '../../domain/errors';
import {getNewDesignPool} from '../runtime';

type ContextImpact={resourceId:string;state:string;reason:string;createdAt:string};
type ImpactRow={resource_id:string;state:string;reason:string|null;created_at:Date|string|null};

/** Read dependency status from card records; never rebuild or mutate the source. */
export async function getContextImpacts(input:{bookId:string;bindingId?:string;previewId?:string}):Promise<ContextImpact[]>{
  const stableId=input.bindingId??input.previewId;
  if(!stableId)throw new NewDesignError('请选择上下文规则或装配预览。',422);
  const pool=await getNewDesignPool();
  const result=await pool.query<ImpactRow>(`
    SELECT resource.id resource_id,state_version.values->>'state' state,
           reason.reason,reason.created_at
    FROM new_design.dependency_resources resource
    JOIN new_design.card_types state_type ON state_type.type_key='dependency_resource_state'
    JOIN new_design.cards state ON state.card_type_id=state_type.id AND state.status='active'
    JOIN new_design.card_versions state_version
      ON state_version.id=state.current_version_id AND state_version.card_id=state.id
     AND state_version.values->>'resource_id'=resource.id::text
     AND state_version.values->>'book_id'=resource.book_id::text
    LEFT JOIN LATERAL (
      SELECT version.values->>'reason' reason,(version.values->>'created_at')::timestamptz created_at
      FROM new_design.cards card
      JOIN new_design.card_types type ON type.id=card.card_type_id AND type.type_key='dependency_stale_reason'
      JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id
      WHERE card.status='active' AND version.values->>'resource_id'=resource.id::text
        AND version.values->>'book_id'=resource.book_id::text
      ORDER BY (version.values->>'created_at')::timestamptz DESC,card.id DESC
      LIMIT 1
    ) reason ON true
    WHERE resource.book_id=$1 AND resource.resource_kind=$2 AND resource.stable_object_id=$3
    ORDER BY resource.id`,[input.bookId,input.bindingId?'context_binding_version':'context_preview',stableId]);
  return result.rows.map(row=>({
    resourceId:row.resource_id,state:row.state,reason:row.reason??'',
    createdAt:row.created_at?new Date(row.created_at).toISOString():'',
  }));
}
