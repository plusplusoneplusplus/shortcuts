/**
 * Pure helper that maps the persisted `processDetails.pendingAskUser` array
 * (server-side source of truth) onto the in-memory `AskUserBatch` shape
 * consumed by `AskUserInline`.
 *
 * Returns the *next* batch state given the persisted questions and the
 * currently-cached batch:
 * - empty/undefined persisted list → `null` (executor cleared the ask)
 * - same `batchId` as the current batch → `current` (preserves identity to
 *   avoid React re-renders / clobbering a freshly-arrived live SSE batch)
 * - new `batchId` → fresh batch with questions sorted by `index`
 */
import type { AskUserBatch, AskUserQuestion } from './useChatSSE';

export function hydrateAskUserBatch(
    persisted: AskUserQuestion[] | null | undefined,
    current: AskUserBatch | null,
): AskUserBatch | null {
    if (!persisted || persisted.length === 0) {
        return null;
    }
    const batchId = persisted[0].batchId;
    if (current && current.batchId === batchId) {
        return current;
    }
    const sorted = [...persisted].sort((a, b) => a.index - b.index);
    return { batchId, questions: sorted };
}
