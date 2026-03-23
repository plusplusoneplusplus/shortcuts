/**
 * Shared context and types for API route modules.
 *
 * Mirrors the `QueueGlobalState` / `QueueRouteContext` pattern used by queue routes.
 * Each `registerXxxRoutes(routes, ctx)` function receives this context object
 * so that shared dependencies (store, bridge, WS server) are injected rather than imported.
 */

import type { ProcessStore } from '@plusplusoneplusplus/forge';
import type { GitOpsStore } from '@plusplusoneplusplus/forge';
import type { Route } from '../types';
import type { QueueExecutorBridge } from '../api-handler';
import type { ProcessWebSocketServer } from '../websocket';

/**
 * Dependency context passed to every API route module.
 */
export interface ApiRouteContext {
    routes: Route[];
    store: ProcessStore;
    bridge?: QueueExecutorBridge;
    dataDir?: string;
    getWsServer?: () => ProcessWebSocketServer | undefined;
    gitOpsStore: GitOpsStore;
}
