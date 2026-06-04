import { McpOauthManager, type McpOauthManagerOptions } from './mcp-oauth-manager';
import {
    startMcpOauthMaintenanceTimer,
    type MaintenanceTimerHandle,
    type MaintenanceTimerOptions,
} from './mcp-oauth-refresher';

export interface McpOauthInfrastructure {
    manager: McpOauthManager;
    refreshTimer?: MaintenanceTimerHandle;
    dispose: () => void;
}

export interface CreateMcpOauthInfrastructureOptions extends McpOauthManagerOptions {
    autoRefresh?: { enabled: boolean } & Omit<MaintenanceTimerOptions, 'logger' | 'fetch' | 'now'>;
}

export function createMcpOauthInfrastructure(
    options: CreateMcpOauthInfrastructureOptions = {},
): McpOauthInfrastructure {
    const { autoRefresh, ...managerOptions } = options;
    const manager = new McpOauthManager(managerOptions);
    const refreshTimer = autoRefresh?.enabled
        ? startMcpOauthMaintenanceTimer({
            homeDir: autoRefresh.homeDir,
            expiryWindowSeconds: autoRefresh.expiryWindowSeconds,
            intervalMs: autoRefresh.intervalMs,
            runOnStart: autoRefresh.runOnStart,
        })
        : undefined;
    return {
        manager,
        refreshTimer,
        dispose: () => {
            refreshTimer?.stop();
            manager.clear();
        },
    };
}
