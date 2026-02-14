export interface DashboardOptions {
    /** Page title (default: "AI Execution Dashboard") */
    title?: string;
    /** Default theme: 'light' | 'dark' | 'auto' */
    theme?: 'light' | 'dark' | 'auto';
    /** WebSocket endpoint path (default: "/ws") */
    wsPath?: string;
    /** API base path (default: "/api") */
    apiBasePath?: string;
}

export interface ScriptOptions {
    defaultTheme: 'light' | 'dark' | 'auto';
    wsPath: string;
    apiBasePath: string;
}
