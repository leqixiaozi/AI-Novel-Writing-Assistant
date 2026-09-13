import { AdjustmentStore } from "./infrastructure/AdjustmentStore";
import { WritingSettingsService } from "./application/WritingSettingsService";
import { WritingContentService } from "./application/WritingContentService";
import { WritingGovernanceService } from "./application/WritingGovernanceService";
import { WritingPlanningService } from "./application/WritingPlanningService";
import { WritingLineService } from "./application/WritingLineService";

const store = new AdjustmentStore();
const settings = new WritingSettingsService(store);
const content = new WritingContentService(store, settings);
const governance = new WritingGovernanceService(store);
const planning = new WritingPlanningService(store, settings);
const lines = new WritingLineService(store);

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
};

export async function getRequirementsForRuntime(novelId: string, chapterId: string, requirementsId: string) {
  return { promptText: await settings.prompt(await settings.load(novelId, chapterId, requirementsId), chapterId) };
}
export * from "./infrastructure/fence";
