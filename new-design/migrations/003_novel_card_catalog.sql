SET search_path TO new_design, public;

ALTER TABLE card_types
  ADD COLUMN IF NOT EXISTS semantic_capabilities jsonb NOT NULL DEFAULT '[]'::jsonb;

-- The four original workflow helpers are not part of the 19 core story-object
-- types. Hide only untouched seed-only variants; user-authored data keeps its
-- type visible and is never deleted by this migration.
UPDATE card_types card_type
SET status = 'archived', is_system = false, sort_order = 1000, updated_at = now()
WHERE card_type.type_key IN ('project_rule', 'story_idea', 'time_rule', 'research_note')
  AND NOT EXISTS (
    SELECT 1
    FROM cards card
    WHERE card.card_type_id = card_type.id
      AND card.id NOT IN (
        '12000000-0000-4000-8000-000000000001',
        '12000000-0000-4000-8000-000000000002',
        '12000000-0000-4000-8000-000000000004'
      )
  );

UPDATE card_types SET type_key = 'organization', name = '组织／势力', description = '记录可以持续行动、拥有资源并与其他主体建立关系的组织。', sort_order = 20,
  semantic_capabilities = '["relation_subject","state_change","lifecycle","canonical_fact"]'::jsonb, updated_at = now()
WHERE type_key = 'faction';

UPDATE card_types SET type_key = 'world_rule', name = '世界规则', description = '记录故事世界中稳定生效、不可为了方便临时推翻的规则。', sort_order = 50,
  semantic_capabilities = '["canonical_fact"]'::jsonb, updated_at = now()
WHERE type_key = 'world_setting';

UPDATE card_types SET type_key = 'foreshadow', name = '伏笔', description = '记录作者提前布置并计划在后文回收的叙事动作。', sort_order = 110,
  semantic_capabilities = '["lifecycle","creative_goal"]'::jsonb, updated_at = now()
WHERE type_key = 'foreshadow_clue';

UPDATE card_types SET type_key = 'volume', name = '卷', description = '组织一段具有独立阶段目标、高潮和状态变化的长篇结构。', sort_order = 170,
  semantic_capabilities = '["body_text","lifecycle","creative_goal"]'::jsonb, updated_at = now()
WHERE type_key = 'volume_plan';

UPDATE card_types SET type_key = 'chapter', name = '章节', description = '组织一章的生产目标、信息释放、场景和正文承载。', sort_order = 180,
  semantic_capabilities = '["body_text","timeline","lifecycle","creative_goal"]'::jsonb, updated_at = now()
WHERE type_key = 'chapter_plan';

UPDATE card_types SET type_key = 'scene', name = '场景', description = '记录某一时空中人物如何通过行动表现目标、阻碍和转折。', sort_order = 190,
  semantic_capabilities = '["body_text","timeline","state_change","creative_goal"]'::jsonb, updated_at = now()
WHERE type_key = 'scene_plan';

UPDATE card_types SET sort_order = 10,
  semantic_capabilities = '["relation_subject","state_change","lifecycle","canonical_fact"]'::jsonb, updated_at = now()
WHERE type_key = 'character';

UPDATE card_types SET sort_order = 30,
  semantic_capabilities = '["relation_subject","canonical_fact"]'::jsonb, updated_at = now()
WHERE type_key = 'location';

UPDATE card_types SET sort_order = 40,
  semantic_capabilities = '["relation_subject","state_change","lifecycle","canonical_fact"]'::jsonb, updated_at = now()
WHERE type_key = 'prop';

UPDATE card_types SET sort_order = 60,
  semantic_capabilities = '["timeline","state_change","canonical_fact"]'::jsonb, updated_at = now()
WHERE type_key = 'event';

-- Replace the combined clue/foreshadow form with a focused foreshadow form.
INSERT INTO card_type_versions (id, card_type_id, version, fields)
SELECT '15000000-0000-4000-8000-000000000011', card_type.id, 2, $json$[
  {"key":"name","name":"伏笔名称","description":"便于作者追踪的工作名称","type":"short_text","required":true,"defaultValue":null,"options":[],"group":"伏笔定义","order":0},
  {"key":"setup_content","name":"布置内容","description":"前文具体出现了什么叙事信息或细节","type":"long_text","required":true,"defaultValue":null,"options":[],"group":"伏笔定义","order":1},
  {"key":"planted_at","name":"埋设位置","description":"计划在哪一卷、章或场景出现","type":"short_text","required":false,"defaultValue":null,"options":[],"group":"生命周期","order":2},
  {"key":"reader_visibility","name":"读者可见度","description":"读者对布置的察觉程度","type":"select","required":false,"defaultValue":"subtle","options":[{"value":"hidden","label":"隐蔽"},{"value":"subtle","label":"可察觉"},{"value":"obvious","label":"明显"}],"group":"叙事控制","order":3},
  {"key":"payoff_plan","name":"回收计划","description":"何时、通过什么行动兑现布置","type":"long_text","required":false,"defaultValue":null,"options":[],"group":"生命周期","order":4},
  {"key":"status","name":"伏笔状态","description":"作者侧的布置和回收进度","type":"select","required":false,"defaultValue":"planned","options":[{"value":"planned","label":"待埋设"},{"value":"planted","label":"已埋设"},{"value":"reinforced","label":"已强化"},{"value":"paid_off","label":"已回收"},{"value":"abandoned","label":"已废弃"}],"group":"生命周期","order":5}
]$json$::jsonb
FROM card_types card_type
WHERE card_type.type_key = 'foreshadow'
ON CONFLICT DO NOTHING;

UPDATE card_types
SET current_version_id = '15000000-0000-4000-8000-000000000011',
    draft_fields = $json$[
      {"key":"name","name":"伏笔名称","description":"便于作者追踪的工作名称","type":"short_text","required":true,"defaultValue":null,"options":[],"group":"伏笔定义","order":0},
      {"key":"setup_content","name":"布置内容","description":"前文具体出现了什么叙事信息或细节","type":"long_text","required":true,"defaultValue":null,"options":[],"group":"伏笔定义","order":1},
      {"key":"planted_at","name":"埋设位置","description":"计划在哪一卷、章或场景出现","type":"short_text","required":false,"defaultValue":null,"options":[],"group":"生命周期","order":2},
      {"key":"reader_visibility","name":"读者可见度","description":"读者对布置的察觉程度","type":"select","required":false,"defaultValue":"subtle","options":[{"value":"hidden","label":"隐蔽"},{"value":"subtle","label":"可察觉"},{"value":"obvious","label":"明显"}],"group":"叙事控制","order":3},
      {"key":"payoff_plan","name":"回收计划","description":"何时、通过什么行动兑现布置","type":"long_text","required":false,"defaultValue":null,"options":[],"group":"生命周期","order":4},
      {"key":"status","name":"伏笔状态","description":"作者侧的布置和回收进度","type":"select","required":false,"defaultValue":"planned","options":[{"value":"planned","label":"待埋设"},{"value":"planted","label":"已埋设"},{"value":"reinforced","label":"已强化"},{"value":"paid_off","label":"已回收"},{"value":"abandoned","label":"已废弃"}],"group":"生命周期","order":5}
    ]$json$::jsonb,
    revision = revision + 1,
    updated_at = now()
WHERE type_key = 'foreshadow';

CREATE TEMP TABLE core_card_types (
  id uuid PRIMARY KEY,
  version_id uuid NOT NULL,
  type_key text NOT NULL,
  name text NOT NULL,
  description text NOT NULL,
  capabilities jsonb NOT NULL,
  fields jsonb NOT NULL,
  sort_order integer NOT NULL
) ON COMMIT DROP;

INSERT INTO core_card_types (id, version_id, type_key, name, description, capabilities, fields, sort_order) VALUES
('14000000-0000-4000-8000-000000000007', '15000000-0000-4000-8000-000000000007', 'goal_task', '目标／任务', '记录人物或组织想完成什么，以及完成条件和生命周期。', '["relation_subject","state_change","lifecycle","creative_goal"]', $json$[
  {"key":"name","name":"目标名称","description":"用行动结果命名","type":"short_text","required":true,"defaultValue":null,"options":[],"group":"目标定义","order":0},
  {"key":"owner","name":"承担者","description":"想完成目标的人物或组织","type":"short_text","required":true,"defaultValue":null,"options":[],"group":"目标定义","order":1},
  {"key":"desired_result","name":"期望结果","description":"成功后可被观察到的结果","type":"long_text","required":true,"defaultValue":null,"options":[],"group":"目标定义","order":2},
  {"key":"motivation","name":"动机","description":"承担者为什么必须完成","type":"long_text","required":false,"defaultValue":null,"options":[],"group":"推动力","order":3},
  {"key":"obstacle","name":"主要阻碍","description":"当前最直接的外部或内部障碍","type":"long_text","required":false,"defaultValue":null,"options":[],"group":"推动力","order":4},
  {"key":"success_criteria","name":"完成标准","description":"判断目标完成的明确条件","type":"long_text","required":false,"defaultValue":null,"options":[],"group":"生命周期","order":5},
  {"key":"status","name":"目标状态","description":"当前推进阶段","type":"select","required":false,"defaultValue":"active","options":[{"value":"planned","label":"计划中"},{"value":"active","label":"进行中"},{"value":"blocked","label":"受阻"},{"value":"completed","label":"已完成"},{"value":"abandoned","label":"已放弃"}],"group":"生命周期","order":6}
]$json$::jsonb, 70),
('14000000-0000-4000-8000-000000000008', '15000000-0000-4000-8000-000000000008', 'conflict', '冲突', '记录跨事件持续存在的对抗、争夺对象与升级路径。', '["relation_subject","state_change","lifecycle","creative_goal"]', $json$[
  {"key":"name","name":"冲突名称","description":"对抗的稳定工作名称","type":"short_text","required":true,"defaultValue":null,"options":[],"group":"冲突定义","order":0},
  {"key":"sides","name":"对抗各方","description":"参与冲突的人物或组织","type":"long_text","required":true,"defaultValue":null,"options":[],"group":"冲突定义","order":1},
  {"key":"conflict_core","name":"争夺核心","description":"双方无法同时满足的需求或价值","type":"long_text","required":true,"defaultValue":null,"options":[],"group":"冲突定义","order":2},
  {"key":"stakes","name":"失败代价","description":"冲突失败分别会失去什么","type":"long_text","required":false,"defaultValue":null,"options":[],"group":"升级路径","order":3},
  {"key":"escalation","name":"升级路径","description":"冲突如何跨事件持续升级","type":"long_text","required":false,"defaultValue":null,"options":[],"group":"升级路径","order":4},
  {"key":"resolution_condition","name":"解决条件","description":"什么变化能真正结束对抗","type":"long_text","required":false,"defaultValue":null,"options":[],"group":"生命周期","order":5},
  {"key":"status","name":"冲突状态","description":"当前所处阶段","type":"select","required":false,"defaultValue":"active","options":[{"value":"latent","label":"潜伏"},{"value":"active","label":"爆发"},{"value":"escalated","label":"升级"},{"value":"resolved","label":"解决"}],"group":"生命周期","order":6}
]$json$::jsonb, 80),
('14000000-0000-4000-8000-000000000009', '15000000-0000-4000-8000-000000000009', 'secret_truth', '秘密／真相', '记录故事世界中的唯一答案，以及知情范围和揭晓后果。', '["lifecycle","canonical_fact"]', $json$[
  {"key":"name","name":"真相名称","description":"便于追踪的唯一答案名称","type":"short_text","required":true,"defaultValue":null,"options":[],"group":"真相定义","order":0},
  {"key":"truth_content","name":"真实答案","description":"故事中最终成立的事实","type":"long_text","required":true,"defaultValue":null,"options":[],"group":"真相定义","order":1},
  {"key":"known_by","name":"当前知情者","description":"已经知道全部或部分答案的人","type":"long_text","required":false,"defaultValue":null,"options":[],"group":"知情范围","order":2},
  {"key":"hidden_from","name":"隐瞒对象","description":"真相目前主要对谁隐藏","type":"long_text","required":false,"defaultValue":null,"options":[],"group":"知情范围","order":3},
  {"key":"exposure_consequence","name":"揭晓后果","description":"答案公开后改变哪些选择和关系","type":"long_text","required":false,"defaultValue":null,"options":[],"group":"揭晓计划","order":4},
  {"key":"reveal_stage","name":"计划揭晓位置","description":"计划在哪一卷章揭晓","type":"short_text","required":false,"defaultValue":null,"options":[],"group":"揭晓计划","order":5},
  {"key":"status","name":"真相状态","description":"作者侧的揭晓进度","type":"select","required":false,"defaultValue":"hidden","options":[{"value":"hidden","label":"未揭晓"},{"value":"partial","label":"部分揭晓"},{"value":"revealed","label":"已揭晓"}],"group":"揭晓计划","order":6}
]$json$::jsonb, 90),
('14000000-0000-4000-8000-000000000010', '15000000-0000-4000-8000-000000000010', 'clue_evidence', '线索／证据', '记录故事内能够指向某个真相、可被人物发现和验证的信息。', '["relation_subject","lifecycle","canonical_fact"]', $json$[
  {"key":"name","name":"线索名称","description":"便于追踪的证据名称","type":"short_text","required":true,"defaultValue":null,"options":[],"group":"证据定义","order":0},
  {"key":"content","name":"证据内容","description":"人物实际可以观察或取得的内容","type":"long_text","required":true,"defaultValue":null,"options":[],"group":"证据定义","order":1},
  {"key":"points_to","name":"指向真相","description":"它能够支持、削弱或误导哪个答案","type":"long_text","required":false,"defaultValue":null,"options":[],"group":"证明力","order":2},
  {"key":"source","name":"证据来源","description":"物证、证词、记录或现场来源","type":"short_text","required":false,"defaultValue":null,"options":[],"group":"证明力","order":3},
  {"key":"reliability","name":"可靠性","description":"证据本身是否可信","type":"select","required":false,"defaultValue":"verified","options":[{"value":"verified","label":"可信"},{"value":"questionable","label":"存疑"},{"value":"false","label":"伪造"}],"group":"证明力","order":4},
  {"key":"discovered_at","name":"发现位置","description":"在哪一章或场景被谁发现","type":"short_text","required":false,"defaultValue":null,"options":[],"group":"生命周期","order":5},
  {"key":"status","name":"线索状态","description":"当前发现和验证进度","type":"select","required":false,"defaultValue":"planned","options":[{"value":"planned","label":"待出现"},{"value":"found","label":"已发现"},{"value":"verified","label":"已验证"},{"value":"explained","label":"已解释"}],"group":"生命周期","order":6}
]$json$::jsonb, 100),
('14000000-0000-4000-8000-000000000012', '15000000-0000-4000-8000-000000000012', 'suspense_question', '悬念／问题', '记录读者正在等待回答的问题及其信息差和回答时限。', '["lifecycle","creative_goal"]', $json$[
  {"key":"question","name":"悬念问题","description":"用读者会主动追问的问题表达","type":"short_text","required":true,"defaultValue":null,"options":[],"group":"悬念定义","order":0},
  {"key":"audience_knows","name":"读者已知","description":"读者目前掌握了哪些信息","type":"long_text","required":false,"defaultValue":null,"options":[],"group":"信息差","order":1},
  {"key":"characters_know","name":"人物已知","description":"相关人物分别知道什么","type":"long_text","required":false,"defaultValue":null,"options":[],"group":"信息差","order":2},
  {"key":"answer","name":"作者答案","description":"作者预先确定的答案，未揭晓前不对读者展示","type":"long_text","required":false,"defaultValue":null,"options":[],"group":"回答计划","order":3},
  {"key":"answer_deadline","name":"回答期限","description":"最迟应在哪一卷章回答","type":"short_text","required":false,"defaultValue":null,"options":[],"group":"回答计划","order":4},
  {"key":"status","name":"悬念状态","description":"当前提出和回答进度","type":"select","required":false,"defaultValue":"open","options":[{"value":"planned","label":"待提出"},{"value":"open","label":"等待回答"},{"value":"partial","label":"部分回答"},{"value":"answered","label":"已回答"}],"group":"回答计划","order":5}
]$json$::jsonb, 120),
('14000000-0000-4000-8000-000000000013', '15000000-0000-4000-8000-000000000013', 'plotline', '剧情线', '组织多个事件围绕同一推进目标形成的连续因果链。', '["state_change","lifecycle","creative_goal"]', $json$[
  {"key":"name","name":"剧情线名称","description":"连续因果链的工作名称","type":"short_text","required":true,"defaultValue":null,"options":[],"group":"剧情线定义","order":0},
  {"key":"purpose","name":"叙事目的","description":"这条线为全书提供什么推进","type":"long_text","required":true,"defaultValue":null,"options":[],"group":"剧情线定义","order":1},
  {"key":"participants","name":"主要参与者","description":"持续参与此线的人物或组织","type":"long_text","required":false,"defaultValue":null,"options":[],"group":"装配","order":2},
  {"key":"opening","name":"起点","description":"剧情线如何被启动","type":"long_text","required":false,"defaultValue":null,"options":[],"group":"阶段","order":3},
  {"key":"development","name":"主要发展","description":"关键事件与升级顺序","type":"long_text","required":false,"defaultValue":null,"options":[],"group":"阶段","order":4},
  {"key":"climax","name":"高潮","description":"这条线最强的选择与对抗","type":"long_text","required":false,"defaultValue":null,"options":[],"group":"阶段","order":5},
  {"key":"resolution","name":"收束","description":"结束后留下的状态变化","type":"long_text","required":false,"defaultValue":null,"options":[],"group":"阶段","order":6},
  {"key":"status","name":"剧情线状态","description":"当前推进阶段","type":"select","required":false,"defaultValue":"active","options":[{"value":"planned","label":"计划中"},{"value":"active","label":"进行中"},{"value":"paused","label":"暂停"},{"value":"resolved","label":"已收束"}],"group":"生命周期","order":7}
]$json$::jsonb, 130),
('14000000-0000-4000-8000-000000000014', '15000000-0000-4000-8000-000000000014', 'plot_beat', '剧情节点／节拍', '记录某个结构位置必须发挥的叙事作用，而不是实际发生的事件。', '["creative_goal"]', $json$[
  {"key":"name","name":"节点名称","description":"结构节点的工作名称","type":"short_text","required":true,"defaultValue":null,"options":[],"group":"节点定义","order":0},
  {"key":"structural_role","name":"结构作用","description":"节点承担的主要结构职责","type":"select","required":true,"defaultValue":"turn","options":[{"value":"hook","label":"钩子"},{"value":"inciting","label":"诱发事件"},{"value":"turn","label":"转折"},{"value":"midpoint","label":"中点"},{"value":"crisis","label":"危机"},{"value":"climax","label":"高潮"},{"value":"resolution","label":"收束"}],"group":"节点定义","order":1},
  {"key":"intended_effect","name":"预期效果","description":"读者理解、情绪或期待应发生什么变化","type":"long_text","required":true,"defaultValue":null,"options":[],"group":"节点定义","order":2},
  {"key":"prerequisites","name":"前置条件","description":"节点成立前必须准备的事实或关系","type":"long_text","required":false,"defaultValue":null,"options":[],"group":"装配","order":3},
  {"key":"target_position","name":"目标位置","description":"计划落在哪一卷章或比例位置","type":"short_text","required":false,"defaultValue":null,"options":[],"group":"装配","order":4},
  {"key":"fulfillment","name":"兑现方式","description":"可由哪些事件和场景完成结构作用","type":"long_text","required":false,"defaultValue":null,"options":[],"group":"装配","order":5}
]$json$::jsonb, 140),
('14000000-0000-4000-8000-000000000015', '15000000-0000-4000-8000-000000000015', 'arc', '弧线／变化线', '记录人物、关系或世界状态跨阶段发生的连续变化。', '["state_change","lifecycle","creative_goal"]', $json$[
  {"key":"name","name":"弧线名称","description":"变化线的工作名称","type":"short_text","required":true,"defaultValue":null,"options":[],"group":"弧线定义","order":0},
  {"key":"subject","name":"变化主体","description":"发生变化的人物、关系或世界部分","type":"short_text","required":true,"defaultValue":null,"options":[],"group":"弧线定义","order":1},
  {"key":"start_state","name":"起始状态","description":"开端时稳定可见的状态","type":"long_text","required":true,"defaultValue":null,"options":[],"group":"阶段","order":2},
  {"key":"pressure","name":"变化压力","description":"持续迫使主体改变的力量","type":"long_text","required":false,"defaultValue":null,"options":[],"group":"阶段","order":3},
  {"key":"turning_points","name":"关键转折","description":"跨阶段变化的主要节点","type":"long_text","required":false,"defaultValue":null,"options":[],"group":"阶段","order":4},
  {"key":"end_state","name":"目标终态","description":"弧线完成后的可见状态","type":"long_text","required":false,"defaultValue":null,"options":[],"group":"阶段","order":5},
  {"key":"status","name":"弧线状态","description":"当前变化进度","type":"select","required":false,"defaultValue":"planned","options":[{"value":"planned","label":"计划中"},{"value":"active","label":"推进中"},{"value":"completed","label":"已完成"}],"group":"生命周期","order":6}
]$json$::jsonb, 150),
('14000000-0000-4000-8000-000000000016', '15000000-0000-4000-8000-000000000016', 'theme', '主题／命题', '记录作品要通过人物选择和事件结果反复检验的命题。', '["creative_goal"]', $json$[
  {"key":"proposition","name":"核心命题","description":"作品反复检验的一句话判断","type":"long_text","required":true,"defaultValue":null,"options":[],"group":"主题定义","order":0},
  {"key":"counterargument","name":"反方命题","description":"与核心命题竞争且具有说服力的观点","type":"long_text","required":false,"defaultValue":null,"options":[],"group":"主题定义","order":1},
  {"key":"carriers","name":"命题承载者","description":"分别承载不同观点的人物或组织","type":"long_text","required":false,"defaultValue":null,"options":[],"group":"叙事证明","order":2},
  {"key":"proof_events","name":"证明事件","description":"通过哪些关键选择和后果检验命题","type":"long_text","required":false,"defaultValue":null,"options":[],"group":"叙事证明","order":3},
  {"key":"ending_answer","name":"结局回答","description":"故事最终给出的有限答案","type":"long_text","required":false,"defaultValue":null,"options":[],"group":"叙事证明","order":4}
]$json$::jsonb, 160);

INSERT INTO card_types (
  id, space_id, type_key, name, description, status, revision,
  current_version_id, draft_fields, is_system, sort_order, semantic_capabilities
)
SELECT id, '00000000-0000-4000-8000-000000000001', type_key, name, description,
       'published', 1, version_id, fields, true, sort_order, capabilities
FROM core_card_types
ON CONFLICT DO NOTHING;

INSERT INTO card_type_versions (id, card_type_id, version, fields)
SELECT seed.version_id, seed.id, 1, seed.fields
FROM core_card_types seed
JOIN card_types card_type ON card_type.id = seed.id
ON CONFLICT DO NOTHING;

UPDATE card_types card_type
SET current_version_id = seed.version_id,
    draft_fields = seed.fields,
    name = seed.name,
    description = seed.description,
    status = 'published',
    is_system = true,
    sort_order = seed.sort_order,
    semantic_capabilities = seed.capabilities,
    updated_at = now()
FROM core_card_types seed
WHERE card_type.id = seed.id;
