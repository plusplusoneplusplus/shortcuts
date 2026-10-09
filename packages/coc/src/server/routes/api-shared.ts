/**
 * Mirrors the `QueueGlobalState` / `QueueRouteContext` pattern used by queue routes.
 * Each `registerXxxRoutes(routes, ctx)` function receives this context object
 * so that shared dependencies (store, bridge, WS server) are injected rather than imported.
 */

import type { ChatStyle } from '@plusplusoneplusplus/coc-client';
import type { ProcessStore } from '@plusplusoneplusplus/forge';
import type { GitOpsStore } from '@plusplusoneplusplus/forge';
import type { NativeDatabase } from '@plusplusoneplusplus/coc-native';
import type { Route } from '../types';
import type { QueueExecutorBridge } from '../core/api-handler';
import type { ProcessWebSocketServer } from '../streaming/websocket';
import type { ActiveWorkspaceTracker } from '../dashboard/active-workspace-tracker';
import type { ParsedUrlQuery } from 'querystring';
import { createRoute, type CreateRouteOptions, type RouteHandlerContext } from './route-utils';

export interface ApiRouteContext {
    routes: Route[];
    store: ProcessStore;
    bridge?: QueueExecutorBridge;
    dataDir?: string;
    getWsServer?: () => ProcessWebSocketServer | undefined;
    activeWorkspaceTracker?: ActiveWorkspaceTracker;
    getSentinelMirror?: () => import('../messaging/sentinel-mirror-service').SentinelMirrorService | undefined;
    gitOpsStore: GitOpsStore;
    db?: NativeDatabase;
    /**
     * Whether the cron/recurring follow-up subsystem is enabled.
     * Remains startup-captured because cron infrastructure (executor, timers)
     * is wired once at startup — classified as `restartRequired`.
     */
    cronEnabled?: boolean;
    /**
     * Live getter for runtime config feature flags.
     * Reads from RuntimeConfigService so per-request handlers see admin
     * config changes without a server restart. Falls back to startup
     * values when runtimeConfigService is not available.
     */
    getLiveFeatureFlags?: () => { excalidrawEnabled: boolean; canvasEnabled: boolean; kustoEnabled: boolean; llmToolSystemOneEnabled?: boolean; chatStyleSelectorEnabled: boolean; chatProviderSwitchingEnabled: boolean; botManagedConversationsEnabled?: boolean; defaultChatStyle: ChatStyle };
}

/** Maximum git output buffer size (50 MB) — matches forge DEFAULT_MAX_BUFFER. */
export const GIT_MAX_BUFFER = 50 * 1024 * 1024;

/** Maximum number of diff lines returned before truncation kicks in. */
export const DIFF_LINE_LIMIT = 100_000;

export function createLocalPatchRoute<TQuery = ParsedUrlQuery, TResult = unknown>(
    opts: Omit<CreateRouteOptions<TQuery, TResult>, 'handler'> & {
        handler: (ctx: RouteHandlerContext<TQuery> & { signal: AbortSignal }) => Promise<TResult | void> | TResult | void;
    },
): Route {
    return createRoute({
        ...opts,
        handler: async ctx => {
            const { req, res } = ctx;
            const controller = new AbortController();
            const abort = () => controller.abort(new Error('Patch HTTP request abandoned'));
            const close = () => { if (!res.writableFinished) abort(); };
            // IncomingMessage.close also fires for a normally completed GET body.
            req.on('aborted', abort);
            res.on('close', close);
            try {
                if (req.aborted || res.destroyed) abort();
                controller.signal.throwIfAborted();
                const result = await opts.handler({ ...ctx, signal: controller.signal });
                controller.signal.throwIfAborted();
                return result;
            } catch (error) {
                if (!controller.signal.aborted) throw error;
                // A disconnected response has no recipient for a result or error.
            } finally {
                req.off('aborted', abort);
                res.off('close', close);
            }
        },
    });
}

/**
 * If the diff exceeds DIFF_LINE_LIMIT lines and `full` is not true,
 * returns a truncated version with metadata. Otherwise returns the full diff.
 */
export function truncateDiffIfNeeded(
    diff: string,
    full: boolean,
): { diff: string; truncated?: boolean; totalLines?: number } {
    const lines = diff.split('\n');
    if (!full && lines.length > DIFF_LINE_LIMIT) {
        return {
            diff: lines.slice(0, DIFF_LINE_LIMIT).join('\n'),
            truncated: true,
            totalLines: lines.length,
        };
    }
    return { diff };
}
