/**
 * AC-02 helpers — PR-submit task construction and idempotency guards.
 *
 * Responsibilities:
 *  - Build the queue payload for a Ralph PR-submit task.
 *  - Provide a per-process in-memory Set that guards against duplicate enqueues
 *    (concurrent submit requests computing the same submitIndex).
 *  - Provide pure helpers for computing the next submitIndex and detecting an
 *    in-flight submit in the persisted record.
 *
 * Mirrors `enqueue-final-check.ts`. The submit job is enqueued with the
 * workspace default provider/model — no AI-selection payload.
 */

import { buildRalphSubmitPrompt } from '@plusplusoneplusplus/coc-workflow/ralph';
import type { RalphIterationRecord, RalphSessionRecord, RalphSubmitRecord } from './types';

// ============================================================================
// In-memory idempotency guard
// ============================================================================

/**
 * Key format: `<sessionId>:<submitIndex>`
 * Guards against two concurrent submit requests that both read the session
 * record before either persists its queued submit record. Persistent duplicate
 * detection uses `findActiveSubmit`.
 */
const _enqueuedSet = new Set<string>();

export function submitIdempotencyKey(sessionId: string, submitIndex: number): string {
    return `${sessionId}:${submitIndex}`;
}

export function wasSubmitEnqueued(sessionId: string, submitIndex: number): boolean {
    return _enqueuedSet.has(submitIdempotencyKey(sessionId, submitIndex));
}

export function markSubmitEnqueued(sessionId: string, submitIndex: number): void {
    _enqueuedSet.add(submitIdempotencyKey(sessionId, submitIndex));
}

/** Roll back the in-memory mark when the enqueue itself fails. */
export function unmarkSubmitEnqueued(sessionId: string, submitIndex: number): void {
    _enqueuedSet.delete(submitIdempotencyKey(sessionId, submitIndex));
}

/** Exposed for test isolation only. */
export function _clearSubmitEnqueuedSet(): void {
    _enqueuedSet.clear();
}

// ============================================================================
// Persistent duplicate detection
// ============================================================================

/**
 * Returns the first submit record that is still `queued` or `running`, if any.
 * A session with such a record must not accept another submit (409).
 */
export function findActiveSubmit(session: RalphSessionRecord): RalphSubmitRecord | undefined {
    return (session.submits ?? []).find(s => s.status === 'queued' || s.status === 'running');
}

// ============================================================================
// Submit index helpers
// ============================================================================

/** Returns the 1-based index for the next submit. */
export function nextSubmitIndex(session: RalphSessionRecord): number {
    return (session.submits?.length ?? 0) + 1;
}

// ============================================================================
// Commit-range derivation
// ============================================================================

/**
 * Derive the closed commit range bounds for the next submit of a session.
 *
 * `endSha` is the HEAD SHA recorded after the session's last *completed*
 * iteration — running/failed/cancelled iterations are skipped, and legacy
 * iterations without a `headSha` yield `undefined`. `excludeShas` is the
 * de-duplicated union of every commit SHA earlier submits already sent, so a
 * second submit does not re-send them.
 */
export function deriveSubmitCommitRange(session: RalphSessionRecord): {
    endSha?: string;
    excludeShas: string[];
} {
    let last: RalphIterationRecord | undefined;
    for (const it of session.iterations ?? []) {
        if (it.status !== 'completed') continue;
        if (!last || it.iteration >= last.iteration) last = it;
    }

    const seen = new Set<string>();
    const excludeShas: string[] = [];
    for (const submit of session.submits ?? []) {
        for (const sha of submit.commitShas ?? []) {
            if (!sha || seen.has(sha)) continue;
            seen.add(sha);
            excludeShas.push(sha);
        }
    }

    return { endSha: last?.headSha, excludeShas };
}

// ============================================================================
// Task payload builder
// ============================================================================

export interface BuildSubmitTaskInput {
    workspaceId: string;
    sessionId: string;
    originalGoal: string;
    submitIndex: number;
    progressPath: string;
    /** HEAD SHA recorded at session creation; absent on legacy sessions. */
    baselineSha?: string;
    /** HEAD SHA after the session's last completed iteration; closes the range. */
    endSha?: string;
    /** Commit SHAs already submitted by earlier submits of this session. */
    excludeShas?: string[];
    sessionStartedAt: string;
    sessionCompletedAt?: string;
    workingDirectory?: string;
    folderPath?: string;
    repoId?: string;
    extraContext?: Record<string, unknown>;
}

/**
 * Build a `chat` queue task payload for a PR-submit run.
 *
 * The task uses `mode='ralph'` so completion is routed through the ralph
 * completion path; `context.ralph.submit` signals the bridge to route the
 * completion to the submit handler instead of enqueuing the next iteration.
 *
 * Intentionally carries no provider/model/config selection — the queue applies
 * the workspace defaults.
 */
export function buildSubmitTaskPayload(input: BuildSubmitTaskInput) {
    const {
        workspaceId, sessionId, originalGoal, submitIndex, progressPath,
        baselineSha, endSha, excludeShas, sessionStartedAt, sessionCompletedAt,
        workingDirectory, folderPath, repoId, extraContext,
    } = input;

    const prompt = buildRalphSubmitPrompt({
        originalGoal,
        progressPath,
        sessionId,
        submitIndex,
        baselineSha,
        endSha,
        excludeShas,
        sessionStartedAt,
        sessionCompletedAt,
    });

    return {
        type: 'chat' as const,
        priority: 'normal' as const,
        repoId,
        folderPath,
        continuationOfSessionId: sessionId,
        displayName: `Ralph PR submit ${submitIndex} (${sessionId})`,
        config: {},
        payload: {
            kind: 'chat' as const,
            mode: 'ralph' as const,
            prompt,
            workspaceId,
            workingDirectory,
            folderPath,
            context: {
                ...(extraContext ?? {}),
                ralph: {
                    phase: 'executing' as const,
                    sessionId,
                    originalGoal,
                    submit: {
                        kind: 'submit-pr' as const,
                        submitIndex,
                    },
                },
                taskGroup: {
                    groupId: sessionId,
                    groupType: 'ralph' as const,
                    role: 'submit-pr',
                    itemKey: `submit-${submitIndex}`,
                    workspaceId,
                },
            },
        },
    };
}
