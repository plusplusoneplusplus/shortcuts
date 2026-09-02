/**
 * Follow-up Mode Resolver
 *
 * Single source of truth for "what mode does this follow-up run in?".
 *
 * Rule: an explicit mode (caller-supplied) always wins; otherwise inherit
 * from the process's persisted `metadata.mode` (set when the process was
 * first created and refreshed by `FollowUpExecutor` after each turn);
 * otherwise default to `'ask'`.
 *
 * Resolve once at *enqueue* time so the queued task carries `payload.mode`,
 * and the UI badge plus execution use the same value.
 */

import type { ProcessStore } from '@plusplusoneplusplus/forge';
import type { ChatMode } from '../tasks/task-types';
import { normalizeChatMode } from '../tasks/task-types';

/**
 * An explicit mode bypasses the process lookup entirely.
 */
export async function resolveFollowUpMode(
    store: ProcessStore,
    processId: string,
    explicit?: ChatMode | string,
): Promise<ChatMode> {
    const explicitMode = normalizeChatMode(explicit);
    if (explicitMode) return explicitMode;
    try {
        const proc = await store.getProcess(processId);
        const prev = normalizeChatMode(proc?.metadata?.mode);
        if (prev) return prev;
    } catch {
        // Fall through to default
    }
    return 'ask';
}
