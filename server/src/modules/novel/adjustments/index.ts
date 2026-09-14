import { AdjustmentStore } from "./infrastructure/AdjustmentStore";
import { WritingSettingsService } from "./application/WritingSettingsService";
import { WritingContentService } from "./application/WritingContentService";
import { WritingGovernanceService } from "./application/WritingGovernanceService";
import { WritingPlanningService } from "./application/WritingPlanningService";
import { WritingLineService } from "./application/WritingLineService";
import { BookArrangementService } from "./application/BookArrangementService";
import { BookArrangementVolumeService } from "./application/BookArrangementVolumeService";
import { BookArrangementObjectService } from "./application/BookArrangementObjectService";
import { ChapterSceneArrangementService } from "./application/ChapterSceneArrangementService";
import { SceneExpressionTrackService } from "./application/SceneExpressionTrackService";

const store = new AdjustmentStore();
const settings = new WritingSettingsService(store);
const content = new WritingContentService(store, settings);
const governance = new WritingGovernanceService(store);
const planning = new WritingPlanningService(store, settings);
const lines = new WritingLineService(store);
const arrangement = new BookArrangementService(store, settings);
const arrangementVolumes = new BookArrangementVolumeService(store);
const arrangementObjects = new BookArrangementObjectService(store);
const arrangementScenes = new ChapterSceneArrangementService(store);
const sceneExpressions = new SceneExpressionTrackService(store);

/** Optional facade: legacy callers never resolve requirements unless their request opts in. */
export const adjustmentService = {
  store,
  settings: settings.get.bind(settings),
  saveSettings: settings.save.bind(settings),
  preset: settings.preset.bind(settings),
  resolve: settings.resolve.bind(settings),
  generate: content.generate.bind(content),
  saveDraft: content.saveDraft.bind(content),
  evidence: content.evidence.bind(content),
  review: content.review.bind(content),
  handleIssue: content.handleIssue.bind(content),
  beginManual: governance.beginManual.bind(governance),
  completeManual: governance.completeManual.bind(governance),
  accept: governance.accept.bind(governance),
  receipt: governance.receipt.bind(governance),
  retry: governance.retry.bind(governance),
  synchronize: governance.synchronize.bind(governance),
  workspace: planning.workspace.bind(planning),
  previewPlan: planning.previewPlan.bind(planning),
  acceptPlan: planning.acceptPlan.bind(planning),
  createDecision: planning.createDecision.bind(planning),
  updateDecision: planning.updateDecision.bind(planning),
  lines: lines.lines.bind(lines),
  previewLine: lines.preview.bind(lines),
  acceptLine: lines.accept.bind(lines),
  arrangementWorkspace: arrangement.workspace.bind(arrangement),
  saveArrangementDraft: arrangement.saveDraft.bind(arrangement),
  previewArrangement: arrangement.preview.bind(arrangement),
  applyArrangement: arrangement.apply.bind(arrangement),
  previewArrangementVolumes: arrangementVolumes.preview.bind(arrangementVolumes),
  applyArrangementVolumes: arrangementVolumes.apply.bind(arrangementVolumes),
  arrangementObject: arrangementObjects.detail.bind(arrangementObjects),
  previewArrangementObject: arrangementObjects.preview.bind(arrangementObjects),
  applyArrangementObject: arrangementObjects.apply.bind(arrangementObjects),
  previewArrangementScenes: arrangementScenes.preview.bind(arrangementScenes),
  applyArrangementScenes: arrangementScenes.apply.bind(arrangementScenes),
  sceneExpressionPoints: sceneExpressions.list.bind(sceneExpressions),
  saveSceneExpressionPoints: sceneExpressions.save.bind(sceneExpressions),
};

export async function getRequirementsForRuntime(novelId: string, chapterId: string, requirementsId: string) {
  return { promptText: await settings.prompt(await settings.load(novelId, chapterId, requirementsId), chapterId) };
}
export * from "./infrastructure/fence";
