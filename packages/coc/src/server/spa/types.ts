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
    /** Whether the My Work feature is enabled in server config. */
    myWorkEnabled?: boolean;
    /** Whether the My Life feature is enabled in server config. */
    myLifeEnabled?: boolean;
    /** Whether the scratchpad feature is enabled in server config. */
    scratchpadEnabled?: boolean;
    /** Scratchpad split layout direction. */
    scratchpadLayout?: 'horizontal' | 'vertical';
    /** Whether the workflows feature is enabled in server config. */
    workflowsEnabled?: boolean;
    /** Whether the pull requests feature is enabled in server config. */
    pullRequestsEnabled?: boolean;
    /** Whether the servers feature is enabled in server config. */
    serversEnabled?: boolean;
    /** Whether the Ralph mode feature is enabled in server config. */
    ralphEnabled?: boolean;
    /** Whether vim-style navigation (hjkl/jk/gg/G/Esc/i bindings) is enabled. */
    vimNavigationEnabled?: boolean;
    /** Whether the loops/recurring follow-up subsystem is enabled in server config. */
    loopsEnabled?: boolean;
    /** Whether the MCP OAuth auto-detection subsystem is enabled in server config. */
    mcpOauthEnabled?: boolean;
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

