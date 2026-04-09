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
    /** Whether the web terminal feature is enabled in server config. */
    terminalEnabled?: boolean;
    /** Whether the notes feature is enabled in server config. */
    notesEnabled?: boolean;
    /** When set, injects __REVIEW_CONFIG__ for the review editor page. */
    reviewFilePath?: string;
    /** Server project directory (for display in review editor). */
    projectDir?: string;
}

