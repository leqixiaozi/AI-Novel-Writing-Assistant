import {listRecordCards,requireRecordCard} from '../../database/recordCards';
import type {PoolClient} from "pg";
import type {FieldDefinition,MarketRankingItem} from "../../../common/contracts";
import {selectableTreeNodeIds} from "../../../common/treePolicy";
import type {DebugParameters} from "../../../common/promptComposition";
import type {LoadedCompositionRecipe} from "../../database/promptComposition";
import {getNewDesignPool} from "../../database/runtime";
import {NewDesignError,assertFound} from "../../domain/errors";
import {isPrimaryMarketList} from "../../research/marketSources";
import {debugParametersSchema,type DebugSchemaType,type TaskInputSources} from "./taskInput";

async function frozenTypeFields(client:PoolClient,fields:FieldDefinition[],spaceId:string,typeVersionId:string):Promise<FieldDefinition[]> {
  const result:FieldDefinition[]=[];
  for(const field of fields){
    const source=field.optionSource;
    if(source?.kind!=="dictionary_tree"){result.push({...field,debugTypeVersionId:typeVersionId} as FieldDefinition);continue;}
    const dictionary=await requireRecordCard(client,source.dictionaryId,'dictionary_definition','所选字段字典不可用。');
    if(dictionary.status==='archived'||dictionary.owner_space_id&&dictionary.owner_space_id!==spaceId)throw new NewDesignError('所选字段字典不可用或不属于此书，请重新选择内容类型。',422);
    const items:Record<string,any>[]=[];
    for(const item of (await listRecordCards(client,'dictionary_item',{where:{dictionary_id:dictionary.id}})).sort((a,b)=>a.id.localeCompare(b.id))){const version=await requireRecordCard(client,item.current_version_id,'dictionary_item_version','选项版本不存在。');items.push({...item,path_labels:version.path_labels});}
    const nodes=items.map(item=>({id:item.id,parentId:item.parent_id,status:item.status})),allowed=selectableTreeNodeIds(nodes,source.rule);
    result.push({...field,options:items.filter(item=>allowed.has(item.id)).map(item=>({value:item.id,label:(item.path_labels??[item.label]).join("／")})),debugTypeVersionId:typeVersionId,debugDictionarySnapshot:{id:dictionary.id,revision:dictionary.revision,items:items.map(item=>({id:item.id,versionId:item.current_version_id}))}} as FieldDefinition);
  }
  return result;
}

/** Read-only consistent assembly; no current book facts are changed or auto-selected. */
export async function loadDebugTaskSources(loaded:LoadedCompositionRecipe,parameters:DebugParameters):Promise<TaskInputSources> {
  const p=debugParametersSchema.parse(parameters),bookId=loaded.recipe.context.bookId;
  if(!bookId)throw new NewDesignError("请明确选择一本参考书籍。试运行只读取选中的资料，不写小说内容。",422,{"context.bookId":"请选择参考书籍。"});
  const client=await(await getNewDesignPool()).connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const book=assertFound((await client.query("SELECT space_id,name,description FROM new_design.books WHERE id=$1 AND status='active'",[bookId])).rows[0],"参考书籍不可用，请重新选择。");
    const rows=(await client.query("SELECT type.id,type.type_key,type.name,type.description,type.current_version_id,version.fields FROM new_design.card_types type JOIN new_design.card_type_versions version ON version.id=type.current_version_id WHERE type.space_id=$1 AND type.status='published' ORDER BY type.sort_order,type.id",[book.space_id])).rows;
    const types:DebugSchemaType[]=[];
    for(const row of rows){
      if(p.schemaTypeIds.includes(row.id))types.push({id:row.id,key:row.type_key,name:row.name,description:row.description,fields:await frozenTypeFields(client,row.fields as FieldDefinition[],book.space_id,row.current_version_id)});
      else types.push({id:row.id,key:row.type_key,name:row.name,description:row.description,fields:[]});
    }
    const rankingItems:MarketRankingItem[]=[];
    if(loaded.recipe.taskType==="market_analysis"&&p.rankingSnapshotIds.length){
      const snapshots=(await listRecordCards(client,'market_source_snapshot',{where:{status:'succeeded'}})).filter(row=>p.rankingSnapshotIds.includes(row.id)).sort((a,b)=>a.id.localeCompare(b.id));
      if(snapshots.length!==p.rankingSnapshotIds.length)throw new NewDesignError('部分榜单快照已不可用，请重新选择。',422,{rankingSnapshotIds:'请选择采集成功的来源快照。'});
      const ranks:Record<string,any>[]=[];
      for(const snapshot of snapshots)for(const item of (await listRecordCards(client,'market_ranking_item',{where:{snapshot_id:snapshot.id}})).sort((a,b)=>Number(a.rank)-Number(b.rank)))ranks.push({...item,platform:snapshot.platform,list_key:snapshot.list_key,list_label:snapshot.list_label});
      if(ranks.length>1000)throw new NewDesignError("所选榜单超过1000个项目，请减少来源快照后重新预览。",422);
      for(const row of ranks)rankingItems.push({id:row.id,snapshotId:row.snapshot_id,platform:row.platform,listKey:row.list_key,listLabel:row.list_label,evidenceTier:isPrimaryMarketList(row.list_key)?"primary":"supporting",rank:Number(row.rank),title:row.title,author:row.author,category:row.category,tags:row.tags,synopsis:row.synopsis,heatLabel:row.heat_label,serialStatus:row.serial_status,sourceUrl:row.source_url});
    }
    await client.query("COMMIT");
    return {book:{name:book.name,description:book.description},types,sources:loaded.sources,rankingItems};
  }catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
}
