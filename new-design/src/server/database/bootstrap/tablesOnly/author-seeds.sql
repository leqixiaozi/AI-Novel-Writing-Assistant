-- 作者可编辑规格和公共基础资源，不包含作者书籍、旧库数据或供应商凭据。
SET LOCAL search_path TO new_design,public;
INSERT INTO card_spaces(id,space_key,name) VALUES
 ('00000000-0000-4000-8000-000000000001','default','新设计默认空间'),
 ('60000000-0000-4000-8000-000000000001','resource_strategy','公共创作资源'),
 ('63000000-0000-4000-8000-000000000001','resource_prompt_components','提示词组件资源')
ON CONFLICT(id) DO NOTHING;
CREATE TEMP TABLE builtin_card_types (
  id uuid PRIMARY KEY,
  version_id uuid NOT NULL,
  type_key text NOT NULL,
  name text NOT NULL,
  description text NOT NULL,
  fields jsonb NOT NULL,
  sort_order integer NOT NULL
) ON COMMIT DROP;

INSERT INTO builtin_card_types (id, version_id, type_key, name, description, fields, sort_order) VALUES
('10000000-0000-4000-8000-000000000001', '11000000-0000-4000-8000-000000000001', 'project_rule', '作品约定', '固定整本书的叙事口径、内容边界和创作目标。', $json$[
  {"key":"perspective","name":"叙事视角","description":"整本书主要采用的观察视角","type":"select","required":true,"defaultValue":"third_limited","options":[{"value":"first","label":"第一人称"},{"value":"third_limited","label":"第三人称限知"},{"value":"third_omniscient","label":"第三人称全知"}],"group":"叙事口径","order":0},
  {"key":"tense","name":"叙事时态","description":"正文主要使用的时态","type":"select","required":false,"defaultValue":"past","options":[{"value":"past","label":"过去时"},{"value":"present","label":"现在时"}],"group":"叙事口径","order":1},
  {"key":"tone","name":"整体语气","description":"描述语言质感、节奏和情绪基调","type":"long_text","required":false,"defaultValue":null,"options":[],"group":"叙事口径","order":2},
  {"key":"target_length","name":"目标字数","description":"预计完成的总字数","type":"number","required":false,"defaultValue":null,"options":[],"group":"创作目标","order":3},
  {"key":"reader_promise","name":"读者承诺","description":"读者持续阅读会稳定获得什么体验","type":"long_text","required":false,"defaultValue":null,"options":[],"group":"创作目标","order":4},
  {"key":"content_boundaries","name":"内容边界","description":"明确不写、慎写或必须遵守的内容规则","type":"long_text","required":false,"defaultValue":null,"options":[],"group":"创作边界","order":5}
]$json$::jsonb, 10),
('10000000-0000-4000-8000-000000000002', '11000000-0000-4000-8000-000000000002', 'story_idea', '故事构思', '记录故事发动机、核心冲突、代价和结局方向。', $json$[
  {"key":"logline","name":"一句话故事","description":"谁为了什么目标，必须克服什么阻碍","type":"long_text","required":true,"defaultValue":null,"options":[],"group":"故事核心","order":0},
  {"key":"protagonist_goal","name":"主角目标","description":"主角在故事中持续追求的结果","type":"long_text","required":false,"defaultValue":null,"options":[],"group":"故事核心","order":1},
  {"key":"core_conflict","name":"核心冲突","description":"推动故事持续升级的对抗关系","type":"long_text","required":false,"defaultValue":null,"options":[],"group":"故事核心","order":2},
  {"key":"stakes","name":"失败代价","description":"主角失败会失去什么","type":"long_text","required":false,"defaultValue":null,"options":[],"group":"故事压力","order":3},
  {"key":"ending_direction","name":"结局方向","description":"只写方向，不必提前锁死细节","type":"long_text","required":false,"defaultValue":null,"options":[],"group":"故事走向","order":4},
  {"key":"reader_payoffs","name":"核心爽点","description":"选择本书需要反复兑现的阅读满足","type":"multi_select","required":false,"defaultValue":null,"options":[{"value":"growth","label":"成长升级"},{"value":"mystery","label":"谜题揭晓"},{"value":"emotion","label":"情感拉扯"},{"value":"strategy","label":"智斗博弈"},{"value":"adventure","label":"探索发现"}],"group":"读者体验","order":5}
]$json$::jsonb, 20),
('10000000-0000-4000-8000-000000000003', '11000000-0000-4000-8000-000000000003', 'world_setting', '世界观', '维护时代、社会、文化、力量体系和不可违背的世界规则。', $json$[
  {"key":"era","name":"时代与背景","description":"故事所处时代及整体环境","type":"short_text","required":true,"defaultValue":null,"options":[],"group":"世界基础","order":0},
  {"key":"world_summary","name":"世界概述","description":"用简洁语言说明这个世界最独特的地方","type":"long_text","required":true,"defaultValue":null,"options":[],"group":"世界基础","order":1},
  {"key":"geography","name":"地理格局","description":"主要区域、环境与空间关系","type":"long_text","required":false,"defaultValue":null,"options":[],"group":"空间与社会","order":2},
  {"key":"society","name":"社会制度","description":"权力、阶层、法律和日常秩序","type":"long_text","required":false,"defaultValue":null,"options":[],"group":"空间与社会","order":3},
  {"key":"culture","name":"文化与信仰","description":"习俗、宗教、价值观和禁忌","type":"long_text","required":false,"defaultValue":null,"options":[],"group":"文化与规则","order":4},
  {"key":"power_rules","name":"力量体系","description":"能力来源、成长路径和使用代价","type":"long_text","required":false,"defaultValue":null,"options":[],"group":"文化与规则","order":5},
  {"key":"hard_rules","name":"世界硬规则","description":"剧情不能随意违反的底层规则","type":"long_text","required":false,"defaultValue":null,"options":[],"group":"文化与规则","order":6}
]$json$::jsonb, 30),
('10000000-0000-4000-8000-000000000004', '11000000-0000-4000-8000-000000000004', 'character', '人物', '记录人物相对稳定的身份、外在表现和内在驱动力。', $json$[
  {"key":"name","name":"姓名","description":"人物在故事中使用的主要姓名","type":"short_text","required":true,"defaultValue":null,"options":[],"group":"基本信息","order":0},
  {"key":"aliases","name":"别名","description":"昵称、称号或化名，多个可用顿号分隔","type":"short_text","required":false,"defaultValue":null,"options":[],"group":"基本信息","order":1},
  {"key":"story_role","name":"人物定位","description":"人物在故事结构中的主要职责","type":"select","required":true,"defaultValue":null,"options":[{"value":"protagonist","label":"主角"},{"value":"supporting","label":"重要配角"},{"value":"antagonist","label":"反派"},{"value":"mentor","label":"导师"},{"value":"opponent","label":"对手"},{"value":"minor","label":"次要人物"}],"group":"基本信息","order":2},
  {"key":"identity","name":"身份","description":"职业、社会身份或公开立场","type":"short_text","required":false,"defaultValue":null,"options":[],"group":"基本信息","order":3},
  {"key":"age","name":"年龄","description":"人物当前年龄","type":"number","required":false,"defaultValue":null,"options":[],"group":"基本信息","order":4},
  {"key":"appearance","name":"外貌","description":"可被读者观察到的稳定外貌特征","type":"long_text","required":false,"defaultValue":null,"options":[],"group":"外在表现","order":5},
  {"key":"language_habit","name":"语言习惯","description":"口头禅、措辞或说话节奏","type":"long_text","required":false,"defaultValue":null,"options":[],"group":"外在表现","order":6},
  {"key":"signature_action","name":"标志性动作","description":"反复出现且能识别人物的行为","type":"long_text","required":false,"defaultValue":null,"options":[],"group":"外在表现","order":7},
  {"key":"personality","name":"性格","description":"影响人物选择的稳定性格和行为倾向","type":"long_text","required":false,"defaultValue":null,"options":[],"group":"内在驱动力","order":8},
  {"key":"goal","name":"长期目标","description":"人物长期想要实现的结果","type":"long_text","required":false,"defaultValue":null,"options":[],"group":"内在驱动力","order":9},
  {"key":"desire","name":"深层欲望","description":"人物真正渴望但未必承认的东西","type":"long_text","required":false,"defaultValue":null,"options":[],"group":"内在驱动力","order":10},
  {"key":"fear","name":"恐惧","description":"人物最害怕面对或失去的东西","type":"long_text","required":false,"defaultValue":null,"options":[],"group":"内在驱动力","order":11},
  {"key":"secret","name":"秘密","description":"尚未向其他人物或读者公开的信息","type":"long_text","required":false,"defaultValue":null,"options":[],"group":"内在驱动力","order":12}
]$json$::jsonb, 40),
('10000000-0000-4000-8000-000000000005', '11000000-0000-4000-8000-000000000005', 'location', '地点', '记录重要场所的氛围、功能、风险和进入条件。', $json$[
  {"key":"name","name":"地点名称","description":"故事中使用的稳定名称","type":"short_text","required":true,"defaultValue":null,"options":[],"group":"基本信息","order":0},
  {"key":"location_type","name":"地点类型","description":"地点在世界中的层级","type":"select","required":false,"defaultValue":null,"options":[{"value":"world","label":"世界区域"},{"value":"country","label":"国家或领地"},{"value":"city","label":"城市"},{"value":"building","label":"建筑"},{"value":"room","label":"室内空间"},{"value":"wild","label":"野外地点"}],"group":"基本信息","order":1},
  {"key":"appearance","name":"空间外观","description":"读者首先能看到的环境特征","type":"long_text","required":false,"defaultValue":null,"options":[],"group":"空间体验","order":2},
  {"key":"atmosphere","name":"氛围","description":"声音、气味、光线和情绪感受","type":"long_text","required":false,"defaultValue":null,"options":[],"group":"空间体验","order":3},
  {"key":"story_function","name":"剧情功能","description":"这个地点适合发生什么类型的情节","type":"long_text","required":false,"defaultValue":null,"options":[],"group":"剧情作用","order":4},
  {"key":"risk","name":"风险与秘密","description":"地点中隐藏的危险、限制或秘密","type":"long_text","required":false,"defaultValue":null,"options":[],"group":"剧情作用","order":5},
  {"key":"access_rule","name":"进入条件","description":"人物进入或离开这里需要满足什么条件","type":"long_text","required":false,"defaultValue":null,"options":[],"group":"剧情作用","order":6}
]$json$::jsonb, 50),
('10000000-0000-4000-8000-000000000006', '11000000-0000-4000-8000-000000000006', 'faction', '势力', '记录组织、阵营或国家的目标、资源和内部矛盾。', $json$[
  {"key":"name","name":"势力名称","description":"组织、阵营或国家的名称","type":"short_text","required":true,"defaultValue":null,"options":[],"group":"基本信息","order":0},
  {"key":"faction_type","name":"势力类型","description":"势力的组织形态","type":"select","required":false,"defaultValue":null,"options":[{"value":"country","label":"国家政权"},{"value":"organization","label":"组织机构"},{"value":"family","label":"家族"},{"value":"religion","label":"宗教"},{"value":"company","label":"商业集团"},{"value":"informal","label":"非正式阵营"}],"group":"基本信息","order":1},
  {"key":"purpose","name":"核心目标","description":"势力长期追求的结果","type":"long_text","required":false,"defaultValue":null,"options":[],"group":"目标与资源","order":2},
  {"key":"leader","name":"领导结构","description":"谁掌权以及如何做出决策","type":"long_text","required":false,"defaultValue":null,"options":[],"group":"目标与资源","order":3},
  {"key":"resources","name":"关键资源","description":"势力可调动的人力、财富、技术或影响力","type":"long_text","required":false,"defaultValue":null,"options":[],"group":"目标与资源","order":4},
  {"key":"internal_conflict","name":"内部矛盾","description":"派系、利益和价值观冲突","type":"long_text","required":false,"defaultValue":null,"options":[],"group":"冲突","order":5},
  {"key":"external_stance","name":"对外立场","description":"势力对外部世界的公开态度与策略","type":"long_text","required":false,"defaultValue":null,"options":[],"group":"冲突","order":6}
]$json$::jsonb, 60),
('10000000-0000-4000-8000-000000000007', '11000000-0000-4000-8000-000000000007', 'prop', '道具', '记录重要物品的来源、能力、限制和当前状态。', $json$[
  {"key":"name","name":"道具名称","description":"物品在故事中的稳定名称","type":"short_text","required":true,"defaultValue":null,"options":[],"group":"基本信息","order":0},
  {"key":"prop_type","name":"道具类型","description":"物品的用途类别","type":"select","required":false,"defaultValue":null,"options":[{"value":"weapon","label":"武器"},{"value":"tool","label":"工具"},{"value":"document","label":"文书或证物"},{"value":"treasure","label":"宝物"},{"value":"consumable","label":"消耗品"},{"value":"symbol","label":"象征物"}],"group":"基本信息","order":1},
  {"key":"appearance","name":"外观特征","description":"便于在正文中稳定描写的视觉特征","type":"long_text","required":false,"defaultValue":null,"options":[],"group":"表现","order":2},
  {"key":"origin","name":"来源","description":"制造者、发现地点或历史来历","type":"long_text","required":false,"defaultValue":null,"options":[],"group":"背景","order":3},
  {"key":"ability","name":"能力与用途","description":"物品能做什么以及如何影响剧情","type":"long_text","required":false,"defaultValue":null,"options":[],"group":"能力规则","order":4},
  {"key":"limit","name":"限制与代价","description":"使用条件、次数、风险或副作用","type":"long_text","required":false,"defaultValue":null,"options":[],"group":"能力规则","order":5},
  {"key":"prop_status","name":"当前状态","description":"物品当前是否可用","type":"select","required":false,"defaultValue":"available","options":[{"value":"available","label":"可用"},{"value":"damaged","label":"损坏"},{"value":"lost","label":"遗失"},{"value":"consumed","label":"已消耗"},{"value":"sealed","label":"封存"}],"group":"状态","order":6}
]$json$::jsonb, 70),
('10000000-0000-4000-8000-000000000008', '11000000-0000-4000-8000-000000000008', 'event', '事件', '记录故事事实的起因、经过、结果和时间位置。', $json$[
  {"key":"name","name":"事件名称","description":"便于检索和引用的简短名称","type":"short_text","required":true,"defaultValue":null,"options":[],"group":"基本信息","order":0},
  {"key":"story_time","name":"故事时间","description":"事件在故事世界中的时间位置","type":"short_text","required":false,"defaultValue":null,"options":[],"group":"时间位置","order":1},
  {"key":"summary","name":"事件概述","description":"用结果明确的语言概括发生了什么","type":"long_text","required":true,"defaultValue":null,"options":[],"group":"事件过程","order":2},
  {"key":"cause","name":"起因","description":"事件为何发生","type":"long_text","required":false,"defaultValue":null,"options":[],"group":"事件过程","order":3},
  {"key":"process","name":"关键经过","description":"只记录改变结果的关键动作","type":"long_text","required":false,"defaultValue":null,"options":[],"group":"事件过程","order":4},
  {"key":"result","name":"结果与影响","description":"事件结束后世界发生了什么变化","type":"long_text","required":false,"defaultValue":null,"options":[],"group":"结果","order":5},
  {"key":"importance","name":"重要程度","description":"决定检索和回顾优先级","type":"select","required":false,"defaultValue":"major","options":[{"value":"minor","label":"局部事件"},{"value":"major","label":"重要事件"},{"value":"turning_point","label":"关键转折"}],"group":"结果","order":6},
  {"key":"event_status","name":"事件状态","description":"事件当前推进阶段","type":"select","required":false,"defaultValue":"planned","options":[{"value":"planned","label":"计划中"},{"value":"happening","label":"进行中"},{"value":"completed","label":"已发生"},{"value":"cancelled","label":"已废弃"}],"group":"状态","order":7}
]$json$::jsonb, 80),
('10000000-0000-4000-8000-000000000009', '11000000-0000-4000-8000-000000000009', 'time_rule', '时间规则', '记录历法、纪年、时间尺度和叙事顺序规则。', $json$[
  {"key":"calendar","name":"历法与纪年","description":"世界如何记录日期、季节和年份","type":"long_text","required":true,"defaultValue":null,"options":[],"group":"时间体系","order":0},
  {"key":"story_start","name":"故事起点","description":"主线故事开始时的明确时间坐标","type":"short_text","required":false,"defaultValue":null,"options":[],"group":"时间体系","order":1},
  {"key":"time_scale","name":"时间尺度","description":"整本书大约跨越多久，日常推进速度如何","type":"long_text","required":false,"defaultValue":null,"options":[],"group":"时间体系","order":2},
  {"key":"chronology_rules","name":"先后规则","description":"年龄、路程、季节和事件间隔需要遵守的规则","type":"long_text","required":false,"defaultValue":null,"options":[],"group":"一致性","order":3},
  {"key":"narrative_strategy","name":"叙事时间策略","description":"是否使用倒叙、插叙、多线并行及其切换原则","type":"long_text","required":false,"defaultValue":null,"options":[],"group":"叙事安排","order":4}
]$json$::jsonb, 90),
('10000000-0000-4000-8000-000000000010', '11000000-0000-4000-8000-000000000010', 'foreshadow_clue', '线索与伏笔', '记录线索、伏笔、误导及其埋设和回收计划。', $json$[
  {"key":"name","name":"名称","description":"便于追踪的线索或伏笔名称","type":"short_text","required":true,"defaultValue":null,"options":[],"group":"基本信息","order":0},
  {"key":"kind","name":"类型","description":"区分线索、伏笔和有意误导","type":"select","required":true,"defaultValue":"foreshadow","options":[{"value":"clue","label":"线索"},{"value":"foreshadow","label":"伏笔"},{"value":"misdirection","label":"误导"}],"group":"基本信息","order":1},
  {"key":"content","name":"实际内容","description":"读者或人物能够接触到的具体信息","type":"long_text","required":true,"defaultValue":null,"options":[],"group":"内容","order":2},
  {"key":"planted_at","name":"计划埋设位置","description":"准备在哪一卷、章或场景首次出现","type":"short_text","required":false,"defaultValue":null,"options":[],"group":"推进计划","order":3},
  {"key":"payoff_plan","name":"回收计划","description":"何时、通过什么事实完成揭示或回收","type":"long_text","required":false,"defaultValue":null,"options":[],"group":"推进计划","order":4},
  {"key":"clue_status","name":"当前状态","description":"线索或伏笔的推进阶段","type":"select","required":false,"defaultValue":"planned","options":[{"value":"planned","label":"待埋设"},{"value":"planted","label":"已埋设"},{"value":"reinforced","label":"已强化"},{"value":"paid_off","label":"已回收"},{"value":"abandoned","label":"已废弃"}],"group":"状态","order":5},
  {"key":"urgency","name":"回收紧迫度","description":"数值越高越需要尽快处理","type":"number","required":false,"defaultValue":null,"options":[],"group":"状态","order":6}
]$json$::jsonb, 100),
('10000000-0000-4000-8000-000000000011', '11000000-0000-4000-8000-000000000011', 'volume_plan', '卷规划', '规划一卷的主题、目标、转折、高潮和结束状态。', $json$[
  {"key":"volume_name","name":"卷名","description":"这一卷的名称或工作标题","type":"short_text","required":true,"defaultValue":null,"options":[],"group":"卷信息","order":0},
  {"key":"theme","name":"卷主题","description":"这一卷主要检验什么价值或命题","type":"long_text","required":false,"defaultValue":null,"options":[],"group":"卷信息","order":1},
  {"key":"opening_state","name":"开局状态","description":"本卷开始时人物与局势处于什么状态","type":"long_text","required":false,"defaultValue":null,"options":[],"group":"结构节点","order":2},
  {"key":"major_goal","name":"本卷目标","description":"本卷结束前必须完成的主要推进","type":"long_text","required":true,"defaultValue":null,"options":[],"group":"结构节点","order":3},
  {"key":"midpoint_turn","name":"中段转折","description":"改变人物策略或冲突性质的关键变化","type":"long_text","required":false,"defaultValue":null,"options":[],"group":"结构节点","order":4},
  {"key":"climax","name":"卷高潮","description":"本卷最强冲突及其选择","type":"long_text","required":false,"defaultValue":null,"options":[],"group":"结构节点","order":5},
  {"key":"ending_state","name":"结束状态","description":"本卷结束后人物、关系和世界发生的变化","type":"long_text","required":false,"defaultValue":null,"options":[],"group":"结果","order":6}
]$json$::jsonb, 110),
('10000000-0000-4000-8000-000000000012', '11000000-0000-4000-8000-000000000012', 'chapter_plan', '章节规划', '明确一章的目标、冲突、信息释放、伏笔动作和结尾钩子。', $json$[
  {"key":"chapter_name","name":"章节名","description":"章节标题或工作标题","type":"short_text","required":true,"defaultValue":null,"options":[],"group":"章节信息","order":0},
  {"key":"chapter_number","name":"章节序号","description":"章节在全书中的顺序","type":"number","required":false,"defaultValue":null,"options":[],"group":"章节信息","order":1},
  {"key":"chapter_goal","name":"章节目标","description":"本章结束时必须完成的剧情变化","type":"long_text","required":true,"defaultValue":null,"options":[],"group":"推进任务","order":2},
  {"key":"conflict","name":"核心冲突","description":"阻止目标轻易完成的主要阻力","type":"long_text","required":false,"defaultValue":null,"options":[],"group":"推进任务","order":3},
  {"key":"participants","name":"参与人物","description":"第一阶段先用名称记录，关系阶段再升级为卡片引用","type":"long_text","required":false,"defaultValue":null,"options":[],"group":"场景装配","order":4},
  {"key":"location","name":"主要地点","description":"第一阶段先用名称记录，关系阶段再升级为地点引用","type":"short_text","required":false,"defaultValue":null,"options":[],"group":"场景装配","order":5},
  {"key":"must_reveal","name":"必须释放的信息","description":"读者在本章应新知道什么","type":"long_text","required":false,"defaultValue":null,"options":[],"group":"信息控制","order":6},
  {"key":"foreshadow_action","name":"伏笔动作","description":"本章需要埋设、强化或回收什么","type":"long_text","required":false,"defaultValue":null,"options":[],"group":"信息控制","order":7},
  {"key":"ending_hook","name":"结尾钩子","description":"推动读者进入下一章的问题或变化","type":"long_text","required":false,"defaultValue":null,"options":[],"group":"章节结尾","order":8}
]$json$::jsonb, 120),
('10000000-0000-4000-8000-000000000013', '11000000-0000-4000-8000-000000000013', 'scene_plan', '场景规划', '拆解场景视角、目标、阻碍、转折和离场状态。', $json$[
  {"key":"scene_name","name":"场景名称","description":"便于在章节内识别的工作名称","type":"short_text","required":true,"defaultValue":null,"options":[],"group":"场景信息","order":0},
  {"key":"order_number","name":"场景顺序","description":"场景在当前章节中的顺序","type":"number","required":false,"defaultValue":null,"options":[],"group":"场景信息","order":1},
  {"key":"pov","name":"视角人物","description":"本场景由谁感知和叙述","type":"short_text","required":false,"defaultValue":null,"options":[],"group":"场景装配","order":2},
  {"key":"location","name":"发生地点","description":"本场景发生的主要空间","type":"short_text","required":false,"defaultValue":null,"options":[],"group":"场景装配","order":3},
  {"key":"objective","name":"场景目标","description":"视角人物此刻想得到什么","type":"long_text","required":true,"defaultValue":null,"options":[],"group":"场景动力","order":4},
  {"key":"obstacle","name":"阻碍","description":"什么力量阻止目标轻易实现","type":"long_text","required":false,"defaultValue":null,"options":[],"group":"场景动力","order":5},
  {"key":"turn","name":"场景转折","description":"信息、力量或选择发生的关键改变","type":"long_text","required":false,"defaultValue":null,"options":[],"group":"场景动力","order":6},
  {"key":"exit_state","name":"离场状态","description":"场景结束后目标、情绪和局势如何变化","type":"long_text","required":false,"defaultValue":null,"options":[],"group":"场景结果","order":7}
]$json$::jsonb, 130),
('10000000-0000-4000-8000-000000000014', '11000000-0000-4000-8000-000000000014', 'research_note', '研究资料', '保存来源明确、可验证并能服务具体创作问题的资料。', $json$[
  {"key":"topic","name":"资料主题","description":"这份资料解决哪个创作问题","type":"short_text","required":true,"defaultValue":null,"options":[],"group":"资料信息","order":0},
  {"key":"source","name":"来源名称","description":"书籍、文章、访谈或实地观察的名称","type":"short_text","required":false,"defaultValue":null,"options":[],"group":"资料信息","order":1},
  {"key":"citation","name":"来源地址或页码","description":"保留可回查的链接、页码或文件位置","type":"short_text","required":false,"defaultValue":null,"options":[],"group":"资料信息","order":2},
  {"key":"summary","name":"内容摘要","description":"用自己的话概括资料结论","type":"long_text","required":true,"defaultValue":null,"options":[],"group":"内容","order":3},
  {"key":"usable_facts","name":"可用事实","description":"可直接用于世界、人物或情节的事实清单","type":"long_text","required":false,"defaultValue":null,"options":[],"group":"内容","order":4},
  {"key":"reliability","name":"可靠程度","description":"根据来源质量标记使用方式","type":"select","required":false,"defaultValue":"reference","options":[{"value":"verified","label":"已核实"},{"value":"reference","label":"仅供参考"},{"value":"uncertain","label":"待核实"}],"group":"可信度","order":5},
  {"key":"tags","name":"标签","description":"使用逗号分隔检索标签","type":"multi_select","required":false,"defaultValue":null,"options":[{"value":"history","label":"历史"},{"value":"science","label":"科学"},{"value":"profession","label":"职业"},{"value":"culture","label":"文化"},{"value":"location","label":"地点"}],"group":"整理","order":6}
]$json$::jsonb, 140);

INSERT INTO card_types (
  id, space_id, type_key, name, description, status, revision,
  current_version_id, draft_fields, is_system, sort_order
)
SELECT id, '00000000-0000-4000-8000-000000000001', type_key, name, description,
       'published', 1, version_id, fields, true, sort_order
FROM builtin_card_types
ON CONFLICT DO NOTHING;

INSERT INTO card_type_versions (id, card_type_id, version, fields)
SELECT seed.version_id, seed.id, 1, seed.fields
FROM builtin_card_types seed
JOIN card_types card_type ON card_type.id = seed.id
ON CONFLICT DO NOTHING;

UPDATE card_types card_type
SET current_version_id = seed.version_id,
    status = 'published',
    is_system = true,
    sort_order = seed.sort_order
FROM builtin_card_types seed
WHERE card_type.id = seed.id;


SET search_path TO new_design, public;



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


INSERT INTO relation_types (
  id, relation_key, name, description, direction, source_type_keys,
  target_type_keys, source_max, target_max, scope, properties_schema
) VALUES
('33000000-0000-4000-8000-000000000001', 'event_participant', '事件参与者', '人物参与某一事件。', 'directed', ARRAY['event'], ARRAY['character'], NULL, NULL, 'system', $json$[
  {"key":"goal","name":"本事件目标","type":"long_text","required":false},
  {"key":"stance","name":"本事件立场","type":"long_text","required":false},
  {"key":"result","name":"本事件结果","type":"long_text","required":false}
]$json$::jsonb),
('33000000-0000-4000-8000-000000000002', 'event_location', '事件发生地点', '事件在一个主要地点发生。', 'directed', ARRAY['event'], ARRAY['location'], 1, NULL, 'system', '[]'),
('33000000-0000-4000-8000-000000000003', 'event_prop', '事件涉及道具', '事件使用、争夺或改变某件道具。', 'directed', ARRAY['event'], ARRAY['prop'], NULL, NULL, 'system', $json$[
  {"key":"usage","name":"事件中的用途","type":"long_text","required":false}
]$json$::jsonb),
('33000000-0000-4000-8000-000000000004', 'event_plotline', '事件所属剧情线', '事件推进一条主要剧情线。', 'directed', ARRAY['event'], ARRAY['plotline'], 1, NULL, 'system', '[]')
ON CONFLICT DO NOTHING;
SELECT kernel_store_record('card_type_category','00000000-0000-4000-8000-000000000001','52000000-0000-4000-8000-000000000001','{"id":"52000000-0000-4000-8000-000000000001","category_key":"creative_strategy","name":"创作策略","parent_id":null,"sort_order":10,"is_system":true,"status":"active","revision":1}'::jsonb);
SELECT kernel_store_record('card_type_category','00000000-0000-4000-8000-000000000001','52000000-0000-4000-8000-000000000002','{"id":"52000000-0000-4000-8000-000000000002","category_key":"people_organizations","name":"人物与组织","parent_id":null,"sort_order":20,"is_system":true,"status":"active","revision":1}'::jsonb);
SELECT kernel_store_record('card_type_category','00000000-0000-4000-8000-000000000001','52000000-0000-4000-8000-000000000003','{"id":"52000000-0000-4000-8000-000000000003","category_key":"world_setting","name":"世界设定","parent_id":null,"sort_order":30,"is_system":true,"status":"active","revision":1}'::jsonb);
SELECT kernel_store_record('card_type_category','00000000-0000-4000-8000-000000000001','52000000-0000-4000-8000-000000000004','{"id":"52000000-0000-4000-8000-000000000004","category_key":"story_structure","name":"剧情结构","parent_id":null,"sort_order":40,"is_system":true,"status":"active","revision":1}'::jsonb);
SELECT kernel_store_record('card_type_category','00000000-0000-4000-8000-000000000001','52000000-0000-4000-8000-000000000005','{"id":"52000000-0000-4000-8000-000000000005","category_key":"chapter_structure","name":"篇章结构","parent_id":null,"sort_order":50,"is_system":true,"status":"active","revision":1}'::jsonb);
SELECT kernel_store_record('card_type_category','00000000-0000-4000-8000-000000000001','52000000-0000-4000-8000-000000000006','{"id":"52000000-0000-4000-8000-000000000006","category_key":"reference_materials","name":"参考资料","parent_id":null,"sort_order":60,"is_system":true,"status":"active","revision":1}'::jsonb);
SELECT kernel_store_record('card_type_category','00000000-0000-4000-8000-000000000001','65000000-0000-4000-8000-000000000001','{"id":"65000000-0000-4000-8000-000000000001","category_key":"ai_resources","name":"AI 资源","parent_id":null,"sort_order":70,"is_system":true,"status":"active","revision":1}'::jsonb);
-- 系统作品约定是开书入口，不能随旧样例清理逻辑隐藏。
UPDATE card_types SET status='published',is_system=true,is_internal=false WHERE type_key='project_rule' AND space_id='00000000-0000-4000-8000-000000000001';
UPDATE card_types SET category_id=CASE
 WHEN type_key IN ('genre_strategy','progression_mode','writing_config','quality_rule','project_rule') THEN '52000000-0000-4000-8000-000000000001'::uuid
 WHEN type_key IN ('character','organization') THEN '52000000-0000-4000-8000-000000000002'::uuid
 WHEN type_key IN ('world_overview','world_rule','location','prop','power_system','race','culture','religion') THEN '52000000-0000-4000-8000-000000000003'::uuid
 WHEN type_key IN ('event','goal_task','conflict','secret_truth','clue_evidence','foreshadow','suspense_question','plotline','plot_beat','arc','theme') THEN '52000000-0000-4000-8000-000000000004'::uuid
 WHEN type_key IN ('volume','chapter','scene') THEN '52000000-0000-4000-8000-000000000005'::uuid
 WHEN type_key='reference_material' THEN '52000000-0000-4000-8000-000000000006'::uuid
 WHEN type_key='prompt_component' THEN '65000000-0000-4000-8000-000000000001'::uuid ELSE category_id END
WHERE NOT is_internal AND space_id='00000000-0000-4000-8000-000000000001';

INSERT INTO card_types(id,space_id,type_key,name,description,status,is_system,sort_order,draft_fields)
VALUES('65000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001','title_candidate','标题候选','比较标题与读者承诺；明确采用只修改目标书名。','published',true,230,$json$[
 {"key":"promise","name":"读者承诺","description":"这个标题让读者期待什么","type":"long_text","required":true,"defaultValue":null,"options":[],"group":"标题比较","order":0},
 {"key":"fit","name":"题材与受众","description":"适合的故事与读者","type":"long_text","required":false,"defaultValue":null,"options":[],"group":"标题比较","order":1},
 {"key":"risk","name":"误导风险","description":"可能造成哪些不恰当期待","type":"long_text","required":false,"defaultValue":null,"options":[],"group":"标题比较","order":2}
]$json$::jsonb);
INSERT INTO card_type_versions(id,card_type_id,version,fields)
SELECT '65000000-0000-4000-8000-000000000002',id,1,draft_fields FROM card_types WHERE id='65000000-0000-4000-8000-000000000001';
UPDATE card_types SET current_version_id='65000000-0000-4000-8000-000000000002' WHERE id='65000000-0000-4000-8000-000000000001';

-- 模板直接记录当前正式规格；空作品由作者明确创建，不安装演示书。
INSERT INTO relation_types(id,relation_key,name,description,direction,source_type_keys,target_type_keys,scope,properties_schema)
VALUES('11600000-0000-4000-8000-000000000001','world_sample_relation','世界样本关系','世界生成候选明确发布时保留的势力、地点及世界对象关系。','directed',ARRAY['world_overview','organization','location'],ARRAY['world_overview','organization','location'],'system','[{"key":"relation","name":"关系","type":"short_text","required":true},{"key":"tension","name":"张力","type":"long_text","required":true}]'::jsonb);
