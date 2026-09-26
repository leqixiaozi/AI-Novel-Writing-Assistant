import type {PoolClient} from 'pg';
import {NewDesignError,assertFound} from '../../domain/errors';
import {createRecordCard,listRecordCards} from '../recordCards';
import {updateProductionRecords} from '../chapterProduction/persistence';
import {guardImagePreparation} from './guard';
export {imagePromptPreparationRows,cardVersionLocalValueRows,planningObjectRows,planningVersionRows} from '../worldConsistency/rows';
export {readCardWorkflowCapability,requireCardWorkflowTypes} from '../cardWorkflow';

export async function insertImagePreparationRecords(client:PoolClient,type:string,select:string,parameters:unknown[],keys:string[][]){
  if(type!=='image_prompt_preparation')throw new NewDesignError('图片优化记录类型不匹配。',500);
  const rows=[];
  for(const values of(await client.query(select,parameters)).rows){
    await guardImagePreparation(client,values);
    for(const key of keys)if((await listRecordCards(client,type,{where:Object.fromEntries(key.map(field=>[field,values[field]])),includeArchived:true})).length)throw new NewDesignError('图片优化原键或领取已经存在，不重复生成。',409);
    if((await listRecordCards(client,type,{where:{scope_id:values.scope_id,status:'running'}})).length)throw new NewDesignError('此来源有原优化领取未结束。',409);
    const task=assertFound((await client.query('SELECT space_id FROM new_design.ai_tasks WHERE id=$1',[values.id])).rows[0],'原图片优化任务不存在。');
    rows.push(await createRecordCard(client,{id:values.id,spaceId:String(task.space_id),typeKey:type,title:'原图片画面优化',values}));
  }
  return{rows,rowCount:rows.length};
}
export async function updateImagePreparationRecords(client:PoolClient,type:string,select:string,parameters:unknown[],identity:string[]){
  if(type!=='image_prompt_preparation')throw new NewDesignError('图片优化记录类型不匹配。',500);
  for(const row of(await client.query(select,parameters)).rows)await guardImagePreparation(client,{...row.record_values,...row.record_patch},row.record_values);
  return updateProductionRecords(client,type,select,parameters,identity);
}
