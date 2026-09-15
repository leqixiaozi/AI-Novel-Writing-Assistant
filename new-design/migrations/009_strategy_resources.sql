SET search_path TO new_design, public;

INSERT INTO card_spaces (id,space_key,name)
VALUES ('60000000-0000-4000-8000-000000000001','resource_strategy','创作策略资源')
ON CONFLICT (space_key) DO NOTHING;

ALTER TABLE card_field_origins DROP CONSTRAINT card_field_origins_source_kind_check;
ALTER TABLE card_field_origins ADD CONSTRAINT card_field_origins_source_kind_check
  CHECK (source_kind IN ('template','ai','user','resource'));

CREATE TABLE resource_adoptions (
  id uuid PRIMARY KEY,
  resource_card_id uuid NOT NULL REFERENCES cards(id),
  resource_version_id uuid NOT NULL REFERENCES card_versions(id),
  book_id uuid NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  target_card_id uuid NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  action text NOT NULL CHECK (action IN ('install_snapshot')),
  snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX resource_adoptions_book_idx ON resource_adoptions(book_id,created_at DESC);
CREATE INDEX resource_adoptions_source_idx ON resource_adoptions(resource_card_id,created_at DESC);

CREATE TEMP TABLE strategy_resource_seeds (
  card_id uuid PRIMARY KEY,
  version_id uuid NOT NULL,
  type_key text NOT NULL,
  title text NOT NULL,
  values jsonb NOT NULL
) ON COMMIT DROP;

INSERT INTO strategy_resource_seeds VALUES
('61000000-0000-4000-8000-000000000001','62000000-0000-4000-8000-000000000001','genre_strategy','仙侠成长与谜团', $json${"genre":"仙侠","subgenres":["adventure","mystery","growth"],"target_audience":"喜欢力量成长、世界秘密与长期伏笔回收的读者","core_promise":"主角每次突破都会打开更大的世界，同时让旧谜团出现可验证的新答案。","market_position":"成长爽感与设定解谜并行，不把境界升级当作唯一剧情。","forbidden_drift":"禁止连续升级却没有选择代价；禁止用临时设定解决已经建立的世界规则。"}$json$),
('61000000-0000-4000-8000-000000000002','62000000-0000-4000-8000-000000000002','genre_strategy','都市悬疑与职业现场', $json${"genre":"都市悬疑","subgenres":["mystery"],"target_audience":"喜欢现实质感、职业细节与连续案件的读者","core_promise":"每个局部事件给出阶段答案，同时推动一条能够改变人物关系的长期真相。","market_position":"用职业行动制造线索，不依赖巧合和全知旁白破案。","forbidden_drift":"禁止角色只靠口头推理推进；关键答案必须有此前出现过的事实支撑。"}$json$),
('61000000-0000-4000-8000-000000000003','62000000-0000-4000-8000-000000000003','genre_strategy','情感成长与群像关系', $json${"genre":"情感成长","subgenres":["romance","growth"],"target_audience":"重视人物选择、关系变化和情绪兑现的读者","core_promise":"重要关系通过共同经历发生可见变化，每次靠近都伴随新的理解或代价。","market_position":"以行动和后果建立情感，不用误会反复拖延关系进展。","forbidden_drift":"禁止用角色突然降智制造矛盾；禁止重要和解缺少行为上的偿还。"}$json$),
('61000000-0000-4000-8000-000000000004','62000000-0000-4000-8000-000000000004','progression_mode','任务—阻碍—兑现循环', $json${"name":"任务—阻碍—兑现循环","story_unit":"具有明确完成条件的任务","cycle":"确认任务与代价 → 采取行动 → 遭遇超出预期的阻碍 → 改变策略 → 兑现结果并留下下一任务。","reward":"每轮至少兑现能力、关系、资源或认知中的一项真实变化。","escalation":"目标范围扩大，失败代价上升，且旧选择会限制后续方案。","fatigue_guard":"连续两轮不得使用相同阻碍；每三轮改变一次任务规模或参与关系。"}$json$),
('61000000-0000-4000-8000-000000000005','62000000-0000-4000-8000-000000000005','progression_mode','谜团—证据—反转循环', $json${"name":"谜团—证据—反转循环","story_unit":"一个能够阶段回答的问题","cycle":"提出可理解的问题 → 获得可核查证据 → 排除错误解释 → 新事实改变问题性质 → 给出有限答案。","reward":"每轮解决一个局部疑问，并让主谜团的答案范围更小。","escalation":"证据从外部事件逐步指向主角、同伴和既有信念。","fatigue_guard":"反转必须重解释旧证据，不能只新增从未出现的信息。"}$json$),
('61000000-0000-4000-8000-000000000006','62000000-0000-4000-8000-000000000006','progression_mode','经营—扩张—危机循环', $json${"name":"经营—扩张—危机循环","story_unit":"一次资源配置与经营目标","cycle":"盘点缺口 → 获取或交换资源 → 完成建设 → 获得阶段收益 → 新规模暴露新的治理问题。","reward":"数字增长必须转化为可见的生活、权力或关系变化。","escalation":"从个人生存升级到团队分工、组织规则和外部竞争。","fatigue_guard":"经营结果要进入人物选择，避免连续罗列产量、金额和设施。"}$json$),
('61000000-0000-4000-8000-000000000007','62000000-0000-4000-8000-000000000007','writing_config','近距离限知叙事', $json${"pov":"third_limited","tense":"past","style_tone":"贴近视角人物的感官和判断，信息只随其观察展开；句式清楚，关键动作优先。","dialogue_ratio":"balanced","chapter_length":2600,"constraints":"不写视角人物不可能知道的事实；情绪先通过动作、感官和选择呈现，再允许简短总结。"}$json$),
('61000000-0000-4000-8000-000000000008','62000000-0000-4000-8000-000000000008','writing_config','群像多视角叙事', $json${"pov":"multi_pov","tense":"past","style_tone":"每个视角拥有不同关注点和语言节奏；切换服务于信息差与立场冲突。","dialogue_ratio":"high","chapter_length":3000,"constraints":"单一场景不随意跳视角；每次切换必须带来上一视角无法提供的信息或判断。"}$json$),
('61000000-0000-4000-8000-000000000009','62000000-0000-4000-8000-000000000009','quality_rule','避免空泛总结', $json${"name":"避免空泛总结","purpose":"让重要情绪和变化可被读者从具体行动中感受到。","severity":"warning","check_scope":["chapter","scene"],"rule":"如果一段只宣告人物很震惊、局势很复杂或意义很重大，却没有新动作、感官、事实或选择，则需要重写。","ai_risk_signal":"总的来说、这一刻他明白了、命运的齿轮、气氛十分凝重等脱离场景的概括。","correction_guidance":"删去结论句，补入一个能改变当下行为的具体细节或决定。","enabled":true}$json$),
('61000000-0000-4000-8000-000000000010','62000000-0000-4000-8000-000000000010','quality_rule','人物对白可区分', $json${"name":"人物对白可区分","purpose":"让读者不看提示语也能大致判断说话者。","severity":"warning","check_scope":["chapter","scene"],"rule":"主要人物的措辞、句长、回避方式和信息习惯至少有一项稳定差异。","ai_risk_signal":"所有人物使用相同完整句、相同礼貌程度和相同解释节奏。","correction_guidance":"根据人物目标删改对白，让每个人只说他此刻愿意说且习惯说的内容。","enabled":true}$json$),
('61000000-0000-4000-8000-000000000011','62000000-0000-4000-8000-000000000011','quality_rule','场景因果闭环', $json${"name":"场景因果闭环","purpose":"保证场景结束时故事状态发生可追踪变化。","severity":"critical","check_scope":["scene","chapter"],"rule":"场景必须有可识别目标、阻碍和结果；结果要改变下一场景的选择、信息或资源。","ai_risk_signal":"场景只有聊天和说明，删除后不影响后续任何行动。","correction_guidance":"明确视角人物进入场景想得到什么，并让结果造成获得、失去、误判或新义务。","enabled":true}$json$),
('61000000-0000-4000-8000-000000000012','62000000-0000-4000-8000-000000000012','quality_rule','避免套话与近义复读', $json${"name":"避免套话与近义复读","purpose":"减少机械生成感，让每句话承担新的叙事信息。","severity":"warning","check_scope":["book","volume","chapter","scene"],"rule":"相邻句或相邻段如果只用近义词重复同一判断，应合并或替换为新的动作、证据或后果。","ai_risk_signal":"不仅……更……、仿佛在诉说、毋庸置疑、显而易见，以及连续同义情绪判断。","correction_guidance":"保留信息最具体的一句，其余改为推动场景的新事实。","enabled":true}$json$);

INSERT INTO cards (id,space_id,card_type_id,title,status,revision,type_version_id,current_version_id,values)
SELECT seed.card_id,'60000000-0000-4000-8000-000000000001',type.id,seed.title,'active',1,type.current_version_id,NULL,seed.values
FROM strategy_resource_seeds seed
JOIN card_types type ON type.space_id='00000000-0000-4000-8000-000000000001' AND type.type_key=seed.type_key
ON CONFLICT (id) DO NOTHING;

INSERT INTO card_versions (id,card_id,revision,type_version_id,title,values,source)
SELECT seed.version_id,seed.card_id,1,card.type_version_id,seed.title,seed.values,'create'
FROM strategy_resource_seeds seed
JOIN cards card ON card.id=seed.card_id
ON CONFLICT (id) DO NOTHING;

UPDATE cards card SET current_version_id=seed.version_id
FROM strategy_resource_seeds seed
WHERE card.id=seed.card_id AND card.current_version_id IS NULL;
