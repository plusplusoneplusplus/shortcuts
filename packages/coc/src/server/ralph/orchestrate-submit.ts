/**
 * AC-03 — Orchestrate the outcome of a completed PR-submit task.
 *
 * Parses the RALPH_SUBMIT_RESULT block from the agent response and updates
 * the persisted submit record in session.json:
 *  - status 'submitted'  → record 'completed' with prUrl/prNumber/commitShas
 *  - status 'failed'     → record 'failed' with the agent's error
 *  - missing/malformed   → record 'failed' with error 'unparseable'
 *
 * Mirrors `orchestrate-final-check.ts` in shape (injected store, log-and-
 * swallow errors) but has no follow-up actions — a submit never enqueues
 * further work.
 */

import { parseRalphSubmitResult } from '@plusplusoneplusplus/coc-workflow/ralph';
import { getLogger, LogCategory } from '@plusplusoneplusplus/forge';
import { RalphSessionStore } from './ralph-session-store';
import type { RalphSubmitRecord } from './types';

export interface OrchestrateSubmitDeps {
    /** Persist submit records into session.json. */
    store: RalphSessionStore;
}

export interface OrchestrateSubmitInput {
    workspaceId: string;
    sessionId: string;
    /** 1-based index of the submit within the session. */
    submitIndex: number;
    taskId: string;
    processId: string;
    responseText: string;
    deps: OrchestrateSubmitDeps;
}

/**
 * Intentionally async-void from the bridge's perspective: all errors are
 * logged and do not propagate.
 */
export async function orchestrateSubmitCompletion(input: OrchestrateSubmitInput): Promise<void> {
    const { workspaceId, sessionId, submitIndex, taskId, processId, responseText, deps } = input;
    const { store } = deps;
    const logger = getLogger();

    // Record the now-known processId first so the submit node can open the
    // chat detail even if result persistence below fails.
    await safeUpsert(store, workspaceId, sessionId, submitIndex, {
        status: 'running',
        taskId,
        processId,
    }, logger);

    const result = parseRalphSubmitResult(responseText);
    const completedAt = new Date().toISOString();

    if (result.status === 'submitted') {
        await safeUpsert(store, workspaceId, sessionId, submitIndex, {
            status: 'completed',
            completedAt,
            processId,
            ...(result.prUrl ? { prUrl: result.prUrl } : {}),
            ...(result.prNumber !== undefined ? { prNumber: result.prNumber } : {}),
            ...(result.commitShas ? { commitShas: result.commitShas } : {}),
        }, logger);
        return;
    }

    if (result.status === 'unparseable') {
        logger.warn(
            LogCategory.AI,
            `[Ralph/Submit] Submit ${submitIndex} for ${sessionId} produced no parseable RALPH_SUBMIT_RESULT: ${result.error ?? ''}`,
        );
    }

    await safeUpsert(store, workspaceId, sessionId, submitIndex, {
        status: 'failed',
        completedAt,
        processId,
        error: result.status === 'unparseable' ? 'unparseable' : (result.error ?? 'failed'),
        ...(result.commitShas ? { commitShas: result.commitShas } : {}),
    }, logger);
}

async function safeUpsert(
    store: RalphSessionStore,
    workspaceId: string,
    sessionId: string,
    submitIndex: number,
    partial: Partial<RalphSubmitRecord> & Pick<RalphSubmitRecord, 'status'>,
    logger: ReturnType<typeof getLogger>,
): Promise<void> {
    try {
        await store.upsertSubmitRecord(workspaceId, sessionId, submitIndex, partial);
    } catch (err) {
        logger.warn(
            LogCategory.AI,
            `[Ralph/Submit] Failed to persist submit ${submitIndex} for ${sessionId}: ${err instanceof Error ? err.message : String(err)}`,
        );
    }
}
