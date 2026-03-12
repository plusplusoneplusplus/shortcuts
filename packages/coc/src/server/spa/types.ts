export interface DashboardOptions {
    /** Page title (default: "CoC (Copilot Of Copilot)") */
    title?: string;
    /** Default theme: 'light' | 'dark' | 'auto' */
    theme?: 'light' | 'dark' | 'auto';
    /** WebSocket endpoint path (default: "/ws") */
    wsPath?: string;
    /** API base path (default: "/api") */
    apiBasePath?: string;
    /** Enable wiki tab with CDN libs for markdown/mermaid rendering */
    enableWiki?: boolean;
    /** When set, injects __REVIEW_CONFIG__ for the review editor page. */
    reviewFilePath?: string;
    /** Server project directory (for display in review editor). */
    projectDir?: string;
}

