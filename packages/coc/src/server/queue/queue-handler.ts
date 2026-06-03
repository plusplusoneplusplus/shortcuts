/**
 * Queue REST API Handler
 *
 * Thin router that delegates to focused route modules under routes/.
 * Each module owns one HTTP concern (enqueue, stats, control, follow-up, images).
 */

import type { ProcessStore, StoredEffortTiersMap } from '@plusplusoneplusplus/forge';
import type { Route } from '../types';
import type { MultiRepoQueueRouter } from './multi-repo-queue-router';
import type { QueueGlobalState } from '../routes/queue-shared';
import { registerQueueEnqueueRoutes } from '../routes/queue-enqueue';
import { registerQueueStatsRoutes } from '../routes/queue-stats';
import { registerQueueControlRoutes } from '../routes/queue-control';
import { registerQueueFollowUpRoutes } from '../routes/queue-follow-up';
import { registerQueueImagesRoutes } from '../routes/queue-images';

export { buildContextPrompt, buildSummarizePrompt, serializeConversationForSummary } from '../routes/queue-shared';
export type { SummarizeConversation } from '../routes/queue-shared';

export function registerQueueRoutes(
    routes: Route[],
    bridge: MultiRepoQueueRouter,
    store?: ProcessStore,
    globalWorkspaceRootPath?: string,
    options: {
        getDefaultProvider?: () => 'copilot' | 'codex' | 'claude';
        getEffortTiersForProvider?: (provider: 'copilot' | 'codex' | 'claude') => StoredEffortTiersMap | undefined;
    } = {},
): void {
    const state: QueueGlobalState = {
        globalPaused: false,
        globalPausedUntil: undefined,
        globalAutopilotPaused: false,
        globalAutopilotPausedUntil: undefined,
        resumeInProgress: new Set(),
    };
    const ctx = {
        bridge,
        store,
        globalWorkspaceRootPath,
        state,
        getDefaultProvider: options.getDefaultProvider,
        getEffortTiersForProvider: options.getEffortTiersForProvider,
    };
    registerQueueEnqueueRoutes(routes, ctx);
    registerQueueStatsRoutes(routes, ctx);
    registerQueueControlRoutes(routes, ctx);
    registerQueueFollowUpRoutes(routes, ctx);
    registerQueueImagesRoutes(routes, ctx);
}
