'use strict';

const {isDeepStrictEqual}=require('node:util');

const COMPLETION_TYPE='legacy.completion_rule_sets';
const GRAPH_TYPE='legacy.graph_projection_mapping_definitions';

// Historical metadata only: migration 044, not a claim that this describes every
// check in today's completionExport implementation. Never replace authored data.
const COMPLETION_DEFAULT={
  rule_set_key:'completion.v1',
  version:1,
  name:'首版完本检查',
  definition:{
    blockers:['missing_adopted_body','chapter_order_gap','chapter_order_duplicate','chapter_not_stable','objective_issue','revision_incomplete'],
    warnings:['unresolved_clue','unconfirmed_fact','pending_proposal','subjective_issue','failed_task','stale_reference','backup_missing','runtime_warning'],
    formalExport:'continuous_stable_from_one',
  },
  status:'published',
};

// Exact 19 mapping definitions from migration 028. Eligibility is historical
// descriptive metadata; current graph projection uses explicit source queries.
const GRAPH_DEFAULTS=new Map([
  ['book','book','vertex','ProjectedNode','有效书籍'],
  ['card','card_version','vertex','ProjectedNode','有效卡片的当前版本'],
  ['chapter_body','chapter_body_version','vertex','ProjectedNode','有效章节的采用正文'],
  ['fact','canonical_fact','vertex','ProjectedNode','已确认且未陈旧事实'],
  ['knowledge','knowledge_state_change','vertex','ProjectedNode','当前人物或读者认知投影'],
  ['state_change','state_change','vertex','ProjectedNode','有效状态变化形成的当前投影'],
  ['state','state_projection','vertex','ProjectedNode','未陈旧当前状态投影'],
  ['story_event','card_version','vertex','ProjectedNode','类型为事件的有效卡片当前版本'],
  ['story_timing','story_event_timing','vertex','ProjectedNode','有效故事时间'],
  ['planning','planning_version','vertex','ProjectedNode','有效规划节点的采用版本'],
  ['research_asset','research_record_version','vertex','ProjectedNode','本书引用的研究版本'],
  ['attachment_asset','asset_version','vertex','ProjectedNode','有效附件资产的采用版本'],
  ['card_relation','card_relation','edge','PROJECTED_RELATION','有效卡片关系'],
  ['story_relation','story_event_relation','edge','PROJECTED_RELATION','有效时间或因果关系'],
  ['story_timing_link','story_event_timing_link','edge','PROJECTED_RELATION','事件卡到有效故事时间的关联'],
  ['planning_parent','planning_parent','edge','PROJECTED_RELATION','有效规划父子关系'],
  ['research_reference','research_reference','edge','PROJECTED_RELATION','本书到研究版本引用'],
  ['research_reference_pack_item','research_reference_pack_item','edge','PROJECTED_RELATION','本书引用包中的研究版本关联'],
  ['asset_mount','asset_mount','edge','PROJECTED_RELATION','有效附件业务挂载'],
].map(([mapping_key,source_kind,element_kind,graph_label,eligibility])=>[
  mapping_key,{mapping_key,source_kind,element_kind,graph_label,eligibility,mapping_version:1,enabled:true},
]));

const LEGACY_METADATA=new Set(['__legacy_table','__legacy_identity','__convergence_category']);

/**
 * Validate unmodified 131 current_values before classifying defaults as read-only
 * migration evidence. This does not delete, rewrite, or normalize source rows.
 * No target records is allowed; a nonempty target set must contain all 20 rows.
 */
function validateHistoricalDefaults(rows){
  if(!Array.isArray(rows))throw new TypeError('Historical defaults must be an array.');
  const targets=rows.filter(row=>row&&(row.type_key===COMPLETION_TYPE||row.type_key===GRAPH_TYPE));
  if(!targets.length)return;
  const seen=new Set();
  for(const row of targets){
    const values=row.current_values;
    if(!values||typeof values!=='object'||Array.isArray(values))throw new Error('Historical default payload must be an object.');
    const completion=row.type_key===COMPLETION_TYPE;
    const expected=completion?COMPLETION_DEFAULT:GRAPH_DEFAULTS.get(values.mapping_key);
    // created_at was generated when 044 ran; it is not a configurable rule value.
    const business=Object.fromEntries(Object.entries(values).filter(([key])=>!LEGACY_METADATA.has(key)&&!(completion&&key==='created_at')));
    if(!expected||!isDeepStrictEqual(business,expected))throw new Error(`Historical default differs from migration ${completion?'044':'028'}; preserve it for explicit migration.`);
    const identity=completion?COMPLETION_TYPE:`${GRAPH_TYPE}:${values.mapping_key}`;
    if(seen.has(identity))throw new Error('Duplicate historical default identity.');
    seen.add(identity);
  }
  if(!seen.has(COMPLETION_TYPE)||seen.size!==GRAPH_DEFAULTS.size+1)throw new Error('Historical default set is incomplete; expected 1 completion rule and 19 graph mappings.');
}

module.exports={validateHistoricalDefaults};
