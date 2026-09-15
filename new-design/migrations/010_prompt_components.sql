SET search_path TO new_design, public;

INSERT INTO card_spaces (id,space_key,name)
VALUES ('63000000-0000-4000-8000-000000000001','resource_prompt_components','提示词组件资源')
ON CONFLICT (space_key) DO NOTHING;

INSERT INTO card_type_categories (id,category_key,name,parent_id,sort_order,is_system)
VALUES ('65000000-0000-4000-8000-000000000001','ai_resources','AI 资源',NULL,70,true)
ON CONFLICT (category_key) DO UPDATE SET name=EXCLUDED.name,sort_order=EXCLUDED.sort_order,status='active',is_system=true,updated_at=now();

INSERT INTO card_types (id,space_id,type_key,name,description,status,revision,current_version_id,draft_fields,is_system,sort_order,semantic_capabilities,category_id)
VALUES (
  '66000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001','prompt_component','提示词组件',
  '保存可复用的 AI 指令片段、上下文说明、输出要求与示例；不承载最终 Prompt、任务合同、模型密钥或运行记录。',
  'published',1,'67000000-0000-4000-8000-000000000001',$json$[
    {"key":"component_key","name":"稳定组件键","description":"供后续提示词配方按稳定 ID 引用；发布后不应随展示名称改变","type":"short_text","required":true,"defaultValue":null,"options":[],"group":"身份","order":0},
    {"key":"component_type","name":"组件类型","description":"组件在受控配方中承担的职责","type":"select","required":true,"defaultValue":"optional_addition","options":[{"value":"system_role","label":"角色职责"},{"value":"task_instruction","label":"任务说明"},{"value":"business_constraint","label":"业务约束"},{"value":"creative_strategy_reference","label":"创作策略引用"},{"value":"writing_reference","label":"写法引用"},{"value":"quality_rule_reference","label":"质量规则引用"},{"value":"context_instruction","label":"上下文声明"},{"value":"output_requirement","label":"输出要求"},{"value":"example","label":"示例"},{"value":"optional_addition","label":"临时补充"}],"group":"身份","order":1},
    {"key":"content","name":"正文内容","description":"可复用的单一职责指令片段，不应包含模型密钥或完整最终 Prompt","type":"long_text","required":true,"defaultValue":null,"options":[],"group":"指令","order":2},
    {"key":"task_families","name":"适用任务族","description":"允许哪些精确 AI 任务在配方中引用此组件","type":"multi_select","required":false,"defaultValue":null,"options":[{"value":"ideation","label":"开书与创意"},{"value":"form_card","label":"表单与卡片"},{"value":"world_character","label":"世界与人物"},{"value":"structure_planning","label":"结构规划"},{"value":"prose","label":"正文创作"},{"value":"quality","label":"质量治理"},{"value":"resource_processing","label":"资源处理"}],"group":"适用范围","order":3},
    {"key":"binding_status","name":"资源绑定状态","description":"引用题材、写法或质量资源时，仅标记待绑定；正式关系由后续配方关系对象保存","type":"select","required":false,"defaultValue":"not_applicable","options":[{"value":"not_applicable","label":"不适用"},{"value":"pending_binding","label":"待配方绑定"}],"group":"适用范围","order":4},
    {"key":"edit_policy","name":"覆盖／编辑策略","description":"声明后续配方或作用域可以如何使用和调整该组件","type":"select","required":true,"defaultValue":"editable","options":[{"value":"editable","label":"可直接编辑"},{"value":"clone_before_edit","label":"复制后编辑"},{"value":"overlay_only","label":"仅允许配方覆盖"}],"group":"治理","order":5},
    {"key":"trust_level","name":"信任等级","description":"决定编译时允许进入的消息槽位；外部资料不得提升为系统指令","type":"select","required":true,"defaultValue":"system_trusted","options":[{"value":"system_trusted","label":"系统可信"},{"value":"editor_trusted","label":"编辑者可信"},{"value":"untrusted_data","label":"不受信任数据"}],"group":"治理","order":6},
    {"key":"enabled","name":"启用状态","description":"是否允许后续提示词配方选择此组件","type":"boolean","required":false,"defaultValue":true,"options":[],"group":"治理","order":7},
    {"key":"notes","name":"说明","description":"记录适用边界、维护原因或后续配方引用注意事项","type":"long_text","required":false,"defaultValue":null,"options":[],"group":"说明","order":8}
  ]$json$::jsonb,true,10,'["creative_goal"]'::jsonb,'65000000-0000-4000-8000-000000000001'
)
ON CONFLICT (space_id,type_key) DO NOTHING;

INSERT INTO card_type_versions (id,card_type_id,version,fields)
SELECT '67000000-0000-4000-8000-000000000001',id,1,draft_fields
FROM card_types WHERE id='66000000-0000-4000-8000-000000000001'
ON CONFLICT DO NOTHING;

CREATE TEMP TABLE prompt_component_seeds (card_id uuid PRIMARY KEY,version_id uuid NOT NULL,title text NOT NULL,values jsonb NOT NULL) ON COMMIT DROP;
INSERT INTO prompt_component_seeds VALUES
('68000000-0000-4000-8000-000000000001','69000000-0000-4000-8000-000000000001','长篇小说创作助手角色',$json${"component_key":"system.long_novel_assistant_role","component_type":"system_role","content":"你是长篇小说创作助手。围绕当前精确任务工作，遵守已发布表单与事实边界；不替用户发布版本，也不绕过校验和采用流程。","task_families":["ideation","form_card","world_character","structure_planning","prose","quality"],"binding_status":"not_applicable","edit_policy":"editable","trust_level":"system_trusted","enabled":true,"notes":"提供通用角色边界，不包含具体作品设定。"}$json$),
('68000000-0000-4000-8000-000000000002','69000000-0000-4000-8000-000000000002','严格依据已确认事实',$json${"component_key":"constraint.confirmed_facts_only","component_type":"business_constraint","content":"把当前书籍中已确认的卡片、关系和正文版本视为事实来源。候选内容与已确认事实冲突时，明确指出冲突，不得静默改写原事实。","task_families":["form_card","world_character","structure_planning","prose","quality"],"binding_status":"not_applicable","edit_policy":"editable","trust_level":"system_trusted","enabled":true,"notes":"后续由上下文解析器提供真实版本；本组件不复制书籍事实。"}$json$),
('68000000-0000-4000-8000-000000000003','69000000-0000-4000-8000-000000000003','只返回表单 Schema',$json${"component_key":"output.current_form_schema_only","component_type":"output_requirement","content":"只返回当前已发布动态表单 Schema 允许的字段键和值；不得增加未知字段，不得用说明文字包裹结构化结果。","task_families":["form_card"],"binding_status":"not_applicable","edit_policy":"editable","trust_level":"system_trusted","enabled":true,"notes":"Schema 必须由运行时根据表单版本生成，本组件不硬编码字段清单。"}$json$),
('68000000-0000-4000-8000-000000000004','69000000-0000-4000-8000-000000000004','避免擅自新增设定',$json${"component_key":"constraint.no_unapproved_canon","component_type":"business_constraint","content":"信息不足时保留空缺或提出候选，不得把未经用户确认的人物、规则、事件、关系或历史写成作品既定事实。","task_families":["form_card","world_character","structure_planning","prose","quality"],"binding_status":"not_applicable","edit_policy":"editable","trust_level":"system_trusted","enabled":true,"notes":"模型输出仍是候选，只有用户采用后才能进入正式事实。"}$json$);

INSERT INTO cards (id,space_id,card_type_id,title,status,revision,type_version_id,current_version_id,values)
SELECT seed.card_id,'63000000-0000-4000-8000-000000000001','66000000-0000-4000-8000-000000000001',seed.title,'active',1,'67000000-0000-4000-8000-000000000001',NULL,seed.values
FROM prompt_component_seeds seed ON CONFLICT (id) DO NOTHING;

INSERT INTO card_versions (id,card_id,revision,type_version_id,title,values,source)
SELECT seed.version_id,seed.card_id,1,'67000000-0000-4000-8000-000000000001',seed.title,seed.values,'create'
FROM prompt_component_seeds seed ON CONFLICT (id) DO NOTHING;

UPDATE cards card SET current_version_id=seed.version_id
FROM prompt_component_seeds seed WHERE card.id=seed.card_id AND card.current_version_id IS NULL;
