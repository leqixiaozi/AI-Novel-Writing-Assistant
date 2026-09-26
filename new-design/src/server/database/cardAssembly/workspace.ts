import {NewDesignError} from '../../domain/errors';
import {getNewDesignPool} from '../runtime';
import {listRecordCards} from '../recordCards';

export async function getBookAssemblyWorkspace(bookId:string){
  const db=await getNewDesignPool();
  const book=(await db.query('SELECT id,name,description,revision,space_id,root_card_id,root_node_id,template_version_id FROM new_design.books WHERE id=$1',[bookId])).rows[0];
  if(!book)throw new NewDesignError('书籍不存在。',404);
  if(!book.root_card_id)return{bookId,legacy:true,bookName:String(book.name),root:null,modules:[],slots:[],relations:[]};
  const spaceId=String(book.space_id);
  const [modules,slots,relations,metaVersions,metaDefinitions]=await Promise.all([
    listRecordCards(db,'book_template_module_instance',{spaceId,where:{book_id:bookId}}),
    listRecordCards(db,'book_template_slot',{spaceId,where:{book_id:bookId}}),
    listRecordCards(db,'book_template_pending_relation',{spaceId,where:{book_id:bookId}}),
    listRecordCards(db,'meta_card_version',{includeArchived:true}),
    listRecordCards(db,'meta_card',{includeArchived:true}),
  ]);
  const root=(await db.query('SELECT id,title,revision,values,current_version_id FROM new_design.cards WHERE id=$1 AND space_id=$2',[book.root_card_id,spaceId])).rows[0];
  const snapshot=(await listRecordCards(db,'book_assembly_snapshot',{spaceId,where:{book_id:bookId}}))[0];
  const metaById=new Map(metaVersions.map(row=>[row.id,row]));
  const metaNames=new Map(metaDefinitions.map(row=>[row.id,String(row.name)]));
  const [relationTypes,filledCards,cardTemplates,activeRelations,availableRelationTypes,bookRelations]=await Promise.all([
    db.query('SELECT id,name,properties_schema FROM new_design.relation_type_versions WHERE id=ANY($1::uuid[])',[relations.map(row=>row.relation_type_version_id).filter(Boolean)]).then(result=>result.rows),
    db.query('SELECT id,title FROM new_design.cards WHERE id=ANY($1::uuid[]) AND space_id=$2',[slots.map(row=>row.card_id).filter(Boolean),spaceId]).then(result=>result.rows),
    listRecordCards(db,'card_template',{includeArchived:true}),
    db.query("SELECT id FROM new_design.card_relations WHERE id=ANY($1::uuid[]) AND space_id=$2 AND status='active'",[relations.map(row=>row.relation_id).filter(Boolean),spaceId]).then(result=>result.rows),
    db.query(`SELECT version.id,version.name,version.direction,version.properties_schema,version.source_type_keys,version.target_type_keys
      FROM new_design.relation_type_versions version JOIN new_design.relation_types type ON type.id=version.relation_type_id
      WHERE type.owner_space_id=$1 AND type.status='published' AND version.status='published'
        AND version.id=type.current_version_id AND version.source_version_id IS NOT NULL ORDER BY version.name`,[spaceId]).then(result=>result.rows),
    db.query(`SELECT relation.id,relation.source_card_id,relation.target_card_id,version.name,relation.properties
      FROM new_design.card_relations relation JOIN new_design.relation_type_versions version ON version.id=relation.relation_type_version_id
      WHERE relation.space_id=$1 AND relation.status='active' AND relation.source_card_id=ANY($2::uuid[]) AND relation.target_card_id=ANY($2::uuid[])`,
      [spaceId,slots.map(row=>row.card_id).filter(Boolean)]).then(result=>result.rows),
  ]);
  const relationSpecs=new Map(relationTypes.map(row=>[String(row.id),row]));
  const cardTitles=new Map(filledCards.map(row=>[String(row.id),String(row.title)]));
  const templateNames=new Map(cardTemplates.map(row=>[String(row.id),String(row.name)]));
  const activeRelationIds=new Set(activeRelations.map(row=>String(row.id)));
  const relationStatus=(row:Record<string,any>)=>row.status==='confirmed'?(activeRelationIds.has(String(row.relation_id))?'confirmed' as const:'invalidated' as const):'pending' as const;
  return{bookId,legacy:false,bookName:String(book.name),bookRevision:Number(book.revision),templateVersionId:String(book.template_version_id),
    root:{id:String(root.id),nodeId:String(book.root_node_id),title:String(root.title),revision:Number(root.revision),values:root.values,metaVersionId:snapshot?.assembly?.root?.metaVersionId??null,
      fields:metaById.get(snapshot?.assembly?.root?.metaVersionId)?.fields??[]},
    modules:modules.map(row=>{const members=slots.filter(slot=>slot.module_instance_id===row.id),links=relations.filter(relation=>relation.module_instance_id===row.id),pendingRequiredSlots=members.filter(slot=>slot.required&&slot.status!=='filled').length,pendingRequiredRelations=links.filter(relation=>relation.required&&relationStatus(relation)!=='confirmed').length;return{id:row.id,moduleRefNodeId:row.module_ref_node_id,ordinal:Number(row.ordinal),sourceCardTemplateVersionId:row.source_card_template_version_id,displayName:members.filter(slot=>slot.card_id).map(slot=>cardTitles.get(String(slot.card_id))).find(Boolean)??`实例 ${row.ordinal}`,complete:pendingRequiredSlots===0&&pendingRequiredRelations===0,pendingRequiredSlots,pendingRequiredRelations}}),
    slots:slots.map(row=>({id:row.id,nodeId:row.node_id,moduleInstanceId:row.module_instance_id,sourceNodeId:row.source_node_id,metaVersionId:row.meta_version_id,name:metaNames.get(String(metaById.get(String(row.meta_version_id))?.meta_id))??'待填元卡片',cardTitle:cardTitles.get(String(row.card_id))??undefined,required:row.required,status:row.status,cardId:row.card_id,revision:Number(row.revision),fields:metaById.get(String(row.meta_version_id))?.fields??[]})),
    relations:relations.map(row=>({id:row.id,fromNodeId:row.from_node_id,toNodeId:row.to_node_id,moduleInstanceId:row.module_instance_id,sourceEdgeId:row.source_edge_id,relationTypeVersionId:row.relation_type_version_id,name:relationSpecs.get(String(row.relation_type_version_id))?.name??row.label,fields:relationSpecs.get(String(row.relation_type_version_id))?.properties_schema??[],status:relationStatus(row),required:row.required,revision:Number(row.revision),relationId:row.relation_id})),
    availableRelationTypes:availableRelationTypes.map(row=>({id:String(row.id),name:String(row.name),direction:String(row.direction),fields:row.properties_schema,sourceTypeKeys:row.source_type_keys,targetTypeKeys:row.target_type_keys})),
    instanceRelations:bookRelations.filter(row=>!relations.some(pending=>String(pending.relation_id)===String(row.id))).map(row=>({id:String(row.id),fromSlotId:slots.find(slot=>String(slot.card_id)===String(row.source_card_id))?.id??'',toSlotId:slots.find(slot=>String(slot.card_id)===String(row.target_card_id))?.id??'',name:String(row.name),properties:row.properties})),
    moduleReferences:(snapshot?.assembly?.modules??[]).map((item:Record<string,unknown>)=>({...item,name:templateNames.get(String(item.cardTemplateId))??'组合模块'})),
  };
}
