/**
 * Follow-up Mode Resolver
 *
 * Single source of truth for "what mode does this follow-up run in?".
 *
 * Rule: an explicit mode (caller-supplied) wins; otherwise inherit
 * from the process's persisted `metadata.mode` (set when the process was
 * first created and refreshed by `FollowUpExecutor` after each turn);
 * otherwise default to `'ask'`.
 *
 * One exception: when the persisted mode is terminal (see
 * `isTerminalChatMode` — today that means `sentinel`), the conversation keeps
 * that mode and the explicit mode is ignored. The mode *is* the conversation's
 * workflow identity there, so a per-turn switch would demote the sentinel.
 *
 * Resolve once at *enqueue* time so the queued task carries `payload.mode`,
 * and the UI badge plus execution use the same value.
 */

import type { ProcessStore } from '@plusplusoneplusplus/forge';
import { getLogger, LogCategory } from '@plusplusoneplusplus/forge';
import type { ChatMode } from '../tasks/task-types';
import { isTerminalChatMode, normalizeChatMode } from '../tasks/task-types';

export async function resolveFollowUpMode(
    store: ProcessStore,
    processId: string,
    explicit?: ChatMode | string,
): Promise<ChatMode> {
    const explicitMode = normalizeChatMode(explicit);
    // The persisted mode is read even when an explicit mode is supplied: a
    // terminal persisted mode overrides it.
    let persisted: ChatMode | undefined;
    try {
        const proc = await store.getProcess(processId);
        persisted = normalizeChatMode(proc?.metadata?.mode);
    } catch {
        // Treat an unreadable process as having no persisted mode.
    }
    if (persisted && isTerminalChatMode(persisted)) {
        if (explicitMode && explicitMode !== persisted) {
            getLogger().warn(
                LogCategory.AI,
                `[FollowUp] Ignoring requested mode '${explicitMode}' for process ${processId}: ` +
                `'${persisted}' is a terminal conversation mode and cannot be switched away from.`,
            );
        }
        return persisted;
    }
    return explicitMode ?? persisted ?? 'ask';
}
