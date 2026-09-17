SET search_path TO new_design, public;
-- Only a precise selection anchor; text remains in its original parsed asset version.
ALTER TABLE context_manifest_entries ADD COLUMN knowledge_segment jsonb;
ALTER TABLE context_manifest_entries ADD CONSTRAINT context_manifest_entries_knowledge_segment_check CHECK (
 knowledge_segment IS NULL OR (
  source_type='asset_version' AND content_role='reference' AND
  jsonb_typeof(knowledge_segment)='object' AND
  knowledge_segment ?& ARRAY['chunkId','start','end','checksum'] AND
  knowledge_segment-ARRAY['chunkId','start','end','checksum']='{}'::jsonb AND
  jsonb_typeof(knowledge_segment->'chunkId')='string' AND
  jsonb_typeof(knowledge_segment->'checksum')='string' AND
  (knowledge_segment->>'chunkId') ~ '^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$' AND
  (knowledge_segment->>'checksum') ~ '^[a-f0-9]{64}$' AND
  jsonb_typeof(knowledge_segment->'start')='number' AND jsonb_typeof(knowledge_segment->'end')='number' AND
  (knowledge_segment->>'start') ~ '^(0|[1-9][0-9]*)$' AND (knowledge_segment->>'end') ~ '^[1-9][0-9]*$' AND
  (knowledge_segment->>'start')::numeric>=0 AND (knowledge_segment->>'end')::numeric<=2097152 AND
  (knowledge_segment->>'end')::numeric>(knowledge_segment->>'start')::numeric AND
  (knowledge_segment->>'end')::numeric-(knowledge_segment->>'start')::numeric<=50000
 ) IS TRUE
);
