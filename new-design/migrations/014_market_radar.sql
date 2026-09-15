SET search_path TO new_design, public;

INSERT INTO card_spaces (id,space_key,name)
VALUES ('70000000-0000-4000-8000-000000000001','resource_research','研究信号资源')
ON CONFLICT (space_key) DO NOTHING;

INSERT INTO card_types (id,space_id,type_key,name,description,status,revision,current_version_id,draft_fields,is_system,sort_order,semantic_capabilities,category_id)
VALUES (
  '71000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001','market_signal','市场信号',
  '保存经作者确认的市场观察、拥挤度、趋势、受众、差异化机会与精确来源版本；不代表创作事实，也不会自动开书。',
  'published',1,'72000000-0000-4000-8000-000000000001',$json$[
    {"key":"signal_type","name":"信号类型","description":"本条市场结论关注的方向","type":"select","required":true,"defaultValue":"genre","options":[{"value":"genre","label":"题材"},{"value":"protagonist","label":"主角身份"},{"value":"advantage","label":"核心优势"},{"value":"opening","label":"开局方式"},{"value":"relationship","label":"关系钩子"},{"value":"title","label":"标题模式"},{"value":"payoff","label":"读者满足"},{"value":"crowding","label":"拥挤套路"},{"value":"differentiation","label":"差异化机会"}],"group":"信号","order":0},
    {"key":"summary","name":"信号摘要","description":"基于所选榜单样本得到的具体观察","type":"long_text","required":true,"defaultValue":null,"options":[],"group":"信号","order":1},
    {"key":"heat","name":"热度","description":"按所选样本判断的相对热度","type":"select","required":true,"defaultValue":"medium","options":[{"value":"low","label":"低"},{"value":"medium","label":"中"},{"value":"high","label":"高"}],"group":"判断","order":2},
    {"key":"crowding","name":"拥挤度","description":"相似作品与套路的密集程度","type":"select","required":true,"defaultValue":"medium","options":[{"value":"low","label":"低"},{"value":"medium","label":"中"},{"value":"high","label":"高"}],"group":"判断","order":3},
    {"key":"trend","name":"趋势","description":"当前观察到的变化方向","type":"select","required":true,"defaultValue":"stable","options":[{"value":"rising","label":"上升"},{"value":"stable","label":"稳定"},{"value":"falling","label":"下降"},{"value":"uncertain","label":"不确定"}],"group":"判断","order":4},
    {"key":"platforms","name":"平台","description":"结论覆盖的公开榜单平台","type":"multi_select","required":true,"defaultValue":null,"options":[{"value":"fanqie","label":"番茄小说"},{"value":"qidian","label":"起点中文网"},{"value":"jinjiang","label":"晋江文学城"}],"group":"来源","order":5},
    {"key":"audience","name":"目标受众","description":"可能更关注该信号的读者","type":"long_text","required":true,"defaultValue":null,"options":[],"group":"机会","order":6},
    {"key":"differentiation","name":"差异化机会","description":"在拥挤方向中可尝试的具体区别","type":"long_text","required":true,"defaultValue":null,"options":[],"group":"机会","order":7},
    {"key":"source_refs","name":"来源引用","description":"榜单扫描记录、来源网址和样本标题的只读引用摘要","type":"long_text","required":true,"defaultValue":null,"options":[],"group":"来源","order":8},
    {"key":"observed_at","name":"观察时间","description":"榜单数据采集日期","type":"date","required":true,"defaultValue":null,"options":[],"group":"时效","order":9},
    {"key":"effective_until","name":"建议复核日期","description":"超过此日期后应重新扫描再判断","type":"date","required":false,"defaultValue":null,"options":[],"group":"时效","order":10}
  ]$json$::jsonb,true,100,'["creative_goal"]'::jsonb,'52000000-0000-4000-8000-000000000006'
)
ON CONFLICT (space_id,type_key) DO NOTHING;

INSERT INTO card_type_versions (id,card_type_id,version,fields)
SELECT '72000000-0000-4000-8000-000000000001',id,1,draft_fields
FROM card_types WHERE id='71000000-0000-4000-8000-000000000001'
ON CONFLICT DO NOTHING;

ALTER TABLE card_field_origins DROP CONSTRAINT card_field_origins_source_kind_check;
ALTER TABLE card_field_origins ADD CONSTRAINT card_field_origins_source_kind_check
  CHECK (source_kind IN ('template','ai','user','resource','research'));
