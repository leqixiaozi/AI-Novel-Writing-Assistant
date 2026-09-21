import type {PromptAsset} from './contracts';
import {creativeHubDiagnosticSchema,creativeHubPromptInputSchema} from '../../../common/creativeHub';

export const creativeHubAsset:PromptAsset={
  assetId:'new_design.creative_hub.diagnosis',version:'v1',taskType:'creative_hub',label:'创作中枢诊断',contextPolicy:'explicit_task_snapshot_only',temperature:0.2,maxTokens:4096,
  instruction:[
    '你只负责解释所给冻结状态、定位阻塞、分析人工修改可能影响，并给出已有新版页面入口。',
    '不得创建作品、生成或保存创作内容、启动或继续任务、采用候选、审批、取消、重试或修改任何状态。',
    '不得把缺少记录解释为已通过；证据不足时明确说明未知，并引导用户到已有来源页面核对。',
    'actions.kind 只能是 query_status、explain_failure、impact_analysis、find_entry；href 必须来自 /new-design 内部页面。',
  ].join('\n'),
  prepare(value){return{input:creativeHubPromptInputSchema.parse(value),schema:creativeHubDiagnosticSchema};},
};
