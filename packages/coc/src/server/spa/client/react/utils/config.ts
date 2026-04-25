/**
 * Dashboard config — reads server-provided configuration
 * from the global window.__DASHBOARD_CONFIG__ set by the HTML template.
 */

interface DashboardConfig {
    apiBasePath: string;
    wsPath: string;
    hostname?: string;
    terminalEnabled?: boolean;
    notesEnabled?: boolean;
    myWorkEnabled?: boolean;
    myLifeEnabled?: boolean;
    scratchpadEnabled?: boolean;
    scratchpadLayout?: 'horizontal' | 'vertical';
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

export function getHostname(): string | undefined {
    return getConfig().hostname;
}

export function isTerminalEnabled(): boolean {
    return getConfig().terminalEnabled === true;
}

export function isNotesEnabled(): boolean {
    return getConfig().notesEnabled === true;
}

export function isMyWorkEnabled(): boolean {
    return getConfig().myWorkEnabled === true;
}

export function isMyLifeEnabled(): boolean {
    return getConfig().myLifeEnabled === true;
}

export function isScratchpadEnabled(): boolean {
    return getConfig().scratchpadEnabled === true;
}

export function getScratchpadLayout(): 'horizontal' | 'vertical' {
    return getConfig().scratchpadLayout === 'horizontal' ? 'horizontal' : 'vertical';
}
