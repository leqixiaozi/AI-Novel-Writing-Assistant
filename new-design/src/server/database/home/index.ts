import type { Pool, PoolClient } from "pg";
import type { HomeBookFact, HomeCreationDraft, HomeSnapshot } from "../../../common/home";
import { creationDirectorState } from "../../../common/creationDirector";
import { getInitializedNewDesignPool } from "../runtime";
import { HOME_BOOKS_QUERY, HOME_CREATION_QUERY } from "./queries";

export { HOME_BOOKS_QUERY, HOME_CREATION_QUERY } from "./queries";
type Row = Record<string, unknown>;
export type HomeReadPool = Pick<Pool, "connect">;
const date = (value: unknown): string => new Date(value as string | Date).toISOString();
const count = (value: unknown): number => {
  if (value === null || value === undefined) return 0;
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 0) throw new Error("首页统计未完整读取。");
  return result;
};
const counts = {
  cardCount: "card_count", characterCount: "character_count", worldCount: "world_count",
  requiredFieldCount: "required_field_count", filledRequiredFieldCount: "filled_required_field_count",
  storyPlanCount: "story_plan_count", volumePlanCount: "volume_plan_count", chapterPlanCount: "chapter_plan_count",
  adoptedChapterPlanCount: "adopted_chapter_plan_count", writableChapterPlanCount: "writable_chapter_plan_count",
  writtenChapterCount: "written_chapter_count", stableChapterCount: "stable_chapter_count",
  pendingFacts: "pending_facts", pendingChanges: "pending_changes", openQualityIssues: "open_quality_issues",
  staleResources: "stale_resources", pendingDependencyReviews: "pending_dependency_reviews", runningTasks: "running_tasks", queuedTasks: "queued_tasks", waitingTasks: "waiting_tasks",
} as const;

export function projectHomeBook(row: Row): HomeBookFact {
  const totals = Object.fromEntries(Object.entries(counts).map(([key, column]) => [key, count(row[column])])) as Pick<HomeBookFact, keyof typeof counts>;
  return {
    id: String(row.id), name: String(row.name), description: String(row.description ?? ""),
    createdAt: date(row.created_at), updatedAt: date(row.updated_at), ...totals,
    latestTask: row.task_id ? {
      id: String(row.task_id), status: String(row.task_status), sourceRoute: String(row.task_source_route), updatedAt: date(row.task_updated_at),
    } : null,
    latestDirector: row.director_id ? {
      id: String(row.director_id), status: String(row.director_status), leaseExpired: row.director_lease_expired === true,
      chapterCount: count(row.director_chapter_count), savedCandidateCount: count(row.director_saved_candidate_count),
    } : null,
  };
}

export function projectHomeCreation(row: Row | undefined): HomeCreationDraft | null {
  if (!row) return null;
  const state = creationDirectorState({ creationDirector: row.director_state });
  return {
    id: String(row.id), name: String(row.book_name ?? ""), status: String(row.status), stage: String(row.stage),
    progress: count(row.progress), selectedDirection: Boolean(row.selected_direction_id),
    completedStages: [...new Set(state?.completedStages ?? [])], mode: state?.mode ?? null, updatedAt: date(row.updated_at),
  };
}

/** Pool injection supports fixture checks without infrastructure startup or any business operation. */
export async function getHomeSnapshot(pool?: HomeReadPool): Promise<HomeSnapshot> {
  const source = pool ?? await getInitializedNewDesignPool();
  const client: PoolClient = await source.connect();
  try {
    await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const clock = await client.query("SELECT CURRENT_TIMESTAMP read_at");
    const books = await client.query(HOME_BOOKS_QUERY);
    const creation = await client.query(HOME_CREATION_QUERY);
    const snapshot: HomeSnapshot = {
      books: books.rows.map(projectHomeBook), creationDraft: projectHomeCreation(creation.rows[0]), readAt: date(clock.rows[0].read_at),
    };
    await client.query("COMMIT");
    return snapshot;
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch { /* Preserve the original read failure. */ }
    throw error;
  } finally {
    client.release();
  }
}
