/**
 * Shared context and types for API route modules.
 *
 * Mirrors the `QueueGlobalState` / `QueueRouteContext` pattern used by queue routes.
 * Each `registerXxxRoutes(routes, ctx)` function receives this context object
 * so that shared dependencies (store, bridge, WS server) are injected rather than imported.
 */

import type { ProcessStore } from '@plusplusoneplusplus/forge';
import type { GitOpsStore } from '@plusplusoneplusplus/forge';
import type Database from 'better-sqlite3';
import type { Route } from '../types';
import type { QueueExecutorBridge } from '../core/api-handler';
import type { ProcessWebSocketServer } from '../streaming/websocket';
import type { ActiveWorkspaceTracker } from '../dashboard/active-workspace-tracker';

/**
 * Dependency context passed to every API route module.
 */
export interface ApiRouteContext {
    routes: Route[];
    store: ProcessStore;
    bridge?: QueueExecutorBridge;
    dataDir?: string;
    getWsServer?: () => ProcessWebSocketServer | undefined;
    activeWorkspaceTracker?: ActiveWorkspaceTracker;
    gitOpsStore: GitOpsStore;
    db?: Database.Database;
    /**
     * Whether the loops/recurring follow-up subsystem is enabled.
     * Remains startup-captured because loop infrastructure (executor, timers)
     * is wired once at startup — classified as `restartRequired`.
     */
    loopsEnabled?: boolean;
    /**
     * Live getter for runtime config feature flags.
     * Reads from RuntimeConfigService so per-request handlers see admin
     * config changes without a server restart. Falls back to startup
     * values when runtimeConfigService is not available.
     */
    getLiveFeatureFlags?: () => { excalidrawEnabled: boolean; canvasEnabled: boolean; explorationEnabled: boolean };
}

/** Maximum git output buffer size (50 MB) — matches forge DEFAULT_MAX_BUFFER. */
export const GIT_MAX_BUFFER = 50 * 1024 * 1024;

/** Maximum number of diff lines returned before truncation kicks in. */
export const DIFF_LINE_LIMIT = 100_000;

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
