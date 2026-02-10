/**
 * Server Types — Serve command options.
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

/**
 * Options for the `deep-wiki serve` command.
 */
export interface ServeCommandOptions {
    /** Port to listen on (default: 3000) */
    port?: number;
    /** Host/address to bind to (default: 'localhost') */
    host?: string;
    /** Generate wiki before serving (path to repo) */
    generate?: string;
    /** Watch repo for changes (requires --generate) */
    watch?: boolean;
    /** Enable AI Q&A and deep-dive features */
    ai?: boolean;
    /** AI model for Q&A sessions */
    model?: string;
    /** Open browser on start */
    open?: boolean;
    /** Website theme */
    theme?: string;
    /** Override project title */
    title?: string;
    /** Verbose logging */
    verbose?: boolean;
}
