import {verifyFrozenResourceBackfillScope} from '../characterResources';
import { randomUUID } from "node:crypto";
import type { ManagedModelSnapshot, ManagedTaskRoute, ModelTaskKey } from "../../../common/modelRouting";
import { NewDesignError } from "../../domain/errors";
import { stableHash } from "../aiContracts";
import { assertSupportedSettings, connectionFromRow, settingsFromRows, settingsSchema, taskSchema, unsupportedIssue, type DbRow } from "./policy";
import { readFallbacks, withClient, type ManagedDatabaseContext } from "./repository";

export async function resolveManagedTaskRoute(taskType: ModelTaskKey, context?: ManagedDatabaseContext): Promise<ManagedTaskRoute> {
  taskSchema.parse(taskType);
  return withClient(context, async client => {
    const layers = (await client.query("SELECT version.*,config.scope,config.id AS source_config_id FROM new_design.model_route_configs config JOIN new_design.model_route_versions version ON version.id=config.published_version_id AND version.config_id=config.id WHERE config.status='active' AND version.status='published' AND (config.scope='system_default' OR (config.scope='task' AND config.task_key=$1 AND config.task_group IS NULL)) ORDER BY CASE WHEN config.scope='system_default' THEN 0 ELSE 1 END", [taskType])).rows;
    if (!layers.length || layers[0].scope !== "system_default") throw new NewDesignError("尚未启用默认创作模型。请打开模型设置，配置并保存默认模型后在来源页重试。", 422);
    let primary = connectionFromRow(layers[0]), policy = settingsFromRows(layers[0], []).policy;
    let fallbacks: ManagedTaskRoute["fallbacks"] = [];
    const sourceLayers: ManagedTaskRoute["sourceLayers"] = [];
    for (const layer of layers) {
      const rows = await readFallbacks(client, layer.id);
      if (unsupportedIssue(layer, rows)) throw new NewDesignError("生效模型版本包含不支持的供应商或高级参数。请打开模型设置核对并明确确认替换后重试。", 422);
      if (layer.provider) primary.provider = layer.provider;
      if (layer.model) primary.model = layer.model;
      if (layer.parameters?.baseUrl !== undefined) primary.endpoint = String(layer.parameters.baseUrl);
      if (layer.provider !== null || layer.credential_ref_id !== null) primary.credentialId = layer.credential_ref_id ?? null;
      const budget = layer.budget_policy ?? {}, retry = layer.retry_policy ?? {};
      policy = { maxOutputTokens: Number(budget.maxOutputTokens ?? policy.maxOutputTokens), maxTotalTokens: Number(budget.maxTokens ?? policy.maxTotalTokens), timeoutMs: Number(layer.timeout_ms ?? policy.timeoutMs), maxRetries: Number(retry.maxRetries ?? policy.maxRetries), retryDelayMs: Number(retry.retryDelayMs ?? policy.retryDelayMs) };
      const nextFallbacks = settingsFromRows(layer, rows).fallbacks;
      fallbacks = layer.fallback_mode === "replace" ? nextFallbacks : [...fallbacks, ...nextFallbacks];
      sourceLayers.push({ scope: layer.scope, configId: layer.source_config_id, versionId: layer.id });
    }
    const route: ManagedTaskRoute = { primary, policy, fallbacks, sourceLayers };
    assertSupportedSettings(route);
    return route;
  });
}

export async function captureManagedModelSnapshot(taskType: ModelTaskKey, route: ManagedTaskRoute, context?: ManagedDatabaseContext, scope?: {bookId:string;taskContractVersionId:string}): Promise<ManagedModelSnapshot> {
  taskSchema.parse(taskType);
  const settings = settingsSchema.parse({ primary: route.primary, policy: route.policy, fallbacks: route.fallbacks });
  if (!route.sourceLayers.length || route.sourceLayers[0].scope !== "system_default" || route.sourceLayers.length > 2 || route.sourceLayers.some((layer, index) => index > 0 && layer.scope !== "task")) throw new NewDesignError("模型快照缺少真实默认版本或任务版本来源。", 422);
  return withClient(context, async client => {
    if(scope){
      const book=(await client.query("SELECT id FROM new_design.books WHERE id=$1 AND status='active'",[scope.bookId])).rows[0];
      const contract=(await client.query("SELECT version.id,config.task_key,recipe.recipe_id,version.task_group,version.budget_policy,version.input_schema,recipe.variables_schema FROM new_design.task_contract_versions version JOIN new_design.task_contracts config ON config.id=version.contract_id JOIN new_design.prompt_recipe_versions recipe ON recipe.id=version.prompt_recipe_version_id WHERE version.id=$1 AND version.status IN ('published','superseded')",[scope.taskContractVersionId])).rows[0];
      const settlement=taskType==="chapter_settlement"&&contract?.task_group==="chapter_settlement"&&["new_design.chapter.settlement_candidates","new_design.character.resource_backfill","new_design.character.stable_resource_supplement","new_design.character.stable_resource_correction"].includes(contract.budget_policy?.assetId)&&contract.budget_policy?.assetVersion==="v1"&&contract.variables_schema?.["x-chapter-settlement"]?.sessionId&&contract.task_key===`chapter_settlement_${contract.variables_schema["x-chapter-settlement"].sessionId}`;
      const chapter=taskType==="chapter_generation"&&contract?.task_group==="controlled_chapter_generation"&&contract.budget_policy?.assetId==="new_design.chapter.generate_candidate"&&contract.budget_policy?.assetVersion==="v1"&&contract.variables_schema?.["x-controlled-chapter"]?.requestId&&contract.task_key===`controlled_chapter_${contract.variables_schema["x-controlled-chapter"].requestId}`;
      const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
      const worldMarker=contract?.variables_schema?.["x-world-consistency"],creativeMarker=contract?.variables_schema?.["x-creative-extraction"],input=contract?.input_schema?.const;
      const matchingInput=input!==undefined&&contract?.variables_schema?.const!==undefined&&stableHash(input)===stableHash(contract.variables_schema.const);
      const qualityMarker=contract?.variables_schema?.['x-controlled-chapter'];
      const quality=taskType==='quality_audit'&&contract?.task_group==='controlled_chapter_quality'&&contract.budget_policy?.assetId==='new_design.chapter.quality_audit'&&contract.budget_policy?.assetVersion==='v1'&&typeof qualityMarker?.requestId==='string'&&uuid.test(qualityMarker.requestId)&&contract.task_key===`controlled_quality_${qualityMarker.requestId}`&&input?.bookId===scope.bookId&&matchingInput&&typeof input?.chapterDocumentId==='string'&&uuid.test(input.chapterDocumentId)&&input?.body?.versionId;
      const world=taskType==="world_consistency"&&contract?.task_group==="world_consistency"&&contract.budget_policy?.assetId==="new_design.world.consistency"&&contract.budget_policy?.assetVersion==="v1"&&typeof worldMarker?.requestId==="string"&&uuid.test(worldMarker.requestId)&&contract.task_key===`world_consistency_${worldMarker.requestId}`&&worldMarker.bookId===scope.bookId&&input?.contract==="world_consistency_v1"&&input?.catalog?.bookId===scope.bookId&&input.catalog.hash===worldMarker.catalogHash&&matchingInput;
      const creative=taskType==="creative_extraction"&&contract?.task_group==="creative_extraction"&&contract.budget_policy?.assetId==="new_design.creative.extraction"&&contract.budget_policy?.assetVersion==="v1"&&typeof creativeMarker?.previewId==="string"&&uuid.test(creativeMarker.previewId)&&contract.task_key===`creative_extraction_${creativeMarker.previewId}`&&input?.book?.id===scope.bookId&&matchingInput;
      const dialogueMarker=contract?.variables_schema?.["x-character-dialogue"];
      const authorMarker=contract?.variables_schema?.['x-character-author'];
      const characterAuthor=taskType==='character_dialogue'&&contract?.task_group==='character_dialogue'&&contract.budget_policy?.assetId==='new_design.character.author_conversation'&&contract.budget_policy?.assetVersion==='v1'&&typeof authorMarker?.requestId==='string'&&uuid.test(authorMarker.requestId)&&contract.task_key===`character_author_${authorMarker.requestId}`&&input?.contract==='character_author_v1'&&input.input?.bookId===scope.bookId&&input.source?.bookId===scope.bookId&&input.source?.cardId===input.input?.cardId&&input.source?.hash===authorMarker.sourceHash&&input.input?.sourceHash===authorMarker.sourceHash&&matchingInput;
      const dialogue=taskType==="character_dialogue"&&contract?.task_group==="character_dialogue"&&contract.budget_policy?.assetId==="new_design.character.dialogue"&&contract.budget_policy?.assetVersion==="v1"&&[dialogueMarker?.roundId,dialogueMarker?.sessionId,dialogueMarker?.checkpointId].every(id=>typeof id==="string"&&uuid.test(id))&&dialogueMarker.bookId===scope.bookId&&contract.task_key===`character_dialogue_${dialogueMarker.roundId}`&&input?.contract==="character_dialogue_v1"&&input.sessionId===dialogueMarker.sessionId&&input.roundId===dialogueMarker.roundId&&input.checkpoint?.id===dialogueMarker.checkpointId&&input.checkpoint.bookId===scope.bookId&&matchingInput;
      const imageMarker=contract?.variables_schema?.['x-image-preparation'];
      const imagePreparation=taskType==='form_assist'&&contract?.task_group==='form_assist'&&contract.budget_policy?.assetId==='new_design.image.prompt_preparation'&&contract.budget_policy?.assetVersion==='v1'&&imageMarker?.contract==='image_prompt_preparation_v1'&&typeof imageMarker.requestId==='string'&&uuid.test(imageMarker.requestId)&&contract.task_key===`image_prompt_${imageMarker.requestId}`&&input?.contract==='image_prompt_preparation_v1'&&input.source?.scope?.kind==='book'&&input.source.scope.bookId===scope.bookId&&matchingInput;
      const composition=taskType!=="quality_audit"&&taskType!=="chapter_settlement"&&taskType!=="chapter_generation"&&taskType!=="world_consistency"&&taskType!=="creative_extraction"&&taskType!=="character_dialogue"&&contract?.task_key===`prompt_composition_${contract.recipe_id}_${taskType}`;
      if(!book||!contract||!(settlement||chapter||quality||world||creative||dialogue||characterAuthor||imagePreparation||composition))throw new NewDesignError("模型快照必须引用真实书籍与本任务精确受控合同版本。",422);
      if(dialogue){
        const session=(await client.query("SELECT frozen_sources,input_payload FROM new_design.character_dialogue_sessions WHERE id=$1 AND book_id=$2",[dialogueMarker.sessionId,scope.bookId])).rows[0];
        const sources=session?.frozen_sources;
        const actor=sources?.actors?.find((value:Record<string,unknown>)=>value.cardId===input.actor?.cardId);
        if(!sources||sources.hash!==dialogueMarker.sourceHash||stableHash(sources.checkpoint)!==stableHash(input.checkpoint)||!actor||stableHash(actor)!==stableHash(input.actor)||!Array.isArray(input.knowledge)||input.knowledge.some((value:Record<string,unknown>)=>value.holderCardId!==input.actor.cardId))throw new NewDesignError("人物模拟快照必须使用本书原会话、精确截至章及本人私有历史来源。",422);
        const privateKnowledge=sources.knowledge.filter((value:Record<string,unknown>)=>value.holderCardId===actor.cardId);
        const privateRelations=sources.relations.filter((value:Record<string,unknown>)=>value.sourceCardId===actor.cardId||value.targetCardId===actor.cardId);
        const privateStates=sources.states.filter((value:Record<string,unknown>)=>value.subjectKind==="card"?value.subjectId===actor.cardId:privateRelations.some((relation:Record<string,unknown>)=>relation.id===value.subjectId));
        const publicParticipants=sources.actors.filter((value:Record<string,unknown>)=>value.cardId!==actor.cardId).map((value:Record<string,unknown>)=>({cardId:value.cardId,label:value.label}));
        if(stableHash(privateKnowledge)!==stableHash(input.knowledge)||stableHash(privateRelations)!==stableHash(input.relations)||stableHash(privateStates)!==stableHash(input.states)||stableHash(publicParticipants)!==stableHash(input.otherParticipants))throw new NewDesignError("人物模拟不能替换或扩大原会话中的私有历史来源。",422);
        const rounds=(await client.query("SELECT id,input_payload,generated_output FROM new_design.character_dialogue_rounds WHERE session_id=$1 AND book_id=$2 AND status='succeeded' AND generated_output IS NOT NULL ORDER BY round_number",[dialogueMarker.sessionId,scope.bookId])).rows;
        const publicRounds=rounds.map(row=>({id:row.id,actorCardId:row.input_payload.actorCardId,actorLabel:sources.actors.find((value:Record<string,unknown>)=>value.cardId===row.input_payload.actorCardId)?.label??"原参与对象",utterance:row.generated_output.utterance}));
        if(input.situation!==session.input_payload?.situation||stableHash(publicRounds)!==stableHash(input.publicRounds))throw new NewDesignError("人物模拟只能使用原会话情境和此前成功回合的真实公开发言。",422);
      }
      if(chapter){const input=contract.input_schema?.const;if(input?.bookId!==scope.bookId||stableHash(input)!==stableHash(contract.variables_schema.const)||!(await client.query("SELECT id FROM new_design.planning_objects WHERE book_id=$1 AND card_id=$2 AND level='chapter' AND status='active' AND adopted_version_id=ANY($3::uuid[])",[scope.bookId,input.chapterCardId,input.plans.filter((plan:Record<string,unknown>)=>plan.level==="chapter").map((plan:Record<string,unknown>)=>plan.versionId)])).rowCount)throw new NewDesignError("正文生成快照缺少本书已采用章计划与精确输入合同。",422);}
      if(settlement){
        const corrective=contract.budget_policy.assetId==='new_design.character.stable_resource_correction';
        const stable=corrective||contract.budget_policy.assetId==="new_design.character.stable_resource_supplement";
        const resource=stable||contract.budget_policy.assetId==="new_design.character.resource_backfill";
        if(resource!==Boolean(input?.resourceScope)||contract.variables_schema["x-chapter-settlement"].assetId!==contract.budget_policy.assetId||contract.variables_schema["x-chapter-settlement"].assetVersion!=="v1")throw new NewDesignError("资源回填必须引用自身受控合同和冻结资源范围。",422);
        if(stable){
          const owner=await import('../chapterSettlement');
          const actual=(await client.query('SELECT * FROM new_design.chapter_adoption_sessions WHERE id=$1 AND book_id=$2',[input.sessionId,scope.bookId])).rows[0];
          if(!actual||actual.adoption_kind!=='resource_supplement')throw new NewDesignError('稳定章补充快照必须使用本书真实补充会话。',422);
          await owner.assertResourceSupplementCandidateContract(client,actual,'extract');
          const source=await owner.readFrozenSupplementSource(client,actual,input.bodyContentHash),catalog=await owner.getChapterSettlementEditingCatalogInTransaction(client,actual,true);
          const frame=corrective?input.stableCorrection:input.stableSupplement;
          if((source.contract==='stable_resource_correction_preview_v1')!==corrective||Boolean(input.stableCorrection)!==corrective
            ||Boolean(input.stableSupplement)===corrective||stableHash(source)!==stableHash(frame?.source)||frame?.sessionRevision!==Number(actual.revision)
            ||stableHash(catalog)!==stableHash(input.catalog)||input.bodyContent!==source.basis.bodyContent||stableHash(input.resourceScope)!==stableHash(source.resourceScope)
            ||stableHash(input.expectedChanges)!==stableHash([]))throw new NewDesignError('稳定章补充模型快照不能替换原清单、计划或历史前值。',422);
          const anchors=(await client.query('SELECT * FROM new_design.chapter_text_anchors WHERE book_id=$1 AND body_version_id=$2 AND status=\'active\' AND id=ANY($3::uuid[])',[scope.bookId,input.bodyVersionId,source.resourceScope.anchors.map(anchor=>anchor.id)])).rows;
          if(source.resourceScope.anchors.some(anchor=>!anchors.some(row=>row.id===anchor.id&&row.subject_card_id===anchor.subjectCardId&&Number(row.start_offset)===anchor.start&&Number(row.end_offset)===anchor.end&&row.excerpt===anchor.excerpt)))throw new NewDesignError('稳定章补充原正文锚点已失效，不能领取模型。',422);
        }else if(resource)await verifyFrozenResourceBackfillScope(client,scope.bookId,input.bodyVersionId,input.bodyContent,input.resourceScope);
        const session=(await client.query("SELECT id,body_version_id FROM new_design.chapter_adoption_sessions WHERE id=$1 AND book_id=$2",[contract.variables_schema["x-chapter-settlement"].sessionId,scope.bookId])).rows[0];
        if(!session||contract.input_schema?.const?.sessionId!==session.id||contract.input_schema?.const?.bodyVersionId!==session.body_version_id||stableHash(contract.input_schema.const)!==stableHash(contract.variables_schema.const))throw new NewDesignError("章节提取模型快照缺少本书真实会话、正文与精确输入合同。",422);
      }
    }
    const layers: DbRow[] = [];
    for (const layer of route.sourceLayers) {
      const row = (await client.query("SELECT version.*,config.scope,config.task_key FROM new_design.model_route_versions version JOIN new_design.model_route_configs config ON config.id=version.config_id WHERE version.id=$1 AND config.id=$2 AND (version.status IN ('published','superseded') OR EXISTS(SELECT 1 FROM new_design.ai_contract_publications receipt WHERE receipt.entity_kind='model_route' AND receipt.entity_id=config.id AND receipt.to_version_id=version.id))", [layer.versionId, layer.configId])).rows[0];
      if (!row || row.scope !== layer.scope || row.scope === "task" && row.task_key !== taskType) throw new NewDesignError("模型快照引用的生效版本来源无效。请刷新模型设置后重试。", 422);
      layers.push(row);
    }
    // Reconstruct exact historical settings, not the currently enabled route, to handle legitimate publish races.
    let primary = connectionFromRow(layers[0]!), policy = settingsFromRows(layers[0]!, []).policy;
    let fallbacks: ManagedTaskRoute["fallbacks"] = [];
    for (const layer of layers) {
      const rows = await readFallbacks(client, layer.id);
      if (unsupportedIssue(layer, rows)) throw new NewDesignError("模型快照来源含不支持的高级配置。", 422);
      if (layer.provider) primary.provider = layer.provider;
      if (layer.model) primary.model = layer.model;
      if (layer.parameters?.baseUrl !== undefined) primary.endpoint = String(layer.parameters.baseUrl);
      if (layer.provider !== null || layer.credential_ref_id !== null) primary.credentialId = layer.credential_ref_id ?? null;
      const budget = layer.budget_policy ?? {}, retry = layer.retry_policy ?? {};
      policy = { maxOutputTokens: Number(budget.maxOutputTokens ?? policy.maxOutputTokens), maxTotalTokens: Number(budget.maxTokens ?? policy.maxTotalTokens), timeoutMs: Number(layer.timeout_ms ?? policy.timeoutMs), maxRetries: Number(retry.maxRetries ?? policy.maxRetries), retryDelayMs: Number(retry.retryDelayMs ?? policy.retryDelayMs) };
      const next = settingsFromRows(layer, rows).fallbacks;
      fallbacks = layer.fallback_mode === "replace" ? next : [...fallbacks, ...next];
    }
    if (stableHash({ primary, policy, fallbacks }) !== stableHash(settings)) throw new NewDesignError("模型快照内容与来源版本不一致，请重新准备本次任务。", 422);
    const id = randomUUID(), snapshotHash = stableHash({ taskType, ...settings, sourceLayers: route.sourceLayers,...(scope?{scope}:{}) });
    await client.query("INSERT INTO new_design.model_route_snapshots(id,book_id,task_contract_version_id,managed_task_key,node_key,provider,model,parameters,required_capabilities,credential_ref_id,budget_policy,timeout_ms,retry_policy,source_layers,policy_version,snapshot_hash) VALUES($1,$12,$13,$2,NULL,$3,$4,$5::jsonb,'{}',$6,$7::jsonb,$8,$9::jsonb,$10::jsonb,'managed-model-v1',$11)", [id, scope?null:taskType, primary.provider, primary.model, JSON.stringify({ baseUrl: primary.endpoint }), primary.credentialId, JSON.stringify({ maxTokens: policy.maxTotalTokens, maxOutputTokens: policy.maxOutputTokens }), policy.timeoutMs, JSON.stringify({ maxRetries: policy.maxRetries, retryDelayMs: policy.retryDelayMs }), JSON.stringify(route.sourceLayers), snapshotHash,scope?.bookId??null,scope?.taskContractVersionId??null]);
    for (const [index, fallback] of fallbacks.entries()) await client.query("INSERT INTO new_design.model_route_snapshot_fallbacks(id,snapshot_id,sort_order,provider,model,parameters,credential_ref_id,technical_failure_categories) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8)", [randomUUID(), id, index, fallback.provider, fallback.model, JSON.stringify({ baseUrl: fallback.endpoint }), fallback.credentialId, fallback.failureCategories]);
    return { id, snapshotHash, taskType, route: { ...settings, sourceLayers: route.sourceLayers.map(layer => ({ ...layer })) } };
  }, true);
}
