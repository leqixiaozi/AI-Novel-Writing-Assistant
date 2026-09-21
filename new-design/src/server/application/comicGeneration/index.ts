import {comicSourceExtractionSchema} from '../../../common/comicSourceBundle';
import {comicEpisodeOutlineSchema} from '../../../common/comicEpisodes';
import {comicPanelScriptSchema,type ComicGenerationReceipt} from '../../../common/comicPanels';
import type {NewDesignAiGateway} from '../../ai/gateway';
import {NewDesignError} from '../../domain/errors';
import * as sources from '../../database/comicSourceBundle';
import * as episodes from '../../database/comicEpisodes';
import * as panels from '../../database/comicPanels';

function requireAi(ai?:NewDesignAiGateway){if(!ai?.generateComicCandidate)throw new NewDesignError('漫画文本生成模型能力尚未接入，请检查新版模型设置。',503);return ai.generateComicCandidate.bind(ai);}
function receipt(requestKey:string,operation:ComicGenerationReceipt['operation'],sourceVersionIds:string[],candidateVersionId:string,repeated:boolean):ComicGenerationReceipt{return{requestKey,operation,sourceVersionIds,candidateVersionId,status:'succeeded',repeated,readiness:'current',adopted:false};}

export async function startComicSourceExtraction(projectId:string,raw:unknown,ai?:NewDesignAiGateway):Promise<ComicGenerationReceipt>{
 const input=comicSourceExtractionSchema.parse(raw),prior=await sources.readComicSourceBundleOriginal(projectId,input.requestKey);if(prior){const existing=await sources.readComicSourceGenerationOriginal(projectId,input.requestKey);if(existing)return existing;throw new NewDesignError('原请求键已用于人工来源候选，未调用模型。',409);}
 const prompt=await sources.getComicSourceExtractionPrompt(projectId,input.instruction),output=await requireAi(ai)(prompt);
 if(output.output.operation!=='source_extract')throw new NewDesignError('漫画来源整理结果类型不匹配，未保存候选。',422);
 const saved=await sources.proposeComicSourceBundle(projectId,{requestKey:input.requestKey,expectedRevision:input.expectedRevision,content:output.output.content},{sourceKind:'ai_candidate',expectedSourceVersionId:prompt.sourceVersionId});
 return receipt(input.requestKey,'source_extract',[prompt.sourceVersionId],saved.version.id,saved.repeated);
}

export async function startComicEpisodeOutline(projectId:string,raw:unknown,ai?:NewDesignAiGateway):Promise<ComicGenerationReceipt>{
 const input=comicEpisodeOutlineSchema.parse(raw),prior=await episodes.readComicEpisodeOriginal(projectId,input.requestKey);if(prior){const existing=await episodes.readComicEpisodeGenerationOriginal(projectId,input.requestKey);if(existing)return existing;throw new NewDesignError('原请求键已用于人工分话候选，未调用模型。',409);}
 const prompt=await episodes.getComicEpisodeOutlinePrompt(projectId,input.order,input.instruction),output=await requireAi(ai)(prompt);
 if(output.output.operation!=='episode_outline')throw new NewDesignError('漫画分话大纲结果类型不匹配，未保存候选。',422);
 const saved=await episodes.proposeComicEpisode(projectId,{requestKey:input.requestKey,order:input.order,expectedRevision:input.expectedRevision,content:output.output.content},{sourceKind:'ai_candidate',expectedSourceVersionId:prompt.sourceVersionId,expectedSourceBundleVersionId:prompt.sourceBundleVersionId});
 return receipt(input.requestKey,'episode_outline',[prompt.sourceVersionId],saved.version.id,saved.repeated);
}

export async function startComicPanelScript(projectId:string,episodeId:string,raw:unknown,ai?:NewDesignAiGateway):Promise<ComicGenerationReceipt>{
 const input=comicPanelScriptSchema.parse(raw),prior=await panels.readComicPanelProposalOriginal(projectId,input.requestKey);if(prior){const existing=await panels.readComicPanelGenerationOriginal(projectId,input.requestKey);if(existing)return existing;throw new NewDesignError('原请求键已用于人工分镜候选，未调用模型。',409);}
 const prompt=await panels.getComicPanelScriptPrompt(projectId,episodeId,input.episodeVersionId,input.densityMode,input.instruction),output=await requireAi(ai)(prompt);
 if(output.output.operation!=='panel_script')throw new NewDesignError('漫画整话分镜结果类型不匹配，未保存候选。',422);
 const saved=await panels.proposeComicPanelSet(projectId,episodeId,{requestKey:input.requestKey,expectedScriptRevision:input.expectedScriptRevision,episodeVersionId:input.episodeVersionId,densityMode:input.densityMode,panels:output.output.panels},'ai_candidate');
 return receipt(input.requestKey,'panel_script',[prompt.episodeVersionId],saved.set.id,saved.repeated);
}

export async function readComicGenerationOriginal(projectId:string,requestKey:string):Promise<ComicGenerationReceipt|null>{
 return await sources.readComicSourceGenerationOriginal(projectId,requestKey)??await episodes.readComicEpisodeGenerationOriginal(projectId,requestKey)??await panels.readComicPanelGenerationOriginal(projectId,requestKey);
}
