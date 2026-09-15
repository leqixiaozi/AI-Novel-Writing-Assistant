SET search_path TO new_design, public;

ALTER TABLE card_types ADD COLUMN IF NOT EXISTS is_system boolean NOT NULL DEFAULT false;
ALTER TABLE card_types ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 1000;

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

CREATE TEMP TABLE builtin_cards (
  id uuid PRIMARY KEY,
  version_id uuid NOT NULL,
  card_type_id uuid NOT NULL,
  type_version_id uuid NOT NULL,
  title text NOT NULL,
  values jsonb NOT NULL
) ON COMMIT DROP;

INSERT INTO builtin_cards (id, version_id, card_type_id, type_version_id, title, values) VALUES
('12000000-0000-4000-8000-000000000001', '13000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '11000000-0000-4000-8000-000000000001', '新书创作约定', $json${"perspective":"third_limited","tense":"past","tone":"先写清晰、具体、可感知的行动，再补充修辞；人物语言保持身份差异。","reader_promise":"明确本书最稳定的阅读满足，再让每一卷持续兑现。","content_boundaries":"把不允许推翻的设定和不希望出现的内容写在这里。"}$json$::jsonb),
('12000000-0000-4000-8000-000000000002', '13000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', '11000000-0000-4000-8000-000000000002', '核心故事构思', $json${"logline":"用一句话写清：谁，为了什么目标，必须克服什么阻碍。","protagonist_goal":"把主角真正想得到的结果写在这里。","core_conflict":"说明哪股力量会持续阻止主角。","stakes":"如果失败，主角会失去什么？","ending_direction":"先确定结局的情绪和方向，不必提前锁死细节。"}$json$::jsonb),
('12000000-0000-4000-8000-000000000003', '13000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000003', '11000000-0000-4000-8000-000000000003', '主世界观', $json${"era":"填写故事所处时代与总体环境","world_summary":"用三到五句话写清这个世界与现实或同类故事最不同的地方。","geography":"先列出会真正进入剧情的主要区域。","society":"说明谁掌握权力，普通人如何生活。","hard_rules":"只记录剧情不能为了方便而临时推翻的规则。"}$json$::jsonb),
('12000000-0000-4000-8000-000000000004', '13000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000009', '11000000-0000-4000-8000-000000000009', '主线时间规则', $json${"calendar":"填写纪年、季节、一天长度等实际会影响剧情的时间规则。","story_start":"记录第一章开始时的时间坐标。","time_scale":"说明整本故事预计跨越多久。","chronology_rules":"记录年龄增长、路程耗时和事件间隔必须遵守的规则。","narrative_strategy":"说明是否允许倒叙、插叙或多线并行。"}$json$::jsonb);

INSERT INTO cards (
  id, space_id, card_type_id, title, status, revision,
  type_version_id, current_version_id, values
)
SELECT id, '00000000-0000-4000-8000-000000000001', card_type_id, title,
       'active', 1, type_version_id, version_id, values
FROM builtin_cards
ON CONFLICT (id) DO NOTHING;

INSERT INTO card_versions (
  id, card_id, revision, type_version_id, title, values, source
)
SELECT seed.version_id, seed.id, 1, seed.type_version_id, seed.title, seed.values, 'create'
FROM builtin_cards seed
JOIN cards card ON card.id = seed.id
ON CONFLICT DO NOTHING;
