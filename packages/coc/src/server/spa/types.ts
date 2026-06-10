export interface DashboardOptions {
    /** Page title (default: "CoC @ <hostname>") */
    title?: string;
    /** Host machine name (default: os.hostname()) */
    hostname?: string;
    /** Default theme: 'light' | 'dark' | 'auto' */
    theme?: 'light' | 'dark' | 'auto';
    /** WebSocket endpoint path (default: "/ws") */
    wsPath?: string;
    /** API base path (default: "/api") */
    apiBasePath?: string;
    /** Enable wiki tab with CDN libs for markdown/mermaid rendering */
    enableWiki?: boolean;
    /**
     * Runtime feature flags embedded as bootstrap config
     * (window.__DASHBOARD_CONFIG__.features). Built generically from the admin
     * setting registry — see buildRuntimeFeatureFlags() — so individual flags
     * never need to be plumbed through here.
     */
    features?: Record<string, unknown>;
    /** When set, injects __REVIEW_CONFIG__ for the review editor page. */
    reviewFilePath?: string;
    /** Server project directory (for display in review editor). */
    projectDir?: string;
    /** When true, the SPA runs in container mode (multi-agent aggregation). */
    containerMode?: boolean;
    /**
     * Raw bind address the server is listening on (e.g., '0.0.0.0', '::',
     * '127.0.0.1', or a specific interface IP). Exposed to the SPA so it can
     * surface a security warning when the server is bound to all interfaces.
     */
    bindAddress?: string;
}
