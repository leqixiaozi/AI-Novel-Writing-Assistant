-- 在作者规格和默认表单／字典就绪后冻结开书模板。
SET LOCAL search_path TO new_design,public;
DO $seed$
DECLARE payload jsonb;
BEGIN
 SELECT jsonb_build_object(
  'cardTypes',coalesce((SELECT jsonb_agg(jsonb_build_object(
    'sourceId',type.id,'sourceVersionId',version.id,'key',type.type_key,'name',type.name,
    'description',type.description,'capabilities',type.semantic_capabilities,'fields',version.fields,'sortOrder',type.sort_order)
    ORDER BY type.sort_order,type.id)
   FROM card_types type JOIN card_type_versions version ON version.id=type.current_version_id
   WHERE type.space_id='00000000-0000-4000-8000-000000000001' AND type.is_system AND NOT type.is_internal AND type.status='published' AND type.type_key<>'prompt_component'),'[]'::jsonb),
  'relationTypes',coalesce((SELECT jsonb_agg(jsonb_build_object(
    'sourceId',relation.id,'key',relation.relation_key,'name',relation.name,'description',relation.description,
    'direction',relation.direction,'sourceTypeKeys',relation.source_type_keys,'targetTypeKeys',relation.target_type_keys,
    'sourceMax',relation.source_max,'targetMax',relation.target_max,'propertiesSchema',relation.properties_schema))
   FROM relation_types relation WHERE relation.scope='system' AND relation.status='published'),'[]'::jsonb),
  'dictionaries',structure_template_dictionaries(),'forms',structure_template_forms(),'seedCards','[]'::jsonb,
  'menu',jsonb_build_object('defaultPage','creative-forms','pages',jsonb_build_array('creative-forms','all-cards'))
 ) INTO payload;
 PERFORM kernel_store_record('template_group','00000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001',
  jsonb_build_object('template_key','long_novel_core','name','通用长篇小说模板','description','以卡片规格开书；默认不复制样例或作者内容。',
    'status','published','revision',1,'current_version_id','40000000-0000-4000-8000-000000000002','draft_config',jsonb_build_object('includeSystemCatalog',true)));
 PERFORM kernel_store_record('template_group_version','00000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000002',
  jsonb_build_object('template_id','40000000-0000-4000-8000-000000000001','version',1,'payload',payload));
END $seed$;
