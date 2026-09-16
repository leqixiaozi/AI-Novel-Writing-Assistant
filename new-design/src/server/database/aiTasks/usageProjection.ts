import type {AiUsageSummary} from "../../../common/contracts";
import {NewDesignError} from "../../domain/errors";
/** One read of original tasks, attempts and usage; never reconstructs provider usage from budgets. */
export const AI_USAGE_SUMMARY_QUERY=`SELECT count(DISTINCT task.id)::int AS task_count,
 count(usage.id)::int AS attempt_count,count(attempt.id)::int AS total_attempt_count,
 count(attempt.id) FILTER(WHERE usage.id IS NULL)::int AS unrecorded_attempt_count,
 count(attempt.id) FILTER(WHERE usage.id IS NULL OR usage.estimated_cost IS NULL OR usage.currency IS NULL)::int AS unknown_cost_attempt_count,
 sum(usage.input_tokens) AS input_tokens,sum(usage.output_tokens) AS output_tokens,
 sum(usage.cached_input_tokens) AS cached_input_tokens,sum(usage.duration_ms) AS duration_ms,
 CASE WHEN count(DISTINCT usage.currency) FILTER(WHERE usage.currency IS NOT NULL)=1 THEN sum(usage.estimated_cost) END AS estimated_cost,
 CASE WHEN count(DISTINCT usage.currency) FILTER(WHERE usage.currency IS NOT NULL)=1 THEN max(usage.currency) END AS currency,
 COALESCE(sum(usage.fallback_count),0)::int AS fallback_count,
 count(usage.id) FILTER(WHERE usage.input_tokens IS NULL OR usage.output_tokens IS NULL)::int AS unknown_count
 FROM new_design.ai_tasks task LEFT JOIN new_design.ai_task_attempts attempt ON attempt.task_id=task.id
 LEFT JOIN new_design.ai_attempt_usage usage ON usage.attempt_id=attempt.id AND usage.task_id=task.id
 WHERE ($1::uuid IS NULL OR task.book_id=$1) AND ($2::uuid IS NULL OR task.id=$2)`;
export function projectAiUsageSummary(row:Record<string,unknown>):AiUsageSummary {
 const unavailable=()=>new NewDesignError("读取原用量摘要未完成，已有运行与费用凭证保留；请刷新原记录核对，不重发模型。",503);
 const number=(key:string,integer=true):number=>{const value=row[key];if(typeof value!=="number"&&typeof value!=="string"||typeof value==="string"&&!/^\d+(?:\.\d+)?$/.test(value))throw unavailable();const parsed=Number(value);if(!Number.isFinite(parsed)||parsed<0||integer&&!Number.isSafeInteger(parsed))throw unavailable();return parsed;};
 const nullable=(key:string,integer=true)=>row[key]===null?null:number(key,integer);
 const summary:AiUsageSummary={taskCount:number("task_count"),attemptCount:number("attempt_count"),totalAttemptCount:number("total_attempt_count"),unrecordedAttemptCount:number("unrecorded_attempt_count"),unknownCostAttemptCount:number("unknown_cost_attempt_count"),inputTokens:nullable("input_tokens"),outputTokens:nullable("output_tokens"),cachedInputTokens:nullable("cached_input_tokens"),durationMs:nullable("duration_ms"),estimatedCost:nullable("estimated_cost",false),currency:typeof row.currency==="string"&&/^[A-Z]{3}$/.test(row.currency)?row.currency:null,fallbackCount:number("fallback_count"),unknownUsageCount:number("unknown_count")};
 if(summary.attemptCount+summary.unrecordedAttemptCount!==summary.totalAttemptCount||summary.unknownUsageCount>summary.attemptCount||summary.unknownCostAttemptCount>summary.totalAttemptCount)throw unavailable();return summary;
}
