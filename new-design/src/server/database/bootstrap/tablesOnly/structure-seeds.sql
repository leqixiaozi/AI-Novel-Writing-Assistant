-- 原005公共基础字典／事件规划表单；046节点历史格式。无演示书籍或示例作者卡。
-- 在作者规格／关系seed之后、默认模板payload冻结之前执行。
SET LOCAL search_path TO new_design,public;
DO $structure_defaults$
DECLARE dictionary record; item record; version_id uuid;
 default_space constant uuid := '00000000-0000-4000-8000-000000000001';
 form_definition jsonb := $definition${
  "primaryTypeKey": "event",
  "groups": [
    {
      "key": "event_core",
      "name": "事件主卡",
      "order": 10,
      "sections": [
        {
          "key": "primary",
          "name": "发生什么",
          "order": 10,
          "slots": [
            {
              "key": "primary_event",
              "name": "事件",
              "kind": "primary_card",
              "allowedTypeKeys": [
                "event"
              ],
              "min": 1,
              "max": 1,
              "localFields": []
            }
          ]
        }
      ]
    },
    {
      "key": "event_cast",
      "name": "参与者与立场",
      "order": 20,
      "sections": [
        {
          "key": "participants",
          "name": "参与人物",
          "order": 10,
          "slots": [
            {
              "key": "participants",
              "name": "参与人物",
              "kind": "card_reference",
              "relationTypeKey": "event_participant",
              "allowedTypeKeys": [
                "character"
              ],
              "min": 1,
              "max": 20,
              "localFields": [
                {
                  "description": "",
                  "defaultValue": null,
                  "options": [],
                  "group": "",
                  "order": 0,
                  "key": "goal",
                  "name": "本事件目标",
                  "type": "long_text",
                  "required": false
                },
                {
                  "description": "",
                  "defaultValue": null,
                  "options": [],
                  "group": "",
                  "order": 1,
                  "key": "stance",
                  "name": "本事件立场",
                  "type": "long_text",
                  "required": false
                },
                {
                  "description": "",
                  "defaultValue": null,
                  "options": [],
                  "group": "",
                  "order": 2,
                  "key": "result",
                  "name": "本事件结果",
                  "type": "long_text",
                  "required": false
                }
              ]
            }
          ]
        }
      ]
    },
    {
      "key": "event_context",
      "name": "场景装配",
      "order": 30,
      "sections": [
        {
          "key": "context",
          "name": "地点、道具与剧情线",
          "order": 10,
          "slots": [
            {
              "key": "location",
              "name": "主要地点",
              "kind": "card_reference",
              "relationTypeKey": "event_location",
              "allowedTypeKeys": [
                "location"
              ],
              "min": 1,
              "max": 1,
              "localFields": []
            },
            {
              "key": "props",
              "name": "涉及道具",
              "kind": "card_reference",
              "relationTypeKey": "event_prop",
              "allowedTypeKeys": [
                "prop"
              ],
              "min": 0,
              "max": 20,
              "localFields": [
                {
                  "description": "",
                  "defaultValue": null,
                  "options": [],
                  "group": "",
                  "order": 0,
                  "key": "usage",
                  "name": "事件中的用途",
                  "type": "long_text",
                  "required": false
                }
              ]
            },
            {
              "key": "plotline",
              "name": "所属剧情线",
              "kind": "card_reference",
              "relationTypeKey": "event_plotline",
              "allowedTypeKeys": [
                "plotline"
              ],
              "min": 1,
              "max": 1,
              "localFields": []
            }
          ]
        }
      ]
    }
  ]
}$definition$::jsonb;
BEGIN
 FOR dictionary IN SELECT * FROM (VALUES
  ('31000000-0000-4000-8000-000000000001'::uuid,'story_role','故事职责','人物在当前故事中的结构职责。'),
  ('31000000-0000-4000-8000-000000000002'::uuid,'lifecycle_status','创作生命周期','计划、推进、完成和归档等稳定状态。'),
  ('31000000-0000-4000-8000-000000000003'::uuid,'evidence_reliability','证据可靠性','线索与证据的可信程度。')
 ) AS source(id,dictionary_key,name,description) LOOP
  PERFORM kernel_store_record('dictionary_definition',default_space,dictionary.id,to_jsonb(dictionary)||jsonb_build_object(
   'scope','system','owner_space_id',NULL,'source_dictionary_id',NULL,'status','published','read_only',false));
 END LOOP;
 FOR item IN SELECT * FROM (VALUES
  ('32000000-0000-4000-8000-000000000001'::uuid,'31000000-0000-4000-8000-000000000001'::uuid,'protagonist','主角',10),
  ('32000000-0000-4000-8000-000000000002'::uuid,'31000000-0000-4000-8000-000000000001'::uuid,'antagonist','反派',20),
  ('32000000-0000-4000-8000-000000000003'::uuid,'31000000-0000-4000-8000-000000000001'::uuid,'mentor','导师',30),
  ('32000000-0000-4000-8000-000000000004'::uuid,'31000000-0000-4000-8000-000000000001'::uuid,'supporting','重要配角',40),
  ('32000000-0000-4000-8000-000000000005'::uuid,'31000000-0000-4000-8000-000000000002'::uuid,'planned','计划中',10),
  ('32000000-0000-4000-8000-000000000006'::uuid,'31000000-0000-4000-8000-000000000002'::uuid,'active','进行中',20),
  ('32000000-0000-4000-8000-000000000007'::uuid,'31000000-0000-4000-8000-000000000002'::uuid,'completed','已完成',30),
  ('32000000-0000-4000-8000-000000000008'::uuid,'31000000-0000-4000-8000-000000000002'::uuid,'archived','已归档',40),
  ('32000000-0000-4000-8000-000000000009'::uuid,'31000000-0000-4000-8000-000000000003'::uuid,'verified','可信',10),
  ('32000000-0000-4000-8000-000000000010'::uuid,'31000000-0000-4000-8000-000000000003'::uuid,'questionable','存疑',20),
  ('32000000-0000-4000-8000-000000000011'::uuid,'31000000-0000-4000-8000-000000000003'::uuid,'false','伪造',30)
 ) AS source(id,dictionary_id,item_key,label,sort_order) LOOP
  version_id:=scoped_field_uuid('dictionary-item-version:'||item.id||':1');
  PERFORM kernel_store_record('dictionary_item_version',default_space,version_id,jsonb_build_object(
   'item_id',item.id,'version',1,'label',item.label,'description','','parent_id',NULL,'sort_order',item.sort_order,
   'value',jsonb_build_object('value',item.item_key),'status','active','path_node_ids',jsonb_build_array(item.id),
   'path_labels',jsonb_build_array(item.label),'created_by','system'));
  PERFORM kernel_store_record('dictionary_item',default_space,item.id,to_jsonb(item)||jsonb_build_object(
   'description','','parent_id',NULL,'source_item_id',NULL,'current_version_id',version_id,'status','active',
   'value',jsonb_build_object('value',item.item_key)));
 END LOOP;
 PERFORM kernel_store_record('card_group_form',default_space,'34000000-0000-4000-8000-000000000001',jsonb_build_object(
  'space_id',NULL,'form_key','event_planning','name','事件规划表单',
  'description','把事件主卡与人物、地点、道具和剧情线装配为可恢复的生产单。','status','published','revision',1,
  'current_version_id','35000000-0000-4000-8000-000000000001','draft_definition',form_definition,'is_system',true,
  'source_form_id',NULL,'source_form_version_id',NULL));
 PERFORM kernel_store_record('card_group_form_version',default_space,'35000000-0000-4000-8000-000000000001',jsonb_build_object(
  'form_id','34000000-0000-4000-8000-000000000001','version',1,'definition',form_definition));
END;
$structure_defaults$;

-- 同步已发布作者规格，并补齐后创建的默认表单来源；原版本重放不追加历史。
DO $field_defaults$
DECLARE published_version record;
BEGIN
 FOR published_version IN SELECT type.current_version_id FROM card_types type
  WHERE NOT type.is_internal AND type.status='published' AND type.current_version_id IS NOT NULL
 LOOP
  PERFORM sync_type_version_fields(published_version.current_version_id);
 END LOOP;
END;
$field_defaults$;
