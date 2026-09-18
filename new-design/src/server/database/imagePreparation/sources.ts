import type {PoolClient} from 'pg';
import type {ImageMaterialScope,ImageMaterialSource} from '../../../common/imagePreparation';
import {readSource} from '../publicCharacters/repository';
import {stableHash} from '../aiContracts';
import {assertFound,NewDesignError} from '../../domain/errors';
export async function readImageMaterials(client:PoolClient,scope:ImageMaterialScope):Promise<ImageMaterialSource>{
 let data:Record<string,unknown>;
 if(scope.kind==='public_character')data={profile:await readSource(client,scope.resourceId,scope.resourceVersionId)};
 else{
  const book=assertFound((await client.query("SELECT id,name,description,revision,space_id FROM new_design.books WHERE id=$1 AND status='active' FOR SHARE",[scope.bookId])).rows[0],'本书不存在或已归档。');
  const cards=(await client.query(`SELECT card.id,version.id "versionId",version.title,version.type_version_id "typeVersionId",version.values,spec.fields,
   COALESCE((SELECT jsonb_agg(jsonb_build_object('definitionId',definition.id,'versionId',local_spec.id,'field',local_spec.field_schema,'value',local.value) ORDER BY definition.field_key) FROM new_design.card_version_local_values local JOIN new_design.field_definitions definition ON definition.id=local.field_definition_id JOIN new_design.field_definition_versions local_spec ON local_spec.id=local.field_definition_version_id AND local_spec.field_definition_id=definition.id WHERE local.card_version_id=version.id),'[]'::jsonb) "localFields"
   FROM new_design.cards card JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id JOIN new_design.card_type_versions spec ON spec.id=version.type_version_id WHERE card.space_id=$1 AND card.status='active' ORDER BY card.id LIMIT 1001`,[book.space_id])).rows;
  const plans=(await client.query("SELECT object.id,version.id \"versionId\",object.level,object.title,version.content,version.content_hash \"contentHash\" FROM new_design.planning_objects object JOIN new_design.planning_versions version ON version.id=object.adopted_version_id AND version.object_id=object.id WHERE object.book_id=$1 AND object.status='active' AND object.level='story' AND version.status='adopted' AND version.stale_at IS NULL ORDER BY object.id",[scope.bookId])).rows;
  if(cards.length>1000)throw new NewDesignError('资料超过完整图片草稿范围，请先确定较小范围，不截断资料。',422);
  data={book:{id:book.id,name:book.name,description:book.description,revision:Number(book.revision)},cards,plans};
 }
 if(JSON.stringify(data).length>1000000)throw new NewDesignError('完整图片资料超过优化范围，不截断或省略来源。',422);
 return{scope,data,hash:stableHash({scope,data})};
}
