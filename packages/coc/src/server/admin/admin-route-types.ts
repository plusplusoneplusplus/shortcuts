/**
 * Shared types for admin route domain modules.
 *
 * Keeps the injected dependency contract in one place so each domain route
 * module and the composition wrapper (`admin-handler.ts`) share a single
 * `AdminRouteOptions` definition without importing each other.
 */

import type { ProcessStore, TaskQueueManager, SDKServiceRegistry } from '@plusplusoneplusplus/forge';
import type { RuntimeConfigService } from '../../config/runtime-config-service';
import type { CLIConfig, QueuePersistence } from '../storage/export-import-types';
import type { ProcessWebSocketServer } from '../streaming/websocket';

/** Functions for reading/writing the CLIConfig file. Injected by the caller so coc-server stays decoupled from the CLI config module. */
export interface AdminConfigFunctions {
    getConfigFilePath: () => string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    getResolvedConfigWithSource: (configPath?: string) => any;
    loadConfigFile: (configPath?: string) => CLIConfig | undefined;
    writeConfigFile: (configPath: string, config: CLIConfig) => void;
}

export interface AdminRouteOptions {
    store: ProcessStore;
    dataDir: string;
    /** Lazy getter for the WebSocket server (may not be created at route registration time). */
    getWsServer?: () => ProcessWebSocketServer | undefined;
    /** Optional config file path override (for tests). When absent, uses getConfigFilePath(). */
    configPath?: string;
    /** Lazy getter for the queue manager (for import reset). */
    getQueueManager?: () => TaskQueueManager | undefined;
    /** Lazy getter for queue persistence (for import restore). */
    getQueuePersistence?: () => QueuePersistence | undefined;
    /** Config file functions (injected from CLI layer). Falls back when runtimeConfigService is absent. */
    configFunctions?: AdminConfigFunctions;
    /** Central runtime config service. When provided, GET/PUT admin config use this instead of configFunctions. */
    runtimeConfigService?: RuntimeConfigService;
    /** Exit code to use for restart (injected to avoid circular import). Defaults to 75. */
    restartExitCode?: number;
    /** SDK service registry for per-provider availability checks. */
    sdkServiceRegistry?: SDKServiceRegistry;
    /** Override token TTL in ms (for testing). Defaults to TOKEN_EXPIRY_MS (5 min). */
    tokenTtlMs?: number;
}

/** Resolve the effective config file path from options. */
export function resolveConfigPath(options: AdminRouteOptions): string {
    return options.configPath ?? options.configFunctions?.getConfigFilePath?.() ?? '';
}
