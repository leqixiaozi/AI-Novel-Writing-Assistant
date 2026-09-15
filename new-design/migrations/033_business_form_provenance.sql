SET search_path TO new_design, public;

ALTER TABLE card_versions
  ADD COLUMN IF NOT EXISTS form_version_id uuid REFERENCES card_group_form_versions(id),
  ADD COLUMN IF NOT EXISTS form_resolution_kind text NOT NULL DEFAULT 'legacy';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'card_versions_form_resolution_kind_check'
      AND conrelid = 'new_design.card_versions'::regclass
  ) THEN
    ALTER TABLE card_versions
      ADD CONSTRAINT card_versions_form_resolution_kind_check
      CHECK (form_resolution_kind IN ('installed_form', 'type_schema', 'system_default', 'generic', 'legacy'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS card_versions_form_version_idx
  ON card_versions (form_version_id)
  WHERE form_version_id IS NOT NULL;

COMMENT ON COLUMN card_versions.form_version_id IS '实际用于本次填写的已发布创作表单版本；未使用组合表单时为空。';
COMMENT ON COLUMN card_versions.form_resolution_kind IS '填写外壳解析来源，只记录来源类型，不复制渲染后的表单配置。';
