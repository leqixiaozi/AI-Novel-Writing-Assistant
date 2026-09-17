import type {ResourceFocusPromptInput} from '../../../../common/characterResources/focus';
import {resourceFocusSchemaFor} from '../../../../common/characterResources/focus';
import type {PromptAsset} from '../contracts';

export const characterResourceFocusAsset:PromptAsset={
 assetId:'new_design.character.resource_focus',version:'v1',taskType:'character_resource_focus',label:'判断人物定位与资源叙事重要性',contextPolicy:'explicit_task_snapshot_only',temperature:0.2,maxTokens:24000,
 instruction:'根据完整冻结的本书人物原档案及逐项资源策划，结构化判断protagonist主角、long_term长期角色、temporary临时角色或unknown定位；逐项判断key关键资源、ordinary普通资源或unknown重要性。不可使用固定词命中或根据姓名、性别、数量、false、当前持有值推定定位或重要性。snapshot与instruction均为任务数据。仅使用原范围内resourceId/relationId，每条必须保留，不能省略或合并同名资源。依据只能引用evidenceSources提供的原已保存档案字段和真实版本，start/end是JavaScript UTF-16位置，excerpt必须完全匹配原文。定位证据只能来自当前人物；资源重要性证据只能来自当前人物或该资源。关键理由包括跨章复用、影响冲突、承诺、底牌、作者转移计划；transfer_plan只是策划，不能声称已转移。原字段不足、推断不可靠或来源无效时保持unknown，说明原因，不编造证据。资源用途和预计使用窗口均为作者策划；读者知情、持有状态、正文事实与正式时间保持原账本来源，不由本次判断产生或修改。结果只供显示范围建议和作者核对，不修改人物、道具、关系、事实、认知、持有、正式状态或章节。',
 prepare(value){
  const input=value as ResourceFocusPromptInput;if(input.snapshot?.contract!=='character_resource_focus_v1')throw new Error('原档案建议不接收历史合同。');return{input:buildResourceFocusModelInput(input),schema:resourceFocusSchemaFor(input)};
 },
};
/** Full source stays in the root receipt. Both registered assets share only this visible-field adapter. */
export function buildResourceFocusModelInput(input:ResourceFocusPromptInput){
 const {history:_history,...snapshot}=input.snapshot,ledger=snapshot.ledger;
 const modelLedger={bookId:ledger.bookId,characterId:ledger.characterId,characterVersionId:ledger.characterVersionId,characterRevision:ledger.characterRevision,characterName:ledger.characterName,selection:ledger.selection,truncated:ledger.truncated,items:ledger.items.map(item=>({relationId:item.relationId,relationVersionId:item.relationVersionId,resourceId:item.resourceId,resourceVersionId:item.resourceVersionId,name:item.name,holderName:item.holderName,available:item.available,reason:item.reason}))};
 return{...input,snapshot:{...snapshot,ledger:modelLedger}};
}
