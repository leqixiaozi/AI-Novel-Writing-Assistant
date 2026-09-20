-- Optional manual extension. Back up and restore-test before applying; never run on startup.
SET search_path TO new_design,public;

CREATE TABLE payoff_window_versions (
  id uuid PRIMARY KEY,
  book_id uuid NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  card_id uuid NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  version integer NOT NULL CHECK (version > 0),
  start_chapter_order integer CHECK (start_chapter_order > 0),
  end_chapter_order integer CHECK (end_chapter_order > 0),
  idempotency_key uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (book_id,card_id,version),
  UNIQUE (book_id,idempotency_key),
  UNIQUE (id,book_id,card_id),
  CHECK (start_chapter_order IS NULL OR end_chapter_order IS NULL OR start_chapter_order <= end_chapter_order)
);

CREATE TABLE payoff_windows (
  book_id uuid NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  card_id uuid NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  current_version_id uuid NOT NULL,
  revision integer NOT NULL CHECK (revision > 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (book_id,card_id),
  FOREIGN KEY (current_version_id,book_id,card_id)
    REFERENCES payoff_window_versions(id,book_id,card_id)
);

CREATE FUNCTION guard_payoff_window_version() RETURNS trigger
LANGUAGE plpgsql SET search_path TO pg_catalog,new_design,public,pg_temp AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'payoff window versions are immutable' USING ERRCODE='23514';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM books book
    JOIN cards card ON card.space_id=book.space_id AND card.id=NEW.card_id AND card.status='active'
    JOIN card_types type ON type.id=card.card_type_id AND type.type_key='foreshadow'
    WHERE book.id=NEW.book_id AND book.status='active'
  ) THEN
    RAISE EXCEPTION 'payoff window must target an active foreshadow in its book' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER payoff_window_version_guard BEFORE INSERT OR UPDATE OR DELETE
ON payoff_window_versions FOR EACH ROW EXECUTE FUNCTION guard_payoff_window_version();

-- Publish a metadata-only lifecycle upgrade for untouched built-in foreshadow
-- status fields. All prior type/field versions and card values remain intact.
-- Custom status schemas or unpublished type drafts are intentionally skipped.
DO $$
DECLARE
  system_type_id uuid;
  old_system_version_id uuid;
  new_system_version_id uuid;
  target record;
  status_field jsonb;
  next_fields jsonb;
  next_version_id uuid;
  next_number integer;
  template record;
  next_payload jsonb;
BEGIN
  SELECT id INTO system_type_id FROM card_types
  WHERE space_id='00000000-0000-4000-8000-000000000001' AND type_key='foreshadow' AND is_system AND status='published';
  IF system_type_id IS NULL THEN RETURN; END IF;

  FOR target IN
    SELECT type.*,version.fields FROM card_types type
    JOIN card_type_versions version ON version.id=type.current_version_id AND version.card_type_id=type.id
    WHERE type.type_key='foreshadow' AND type.status='published'
      AND (type.id=system_type_id OR type.source_card_type_id=system_type_id)
    ORDER BY CASE WHEN type.id=system_type_id THEN 0 ELSE 1 END,type.id
    FOR UPDATE OF type
  LOOP
    IF target.draft_fields IS DISTINCT FROM target.fields THEN CONTINUE; END IF;
    SELECT field INTO status_field FROM jsonb_array_elements(target.fields) field WHERE field->>'key'='status';
    IF status_field IS NULL
      OR COALESCE(status_field->>'stateSettlement','none')<>'none'
      OR status_field - 'stateSettlement' <> $status${"key":"status","name":"伏笔状态","description":"作者侧的布置和回收进度","type":"select","required":false,"defaultValue":"planned","options":[{"value":"planned","label":"待埋设"},{"value":"planted","label":"已埋设"},{"value":"reinforced","label":"已强化"},{"value":"paid_off","label":"已回收"},{"value":"abandoned","label":"已废弃"}],"group":"生命周期","order":5}$status$::jsonb
    THEN CONTINUE; END IF;

    SELECT jsonb_agg(CASE WHEN field->>'key'='status'
      THEN jsonb_set(field,'{stateSettlement}','"lifecycle"'::jsonb,true) ELSE field END ORDER BY ordinal)
    INTO next_fields FROM jsonb_array_elements(target.fields) WITH ORDINALITY fields(field,ordinal);
    SELECT COALESCE(MAX(version),0)+1 INTO next_number FROM card_type_versions WHERE card_type_id=target.id;
    next_version_id:=gen_random_uuid();
    INSERT INTO card_type_versions(id,card_type_id,version,fields)
    VALUES(next_version_id,target.id,next_number,next_fields);
    UPDATE card_types SET current_version_id=next_version_id,draft_fields=next_fields,
      revision=revision+1,updated_at=now() WHERE id=target.id;
    IF target.id=system_type_id THEN
      old_system_version_id:=target.current_version_id;
      new_system_version_id:=next_version_id;
    END IF;
  END LOOP;

  IF new_system_version_id IS NULL THEN RETURN; END IF;
  SELECT group_row.id,group_row.current_version_id,version.payload
    INTO template FROM template_groups group_row
    JOIN template_group_versions version ON version.id=group_row.current_version_id
    WHERE group_row.template_key='long_novel_core' AND group_row.status='published'
    FOR UPDATE OF group_row;
  IF template.id IS NULL OR NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(COALESCE(template.payload->'cardTypes','[]'::jsonb)) item
    WHERE item->>'sourceId'=system_type_id::text
      AND item->>'sourceVersionId'=old_system_version_id::text
  ) THEN RETURN; END IF;
  SELECT jsonb_set(template.payload,'{cardTypes}',jsonb_agg(
    CASE WHEN item->>'sourceId'=system_type_id::text
      THEN jsonb_set(jsonb_set(item,'{sourceVersionId}',to_jsonb(new_system_version_id::text)),
        '{fields}',(SELECT fields FROM card_type_versions WHERE id=new_system_version_id))
      ELSE item END ORDER BY ordinal)) INTO next_payload
    FROM jsonb_array_elements(template.payload->'cardTypes') WITH ORDINALITY entries(item,ordinal);
  SELECT COALESCE(MAX(version),0)+1 INTO next_number FROM template_group_versions WHERE template_id=template.id;
  next_version_id:=gen_random_uuid();
  INSERT INTO template_group_versions(id,template_id,version,payload)
    VALUES(next_version_id,template.id,next_number,next_payload);
  UPDATE template_groups SET current_version_id=next_version_id,revision=revision+1,updated_at=now()
    WHERE id=template.id;
END $$;
