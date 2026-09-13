import type { Prisma } from "@prisma/client";
import type { VolumePlan, VolumePlanDocument } from "@ai-novel/shared/types/novel";
import { mapVolumeRow } from "./volumeModels";
import { buildDerivedOutlineFromVolumes, buildDerivedStructuredOutlineFromVolumes } from "./volumePlanUtils";
import { buildVolumeWorkspaceDocument, buildVolumePlanningReadiness } from "./volumeWorkspaceDocument";
import { persistActiveVolumeWorkspace } from "./volumeWorkspacePersistence";

/** Read without ensure/hydration: opening an arrangement must not activate a legacy draft. */
export async function readArrangementVolumeState(db: Prisma.TransactionClient, novelId: string) {
  const [rows, versions] = await Promise.all([
    db.volumePlan.findMany({ where: { novelId }, include: { chapters: { orderBy: [{ chapterOrder: "asc" }, { id: "asc" }] } }, orderBy: [{ sortOrder: "asc" }, { id: "asc" }] }),
    db.volumePlanVersion.findMany({ where: { novelId }, orderBy: { version: "desc" } }),
  ]);
  const active = versions.find(version => version.status === "active");
  let saved: Partial<VolumePlanDocument> = {};
  if (active) {
    try { saved = JSON.parse(active.contentJson); } catch { /* canonical rows remain the source */ }
  }
  const savedVolumes = Array.isArray(saved?.volumes) ? saved.volumes : [];
  const volumes = rows.map(row => {
    const mapped = mapVolumeRow(row), previous = savedVolumes.find(volume => volume.id === row.id);
    // Only fields absent from the SQL projection come from the saved full document.
    for (const key of ["openingHook", "primaryPressureSource", "coreSellingPoint", "midVolumeRisk", "payoffType"] as const) mapped[key] = previous?.[key] ?? null;
    mapped.chapters = mapped.chapters.map(chapter => {
      const old = savedVolumes.flatMap(volume => volume.chapters ?? []).find(item => item.id === chapter.id);
      return { ...chapter, beatKey: old?.beatKey ?? null, exclusiveEvent: old?.exclusiveEvent ?? null, endingState: old?.endingState ?? null, nextChapterEntryState: old?.nextChapterEntryState ?? null, styleContract: old?.styleContract ?? null };
    });
    return mapped;
  });
  const empty = buildVolumeWorkspaceDocument({ novelId, volumes: [] });
  const document: VolumePlanDocument = { ...empty, ...saved, novelId, workspaceVersion: "v2", volumes, source: "volume", activeVersionId: active?.id ?? null, derivedOutline: buildDerivedOutlineFromVolumes(volumes), derivedStructuredOutline: buildDerivedStructuredOutlineFromVolumes(volumes) };
  return { rows, versions, document };
}

/** Preserve IDs and canonical order. Only derived compatibility views are rebuilt. */
export function deriveArrangementVolumeDocument(current: VolumePlanDocument, volumes: VolumePlan[], changedIds: string[]): VolumePlanDocument {
  const changed = new Set(changedIds);
  const beatSheets = current.beatSheets.filter(sheet => !changed.has(sheet.volumeId));
  const readiness = buildVolumePlanningReadiness({ volumes, strategyPlan: current.strategyPlan, beatSheets, critiqueReport: current.critiqueReport });
  const rebalanceDecisions = current.rebalanceDecisions.filter(decision => !changed.has(decision.anchorVolumeId) && !changed.has(decision.affectedVolumeId));
  return { ...current, volumes, beatSheets, rebalanceDecisions, readiness, derivedOutline: buildDerivedOutlineFromVolumes(volumes), derivedStructuredOutline: buildDerivedStructuredOutlineFromVolumes(volumes) };
}

/** Caller owns the serializable transaction, fence, operation claim and receipt. */
export async function activateArrangementVolumeDocument(tx: Prisma.TransactionClient, novelId: string, before: VolumePlanDocument, after: VolumePlanDocument, affectedVolumeIds: string[]): Promise<string> {
  const latest = await tx.volumePlanVersion.findFirst({ where: { novelId }, orderBy: { version: "desc" } });
  const active = await tx.volumePlanVersion.findFirst({ where: { novelId, status: "active" }, orderBy: { version: "desc" } });
  let nextVersion = (latest?.version ?? 0) + 1;
  // Retain the complete previous workspace, including removed membership links.
  if (active) await tx.volumePlanVersion.update({ where: { id: active.id }, data: { contentJson: JSON.stringify(before), status: "frozen" } });
  else await tx.volumePlanVersion.create({ data: { novelId, version: nextVersion++, status: "frozen", contentJson: JSON.stringify(before), diffSummary: "卷段调整前的完整规划。" } });
  await tx.volumePlanVersion.updateMany({ where: { novelId, status: "active" }, data: { status: "frozen" } });
  const created = await tx.volumePlanVersion.create({ data: { novelId, version: nextVersion, status: "active", contentJson: "{}", diffSummary: "应用作者选择的卷段调整；正文和实际章序保持不变。" } });
  const activated = { ...after, activeVersionId: created.id };
  await tx.volumePlanVersion.update({ where: { id: created.id }, data: { contentJson: JSON.stringify(activated) } });
  await persistActiveVolumeWorkspace(tx, novelId, activated, created.id, { affectedVolumeIds });
  return created.id;
}
