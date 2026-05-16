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

const VALID_MODES: ReadonlySet<ChatMode> = new Set<ChatMode>([
    'ask',
    'plan',
    'autopilot',
    'ralph',
]);

function isChatMode(value: unknown): value is ChatMode {
    return typeof value === 'string' && VALID_MODES.has(value as ChatMode);
}

/**
 * Resolve the follow-up mode for a given process.
 *
 * @param store    ProcessStore used to look up the persisted process.
 * @param processId The conversation/process the follow-up targets.
 * @param explicit Optional explicit override; bypasses lookup entirely.
 * @returns The resolved {@link ChatMode}.
 */
export async function resolveFollowUpMode(
    store: ProcessStore,
    processId: string,
    explicit?: ChatMode,
): Promise<ChatMode> {
    if (isChatMode(explicit)) return explicit;
    try {
        const proc = await store.getProcess(processId);
        const prev = proc?.metadata?.mode;
        if (isChatMode(prev)) return prev;
    } catch {
        // Fall through to default
    }
    return 'ask';
}
