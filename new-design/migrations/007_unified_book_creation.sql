SET search_path TO new_design, public;

CREATE TABLE inspiration_candidates (
  id uuid PRIMARY KEY,
  title text NOT NULL,
  premise text NOT NULL,
  audience text NOT NULL DEFAULT '',
  tone jsonb NOT NULL DEFAULT '[]'::jsonb,
  sort_order integer NOT NULL DEFAULT 1000,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE book_creation_sessions (
  id uuid PRIMARY KEY,
  method text NOT NULL CHECK (method IN ('blank','template','idea','inspiration','market','reference','continuation')),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','generating','waiting_direction','review','creating','completed','failed')),
  stage text NOT NULL DEFAULT 'collect_input',
  progress integer NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  template_version_id uuid NOT NULL REFERENCES template_group_versions(id),
  book_name text NOT NULL DEFAULT '',
  description text NOT NULL DEFAULT '',
  source_reference text NOT NULL DEFAULT '',
  input_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  direction_candidates jsonb NOT NULL DEFAULT '[]'::jsonb,
  selected_direction_id text,
  initial_cards jsonb NOT NULL DEFAULT '[]'::jsonb,
  last_failed_stage text,
  error_message text,
  book_id uuid REFERENCES books(id),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX book_creation_sessions_status_idx ON book_creation_sessions(status, updated_at DESC);

CREATE TABLE ai_generation_batches (
  id uuid PRIMARY KEY,
  session_id uuid REFERENCES book_creation_sessions(id) ON DELETE CASCADE,
  book_id uuid REFERENCES books(id) ON DELETE CASCADE,
  card_id uuid REFERENCES cards(id) ON DELETE CASCADE,
  form_key text,
  operation text NOT NULL CHECK (operation IN ('directions','initial_content','form_assist')),
  status text NOT NULL CHECK (status IN ('running','review','applied','failed','discarded')),
  stage text NOT NULL,
  progress integer NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  instruction text NOT NULL DEFAULT '',
  input_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  output_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  base_revision integer,
  prompt_id text,
  prompt_version text,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE INDEX ai_generation_batches_session_idx ON ai_generation_batches(session_id, created_at DESC);
CREATE INDEX ai_generation_batches_book_idx ON ai_generation_batches(book_id, created_at DESC);

CREATE TABLE book_content_sources (
  id uuid PRIMARY KEY,
  book_id uuid NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  session_id uuid REFERENCES book_creation_sessions(id),
  method text NOT NULL,
  source_reference text NOT NULL DEFAULT '',
  source_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  confirmation_status text NOT NULL CHECK (confirmation_status IN ('draft','confirmed')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE card_field_origins (
  id uuid PRIMARY KEY,
  card_id uuid NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  field_key text NOT NULL,
  source_kind text NOT NULL CHECK (source_kind IN ('template','ai','user')),
  source_id uuid,
  generation_batch_id uuid REFERENCES ai_generation_batches(id),
  confirmation_status text NOT NULL CHECK (confirmation_status IN ('template_suggestion','ai_draft','confirmed','user_content')),
  original_value jsonb,
  current_value jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (card_id, field_key)
);

INSERT INTO inspiration_candidates (id,title,premise,audience,tone,sort_order) VALUES
('51000000-0000-4000-8000-000000000001','记忆当铺','每次使用力量都会失去一段珍贵记忆，主角必须在拯救故乡和保住自我之间做选择。','喜欢成长、牺牲与强情绪回报的读者','["克制","悬疑","成长"]',10),
('51000000-0000-4000-8000-000000000002','末班地铁','城市最后一班地铁只接送即将从世界上消失的人，新任司机决定打破运行规则。','喜欢都市奇谈和单元故事的读者','["都市奇幻","温暖","反转"]',20),
('51000000-0000-4000-8000-000000000003','反派退休指南','被预言会毁灭世界的人提前退休，却发现所有正派都在逼他重新营业。','喜欢轻松反套路与群像互动的读者','["轻喜剧","反套路","群像"]',30),
('51000000-0000-4000-8000-000000000004','失踪的春天','王国连续七年没有春天，一名不会魔法的园丁发现季节被锁在王室旧档案里。','喜欢童话感冒险与秘密探索的读者','["奇幻","冒险","治愈"]',40),
('51000000-0000-4000-8000-000000000005','第七码头','海港每天凌晨会多出一座不存在的码头，只有负债累累的女船长能看见它。','喜欢海洋冒险和生存经营的读者','["冒险","经营","神秘"]',50),
('51000000-0000-4000-8000-000000000006','妖怪社区调解员','刚入职的社区工作者发现辖区居民都是隐居妖怪，而第一桩纠纷牵出百年前的失约。','喜欢现代幻想、日常与人情故事的读者','["现代幻想","日常","温情"]',60)
ON CONFLICT DO NOTHING;
