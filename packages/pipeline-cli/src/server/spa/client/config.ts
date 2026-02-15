/**
 * Dashboard config injection — reads server-provided configuration
 * from the global `window.__DASHBOARD_CONFIG__` set by the HTML template.
 */

interface DashboardConfig {
    apiBasePath: string;
    wsPath: string;
}

function getConfig(): DashboardConfig {
    const config = (window as any).__DASHBOARD_CONFIG__;
    if (!config) {
        return { apiBasePath: '/api', wsPath: '/ws' };
    }
    return config;
}

export function getApiBase(): string {
    return getConfig().apiBasePath;
}

export function getWsPath(): string {
    return getConfig().wsPath;
}
