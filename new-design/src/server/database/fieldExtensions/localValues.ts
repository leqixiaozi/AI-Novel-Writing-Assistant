import type {RecordCardDb} from '../recordCards';
import {listRecordCards} from '../recordCards';

/** Values belong to the exact author version; current definitions only control visibility. */
export async function readCardLocalSnapshot(db:RecordCardDb,cardVersionId:string){
  const rows=await listRecordCards(db,'card_version_local_value',{where:{card_version_id:cardVersionId}});
  if(!rows.length)return [];
  const definitions=(await db.query("SELECT id,field_key FROM new_design.field_definitions WHERE id=ANY($1::uuid[]) AND scope='card' AND status='active'",[rows.map(row=>row.field_definition_id)])).rows;
  return rows.flatMap(row=>{const definition=definitions.find(item=>item.id===row.field_definition_id);return definition?[{...row,field_key:String(definition.field_key)}]:[];});
}
