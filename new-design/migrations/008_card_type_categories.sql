SET search_path TO new_design, public;

CREATE TABLE card_type_categories (
  id uuid PRIMARY KEY,
  category_key text NOT NULL UNIQUE,
  name text NOT NULL,
  parent_id uuid REFERENCES card_type_categories(id),
  sort_order integer NOT NULL DEFAULT 1000,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  is_system boolean NOT NULL DEFAULT false,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (parent_id IS NULL OR parent_id <> id)
);

ALTER TABLE card_types ADD COLUMN category_id uuid REFERENCES card_type_categories(id);
CREATE INDEX card_types_category_idx ON card_types(category_id, sort_order);

INSERT INTO card_type_categories (id,category_key,name,parent_id,sort_order,is_system) VALUES
('52000000-0000-4000-8000-000000000001','creative_strategy','创作策略',NULL,10,true),
('52000000-0000-4000-8000-000000000002','people_organizations','人物与组织',NULL,20,true),
('52000000-0000-4000-8000-000000000003','world_setting','世界设定',NULL,30,true),
('52000000-0000-4000-8000-000000000004','story_structure','剧情结构',NULL,40,true),
('52000000-0000-4000-8000-000000000005','chapter_structure','篇章结构',NULL,50,true),
('52000000-0000-4000-8000-000000000006','reference_materials','参考资料',NULL,60,true)
ON CONFLICT (category_key) DO UPDATE SET name=EXCLUDED.name,sort_order=EXCLUDED.sort_order,status='active',is_system=true,updated_at=now();

CREATE TEMP TABLE added_card_types (
  id uuid PRIMARY KEY,
  version_id uuid NOT NULL,
  type_key text NOT NULL,
  name text NOT NULL,
  description text NOT NULL,
  category_id uuid NOT NULL,
  capabilities jsonb NOT NULL,
  fields jsonb NOT NULL,
  sort_order integer NOT NULL
);

INSERT INTO added_card_types VALUES
('53000000-0000-4000-8000-000000000001','54000000-0000-4000-8000-000000000001','genre_strategy','题材策略','确定题材组合、目标读者、核心体验与需要避免的方向漂移。','52000000-0000-4000-8000-000000000001','["creative_goal"]',$json$[
 {"key":"genre","name":"主题材","description":"作品最主要的题材定位","type":"short_text","required":true,"defaultValue":null,"options":[],"group":"定位","order":0},
 {"key":"subgenres","name":"融合题材","description":"辅助主体验的次级题材","type":"multi_select","required":false,"defaultValue":null,"options":[{"value":"adventure","label":"冒险"},{"value":"mystery","label":"悬疑"},{"value":"romance","label":"情感"},{"value":"business","label":"经营"},{"value":"growth","label":"成长"}],"group":"定位","order":1},
 {"key":"target_audience","name":"目标读者","description":"最希望服务的读者群体","type":"long_text","required":false,"defaultValue":null,"options":[],"group":"定位","order":2},
 {"key":"core_promise","name":"核心阅读承诺","description":"读者持续阅读能够稳定获得什么","type":"long_text","required":true,"defaultValue":null,"options":[],"group":"体验","order":3},
 {"key":"market_position","name":"市场位置","description":"相似作品中的差异化位置","type":"long_text","required":false,"defaultValue":null,"options":[],"group":"体验","order":4},
 {"key":"forbidden_drift","name":"禁止漂移","description":"创作过程中不能偷换成什么体验","type":"long_text","required":false,"defaultValue":null,"options":[],"group":"边界","order":5}
]$json$::jsonb,10),
('53000000-0000-4000-8000-000000000002','54000000-0000-4000-8000-000000000002','progression_mode','推进模式','定义故事以什么生产循环持续推进、升级和兑现。','52000000-0000-4000-8000-000000000001','["creative_goal","lifecycle"]',$json$[
 {"key":"name","name":"模式名称","description":"便于识别的推进模式名称","type":"short_text","required":true,"defaultValue":null,"options":[],"group":"推进循环","order":0},
 {"key":"story_unit","name":"推进单位","description":"以任务、案件、关卡、关系或其他单位推进","type":"short_text","required":true,"defaultValue":null,"options":[],"group":"推进循环","order":1},
 {"key":"cycle","name":"基本循环","description":"每轮从目标到兑现的步骤","type":"long_text","required":true,"defaultValue":null,"options":[],"group":"推进循环","order":2},
 {"key":"reward","name":"阶段回报","description":"每轮向读者兑现的变化","type":"long_text","required":false,"defaultValue":null,"options":[],"group":"升级","order":3},
 {"key":"escalation","name":"升级方式","description":"难度、代价与选择如何持续增强","type":"long_text","required":false,"defaultValue":null,"options":[],"group":"升级","order":4},
 {"key":"fatigue_guard","name":"防重复规则","description":"如何避免相同循环造成疲劳","type":"long_text","required":false,"defaultValue":null,"options":[],"group":"边界","order":5}
]$json$::jsonb,20),
('53000000-0000-4000-8000-000000000003','54000000-0000-4000-8000-000000000003','writing_config','写法配置','保存叙事视角、语言气质、章节密度与稳定写作约束。','52000000-0000-4000-8000-000000000001','["creative_goal"]',$json$[
 {"key":"pov","name":"叙事视角","description":"作品主要采用的观察视角","type":"select","required":true,"defaultValue":"third_limited","options":[{"value":"first","label":"第一人称"},{"value":"third_limited","label":"第三人称限知"},{"value":"third_omniscient","label":"第三人称全知"},{"value":"multi_pov","label":"多视角"}],"group":"叙事","order":0},
 {"key":"tense","name":"叙事时态","description":"正文主要使用的时态","type":"select","required":false,"defaultValue":"past","options":[{"value":"past","label":"过去时"},{"value":"present","label":"现在时"}],"group":"叙事","order":1},
 {"key":"style_tone","name":"整体语气","description":"描述语言质感、节奏和情绪基调","type":"long_text","required":false,"defaultValue":null,"options":[],"group":"语言","order":2},
 {"key":"dialogue_ratio","name":"对话密度","description":"对话在正文中的期望比重","type":"select","required":false,"defaultValue":"balanced","options":[{"value":"low","label":"偏低"},{"value":"balanced","label":"均衡"},{"value":"high","label":"偏高"}],"group":"语言","order":3},
 {"key":"chapter_length","name":"单章目标字数","description":"常规章节的目标长度","type":"number","required":false,"defaultValue":2500,"options":[],"group":"章节","order":4},
 {"key":"constraints","name":"稳定写法约束","description":"创作中持续遵守的表达边界","type":"long_text","required":false,"defaultValue":null,"options":[],"group":"边界","order":5}
]$json$::jsonb,30),
('53000000-0000-4000-8000-000000000004','54000000-0000-4000-8000-000000000004','quality_rule','质量规则','用可解释的通用规则约束质量、风格一致性和常见 AI 痕迹风险。','52000000-0000-4000-8000-000000000001','["creative_goal","lifecycle"]',$json$[
 {"key":"name","name":"规则名称","description":"便于作者理解的规则名称","type":"short_text","required":true,"defaultValue":null,"options":[],"group":"规则","order":0},
 {"key":"purpose","name":"规则目的","description":"这条规则保护什么阅读体验","type":"long_text","required":true,"defaultValue":null,"options":[],"group":"规则","order":1},
 {"key":"severity","name":"重要程度","description":"发现问题时的处理优先级","type":"select","required":false,"defaultValue":"warning","options":[{"value":"notice","label":"提醒"},{"value":"warning","label":"重要"},{"value":"critical","label":"必须处理"}],"group":"检查","order":2},
 {"key":"check_scope","name":"检查范围","description":"适用于全书、卷、章、场景或字段","type":"multi_select","required":false,"defaultValue":null,"options":[{"value":"book","label":"全书"},{"value":"volume","label":"卷"},{"value":"chapter","label":"章节"},{"value":"scene","label":"场景"},{"value":"field","label":"资料字段"}],"group":"检查","order":3},
 {"key":"rule","name":"判断规则","description":"能够被作者和 AI 共同执行的判断标准","type":"long_text","required":true,"defaultValue":null,"options":[],"group":"检查","order":4},
 {"key":"ai_risk_signal","name":"AI 痕迹风险信号","description":"套话、均质句式、空泛总结等需要警惕的信号","type":"long_text","required":false,"defaultValue":null,"options":[],"group":"检查","order":5},
 {"key":"correction_guidance","name":"修正指引","description":"发现问题后应如何改写或复核","type":"long_text","required":false,"defaultValue":null,"options":[],"group":"修正","order":6},
 {"key":"enabled","name":"启用","description":"是否参与当前检查","type":"boolean","required":false,"defaultValue":true,"options":[],"group":"状态","order":7}
]$json$::jsonb,40),
('53000000-0000-4000-8000-000000000005','54000000-0000-4000-8000-000000000005','world_overview','世界总览','聚合作品世界的时代、空间、秩序、日常生活与主要张力。','52000000-0000-4000-8000-000000000003','["relation_subject","canonical_fact"]',$json$[
 {"key":"name","name":"世界名称","description":"作品世界的工作名称","type":"short_text","required":true,"defaultValue":null,"options":[],"group":"总览","order":0},
 {"key":"elevator_pitch","name":"一句话世界印象","description":"用一句话说明这个世界最独特的体验","type":"long_text","required":true,"defaultValue":null,"options":[],"group":"总览","order":1},
 {"key":"era","name":"时代与发展阶段","description":"社会与技术所处阶段","type":"short_text","required":false,"defaultValue":null,"options":[],"group":"时空","order":2},
 {"key":"spatial_structure","name":"空间结构","description":"世界由哪些主要区域或层级构成","type":"long_text","required":false,"defaultValue":null,"options":[],"group":"时空","order":3},
 {"key":"core_order","name":"核心秩序","description":"谁制定规则，社会如何运转","type":"long_text","required":false,"defaultValue":null,"options":[],"group":"秩序","order":4},
 {"key":"ordinary_life","name":"普通人的日常","description":"衣食住行、工作与风险如何体现世界","type":"long_text","required":false,"defaultValue":null,"options":[],"group":"生活","order":5},
 {"key":"major_tension","name":"世界主要张力","description":"维持现状与推动变化的力量","type":"long_text","required":false,"defaultValue":null,"options":[],"group":"冲突","order":6}
]$json$::jsonb,45),
('53000000-0000-4000-8000-000000000006','54000000-0000-4000-8000-000000000006','power_system','能力／科技／修炼体系','定义力量来源、层级、代价、限制、进阶与克制关系。','52000000-0000-4000-8000-000000000003','["state_change","relation_subject","canonical_fact"]',$json$[
 {"key":"name","name":"体系名称","description":"能力、科技或修炼体系名称","type":"short_text","required":true,"defaultValue":null,"options":[],"group":"定义","order":0},
 {"key":"system_type","name":"体系类型","description":"能力主要属于哪种表现形态","type":"select","required":false,"defaultValue":"mixed","options":[{"value":"power","label":"超凡能力"},{"value":"technology","label":"科技"},{"value":"cultivation","label":"修炼"},{"value":"magic","label":"魔法"},{"value":"mixed","label":"混合体系"}],"group":"定义","order":1},
 {"key":"source","name":"力量来源","description":"力量从何而来并如何获得","type":"long_text","required":false,"defaultValue":null,"options":[],"group":"运行","order":2},
 {"key":"levels","name":"层级与阶段","description":"稳定层级及可观察差异","type":"long_text","required":true,"defaultValue":null,"options":[],"group":"运行","order":3},
 {"key":"costs","name":"使用代价","description":"使用力量必然付出的成本","type":"long_text","required":false,"defaultValue":null,"options":[],"group":"约束","order":4},
 {"key":"limits","name":"能力限制","description":"不能做到什么以及为什么","type":"long_text","required":false,"defaultValue":null,"options":[],"group":"约束","order":5},
 {"key":"advancement","name":"进阶条件","description":"提升层级需要满足的条件","type":"long_text","required":false,"defaultValue":null,"options":[],"group":"变化","order":6},
 {"key":"counters","name":"克制关系","description":"力量之间如何相互限制","type":"long_text","required":false,"defaultValue":null,"options":[],"group":"变化","order":7}
]$json$::jsonb,50),
('53000000-0000-4000-8000-000000000007','54000000-0000-4000-8000-000000000007','race','种族','记录群体的身体特征、寿命、能力、社会结构和跨族关系。','52000000-0000-4000-8000-000000000003','["relation_subject","canonical_fact"]',$json$[
 {"key":"name","name":"种族名称","description":"群体的稳定名称","type":"short_text","required":true,"defaultValue":null,"options":[],"group":"身份","order":0},
 {"key":"identity","name":"自我认同","description":"成员如何定义自己","type":"long_text","required":false,"defaultValue":null,"options":[],"group":"身份","order":1},
 {"key":"physiology","name":"身体特征","description":"可观察的生理差异","type":"long_text","required":false,"defaultValue":null,"options":[],"group":"特征","order":2},
 {"key":"lifespan","name":"寿命与成长","description":"生命周期和成长节奏","type":"long_text","required":false,"defaultValue":null,"options":[],"group":"特征","order":3},
 {"key":"abilities","name":"天赋与限制","description":"群体普遍能力及限制","type":"long_text","required":false,"defaultValue":null,"options":[],"group":"特征","order":4},
 {"key":"society","name":"社会结构","description":"群体内部如何组织","type":"long_text","required":false,"defaultValue":null,"options":[],"group":"社会","order":5},
 {"key":"relationships","name":"族群关系","description":"与其他族群的合作、冲突和偏见","type":"long_text","required":false,"defaultValue":null,"options":[],"group":"社会","order":6}
]$json$::jsonb,60),
('53000000-0000-4000-8000-000000000008','54000000-0000-4000-8000-000000000008','culture','文化','记录群体共享的价值、习俗、语言、禁忌和物质生活。','52000000-0000-4000-8000-000000000003','["relation_subject","canonical_fact"]',$json$[
 {"key":"name","name":"文化名称","description":"便于识别的文化名称","type":"short_text","required":true,"defaultValue":null,"options":[],"group":"定义","order":0},
 {"key":"people","name":"承载群体","description":"哪些人或地区共享这种文化","type":"long_text","required":false,"defaultValue":null,"options":[],"group":"定义","order":1},
 {"key":"values","name":"核心价值","description":"群体赞赏、羞耻和追求什么","type":"long_text","required":true,"defaultValue":null,"options":[],"group":"精神生活","order":2},
 {"key":"customs","name":"习俗与仪式","description":"日常和重要节点的习惯","type":"long_text","required":false,"defaultValue":null,"options":[],"group":"精神生活","order":3},
 {"key":"language_style","name":"语言与称谓","description":"表达、称呼和命名的特征","type":"long_text","required":false,"defaultValue":null,"options":[],"group":"表达","order":4},
 {"key":"taboo","name":"禁忌","description":"不可触碰的行为与原因","type":"long_text","required":false,"defaultValue":null,"options":[],"group":"边界","order":5},
 {"key":"material_life","name":"物质生活","description":"饮食、服饰、建筑与生产方式","type":"long_text","required":false,"defaultValue":null,"options":[],"group":"日常","order":6}
]$json$::jsonb,70),
('53000000-0000-4000-8000-000000000009','54000000-0000-4000-8000-000000000009','religion','宗教','记录信仰核心、神祇、组织、仪式、教义冲突与社会影响。','52000000-0000-4000-8000-000000000003','["relation_subject","canonical_fact"]',$json$[
 {"key":"name","name":"信仰名称","description":"宗教或信仰体系名称","type":"short_text","required":true,"defaultValue":null,"options":[],"group":"信仰","order":0},
 {"key":"belief_core","name":"信仰核心","description":"信徒相信世界和人生如何运转","type":"long_text","required":true,"defaultValue":null,"options":[],"group":"信仰","order":1},
 {"key":"deity","name":"神祇与超越对象","description":"崇拜或敬畏的对象","type":"long_text","required":false,"defaultValue":null,"options":[],"group":"信仰","order":2},
 {"key":"organization","name":"宗教组织","description":"信仰如何被组织和传播","type":"long_text","required":false,"defaultValue":null,"options":[],"group":"组织","order":3},
 {"key":"rites","name":"仪式","description":"重要日常与人生节点的仪式","type":"long_text","required":false,"defaultValue":null,"options":[],"group":"实践","order":4},
 {"key":"doctrine_conflict","name":"教义冲突","description":"内部解释分歧和外部矛盾","type":"long_text","required":false,"defaultValue":null,"options":[],"group":"冲突","order":5},
 {"key":"social_influence","name":"社会影响","description":"信仰如何影响法律、道德和生活","type":"long_text","required":false,"defaultValue":null,"options":[],"group":"影响","order":6}
]$json$::jsonb,80),
('53000000-0000-4000-8000-000000000010','54000000-0000-4000-8000-000000000010','reference_material','参考资料','保存参考内容的摘要、标签、来源、适用范围和原文版本引用，不承载分块或向量。','52000000-0000-4000-8000-000000000006','["creative_goal"]',$json$[
 {"key":"title","name":"资料标题","description":"参考资料的可识别标题","type":"short_text","required":true,"defaultValue":null,"options":[],"group":"资料","order":0},
 {"key":"summary","name":"内容摘要","description":"只保存可检索的简要结论","type":"long_text","required":true,"defaultValue":null,"options":[],"group":"资料","order":1},
 {"key":"tags","name":"标签","description":"便于查找的主题标签","type":"long_text","required":false,"defaultValue":null,"options":[],"group":"分类","order":2},
 {"key":"source","name":"来源","description":"作者、站点或资料出处","type":"short_text","required":false,"defaultValue":null,"options":[],"group":"来源","order":3},
 {"key":"scope","name":"适用范围","description":"适用于世界、人物、剧情、写法或其他范围","type":"multi_select","required":false,"defaultValue":null,"options":[{"value":"world","label":"世界"},{"value":"character","label":"人物"},{"value":"plot","label":"剧情"},{"value":"style","label":"写法"},{"value":"market","label":"市场"}],"group":"使用","order":4},
 {"key":"original_ref","name":"原文引用","description":"专用文档或外部原文的稳定引用","type":"short_text","required":false,"defaultValue":null,"options":[],"group":"来源","order":5},
 {"key":"version_ref","name":"版本引用","description":"所依据的原文或分析版本","type":"short_text","required":false,"defaultValue":null,"options":[],"group":"来源","order":6},
 {"key":"usage_notes","name":"使用说明","description":"允许借鉴的部分和需要避开的边界","type":"long_text","required":false,"defaultValue":null,"options":[],"group":"使用","order":7}
]$json$::jsonb,90);

INSERT INTO card_types (id,space_id,type_key,name,description,status,revision,current_version_id,draft_fields,is_system,sort_order,semantic_capabilities,category_id)
SELECT id,'00000000-0000-4000-8000-000000000001',type_key,name,description,'published',1,version_id,fields,true,sort_order,capabilities,category_id
FROM added_card_types ON CONFLICT (space_id,type_key) DO NOTHING;

INSERT INTO card_type_versions (id,card_type_id,version,fields)
SELECT version_id,id,1,fields FROM added_card_types ON CONFLICT DO NOTHING;

UPDATE card_types type SET category_id=category.id
FROM card_type_categories category
WHERE type.space_id='00000000-0000-4000-8000-000000000001' AND category.category_key=CASE
  WHEN type.type_key IN ('genre_strategy','progression_mode','writing_config','quality_rule') THEN 'creative_strategy'
  WHEN type.type_key IN ('character','organization') THEN 'people_organizations'
  WHEN type.type_key IN ('world_overview','world_rule','location','prop','power_system','race','culture','religion') THEN 'world_setting'
  WHEN type.type_key IN ('event','goal_task','conflict','secret_truth','clue_evidence','foreshadow','suspense_question','plotline','plot_beat','arc','theme') THEN 'story_structure'
  WHEN type.type_key IN ('volume','chapter','scene') THEN 'chapter_structure'
  WHEN type.type_key='reference_material' THEN 'reference_materials'
END;

WITH current_template AS (
  SELECT template.id AS template_id,version.payload,(SELECT COALESCE(MAX(v.version),0)+1 FROM template_group_versions v WHERE v.template_id=template.id) AS next_version
  FROM template_groups template JOIN template_group_versions version ON version.id=template.current_version_id
  WHERE template.template_key='long_novel_core'
), system_types AS (
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'sourceId',type.id,'sourceVersionId',version.id,'key',type.type_key,'name',type.name,'description',type.description,
    'categoryKey',category.category_key,'capabilities',type.semantic_capabilities,'fields',version.fields,'sortOrder',type.sort_order
  ) ORDER BY category.sort_order,type.sort_order),'[]'::jsonb) AS payload
  FROM card_types type JOIN card_type_versions version ON version.id=type.current_version_id
  LEFT JOIN card_type_categories category ON category.id=type.category_id
  WHERE type.space_id='00000000-0000-4000-8000-000000000001' AND type.is_system AND type.status='published'
), inserted AS (
  INSERT INTO template_group_versions (id,template_id,version,payload)
  SELECT '55000000-0000-4000-8000-000000000001',current_template.template_id,current_template.next_version,
    jsonb_set(current_template.payload,'{cardTypes}',system_types.payload,true)
  FROM current_template CROSS JOIN system_types
  ON CONFLICT DO NOTHING
  RETURNING id,template_id
)
UPDATE template_groups template SET current_version_id=inserted.id,revision=revision+1,updated_at=now()
FROM inserted WHERE template.id=inserted.template_id;
