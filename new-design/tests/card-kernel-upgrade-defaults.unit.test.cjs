'use strict';

const {test}=require('node:test');
const assert=require('node:assert/strict');
const {validateHistoricalDefaults}=require('../scripts/card-kernel-upgrade-defaults.cjs');

// Independent fixture copied from 028 and 044; do not import the validator's
// expected values, which would make accidental changes validate themselves.
function originalRows(){
  const completion={type_key:'legacy.completion_rule_sets',current_values:{
    rule_set_key:'completion.v1',version:1,name:'首版完本检查',status:'published',
    definition:{
      blockers:['missing_adopted_body','chapter_order_gap','chapter_order_duplicate','chapter_not_stable','objective_issue','revision_incomplete'],
      warnings:['unresolved_clue','unconfirmed_fact','pending_proposal','subjective_issue','failed_task','stale_reference','backup_missing','runtime_warning'],
      formalExport:'continuous_stable_from_one',
    },
    created_at:'2026-09-16T02:46:47.817Z',
  }};
  const mappings=[
    ['book','book','有效书籍'],
    ['card','card_version','有效卡片的当前版本'],
    ['chapter_body','chapter_body_version','有效章节的采用正文'],
    ['fact','canonical_fact','已确认且未陈旧事实'],
    ['knowledge','knowledge_state_change','当前人物或读者认知投影'],
    ['state_change','state_change','有效状态变化形成的当前投影'],
    ['state','state_projection','未陈旧当前状态投影'],
    ['story_event','card_version','类型为事件的有效卡片当前版本'],
    ['story_timing','story_event_timing','有效故事时间'],
    ['planning','planning_version','有效规划节点的采用版本'],
    ['research_asset','research_record_version','本书引用的研究版本'],
    ['attachment_asset','asset_version','有效附件资产的采用版本'],
    ['card_relation','card_relation','有效卡片关系'],
    ['story_relation','story_event_relation','有效时间或因果关系'],
    ['story_timing_link','story_event_timing_link','事件卡到有效故事时间的关联'],
    ['planning_parent','planning_parent','有效规划父子关系'],
    ['research_reference','research_reference','本书到研究版本引用'],
    ['research_reference_pack_item','research_reference_pack_item','本书引用包中的研究版本关联'],
    ['asset_mount','asset_mount','有效附件业务挂载'],
  ].map(([mapping_key,source_kind,eligibility],index)=>({
    type_key:'legacy.graph_projection_mapping_definitions',
    current_values:{mapping_key,source_kind,eligibility,element_kind:index<12?'vertex':'edge',graph_label:index<12?'ProjectedNode':'PROJECTED_RELATION',mapping_version:1,enabled:true},
  }));
  return [completion,...mappings];
}

test('the complete original defaults are accepted without changing input',()=>{
  const rows=originalRows();
  for(const row of rows)Object.assign(row.current_values,{
    __legacy_table:row.type_key.slice('legacy.'.length),
    __legacy_identity:row.current_values.mapping_key?{mapping_key:row.current_values.mapping_key}:{rule_set_key:'completion.v1',version:1},
    __convergence_category:'infrastructure',
  });
  const before=structuredClone(rows);
  assert.equal(validateHistoricalDefaults(rows),undefined);
  assert.deepEqual(rows,before);
  assert.doesNotThrow(()=>validateHistoricalDefaults([...rows].reverse()));
});

test('no target records is allowed and unrelated types are not interpreted',()=>{
  assert.doesNotThrow(()=>validateHistoricalDefaults([]));
  assert.doesNotThrow(()=>validateHistoricalDefaults([{type_key:'legacy.author_record',current_values:{custom:true}}]));
  assert.doesNotThrow(()=>validateHistoricalDefaults([...originalRows(),{type_key:'legacy.author_record',current_values:null}]));
});

test('every missing original row or entire group is rejected',()=>{
  const rows=originalRows();
  for(let index=0;index<rows.length;index++)assert.throws(()=>validateHistoricalDefaults(rows.filter((_,position)=>position!==index)),/incomplete/);
  assert.throws(()=>validateHistoricalDefaults([rows[0]]),/incomplete/);
});

test('duplicate completion and graph identities are rejected',()=>{
  for(const index of [0,1,19]){
    const rows=originalRows();
    assert.throws(()=>validateHistoricalDefaults([...rows,structuredClone(rows[index])]),/Duplicate/);
  }
});

test('completion identity, labels, status and definition must match exactly',()=>{
  const mutations=[
    value=>{value.rule_set_key='custom';},value=>{value.version=2;},
    value=>{value.name='custom';},value=>{value.status='retired';},
    value=>{value.definition.blockers.pop();},value=>{value.definition.warnings.push('custom');},
    value=>{value.definition.formalExport='custom';},value=>{value.definition.extra=true;},
    value=>{value.custom=true;},value=>{delete value.status;},
  ];
  for(const mutate of mutations){const rows=originalRows();mutate(rows[0].current_values);assert.throws(()=>validateHistoricalDefaults(rows),/differs from migration 044/);}
});

test('graph identities and every configurable mapping field must match exactly',()=>{
  const changes={mapping_key:'custom',source_kind:'custom',element_kind:'edge',graph_label:'CustomNode',eligibility:'custom',mapping_version:2,enabled:false,custom:true};
  for(const [key,value] of Object.entries(changes)){
    const rows=originalRows();rows[1].current_values[key]=value;
    assert.throws(()=>validateHistoricalDefaults(rows),/differs from migration 028/);
  }
  const rows=originalRows();delete rows[1].current_values.enabled;
  assert.throws(()=>validateHistoricalDefaults(rows),/differs from migration 028/);
});

test('unknown graph records and malformed target payloads cannot pass as defaults',()=>{
  const rows=originalRows();
  assert.throws(()=>validateHistoricalDefaults([...rows,{type_key:'legacy.graph_projection_mapping_definitions',current_values:{mapping_key:'custom'}}]),/differs from migration 028/);
  for(const payload of [null,undefined,[],42,'text']){
    const invalid=originalRows();invalid[0].current_values=payload;
    assert.throws(()=>validateHistoricalDefaults(invalid),/payload must be an object/);
  }
  assert.throws(()=>validateHistoricalDefaults(null),/must be an array/);
});
