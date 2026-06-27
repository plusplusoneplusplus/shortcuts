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
import type { ChatProvider } from '../tasks/task-types';
import type { AutoProviderResolutionResult } from '../agent-providers/auto-provider-router';
import type { ResolveDefaultProviderOptions } from '../routes/queue-shared';

export { buildContextPrompt, buildSummarizePrompt, serializeConversationForSummary } from '../routes/queue-shared';
export type { SummarizeConversation } from '../routes/queue-shared';

export function registerQueueRoutes(
    routes: Route[],
    bridge: MultiRepoQueueRouter,
    store?: ProcessStore,
    globalWorkspaceRootPath?: string,
    options: {
        getDefaultProvider?: () => ChatProvider;
        resolveDefaultProvider?: (options?: ResolveDefaultProviderOptions) => Promise<AutoProviderResolutionResult>;
        isAutoProviderRoutingActive?: () => boolean;
        getEffortTiersForProvider?: (provider: ChatProvider) => StoredEffortTiersMap | undefined;
        /**
         * Shared global queue state. When supplied (by the route layer), the HTTP
         * enqueue path and any in-process enqueue capability (e.g. the
         * `create_conversation` tool) observe the same global pause flags. When
         * omitted, a fresh state is created (default for tests / standalone use).
         */
        state?: QueueGlobalState;
    } = {},
): void {
    const state: QueueGlobalState = options.state ?? {
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
        resolveDefaultProvider: options.resolveDefaultProvider,
        isAutoProviderRoutingActive: options.isAutoProviderRoutingActive,
        getEffortTiersForProvider: options.getEffortTiersForProvider,
    };
    registerQueueEnqueueRoutes(routes, ctx);
    registerQueueStatsRoutes(routes, ctx);
    registerQueueControlRoutes(routes, ctx);
    registerQueueFollowUpRoutes(routes, ctx);
    registerQueueImagesRoutes(routes, ctx);
}
