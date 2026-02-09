/**
 * Deep Wiki Interactive Server
 *
 * Creates and manages an HTTP server that serves the wiki with
 * interactive exploration capabilities.
 *
 * Uses only Node.js built-in modules (http, fs, path) and
 * the existing pipeline-core dependency.
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import * as http from 'http';
import { WikiData } from './wiki-data';
import { createRequestHandler } from './router';
import { generateSpaHtml } from './spa-template';
import type { WebsiteTheme } from '../types';

// ============================================================================
// Types
// ============================================================================

/**
 * Options for creating the wiki server.
 */
export interface WikiServerOptions {
    /** Path to the wiki output directory */
    wikiDir: string;
    /** Port to listen on (default: 3000) */
    port?: number;
    /** Host/address to bind to (default: 'localhost') */
    host?: string;
    /** Enable AI features (Q&A, deep dive) */
    aiEnabled?: boolean;
    /** Path to the repository (needed for AI features and watch mode) */
    repoPath?: string;
    /** Website theme */
    theme?: WebsiteTheme;
    /** Override project title */
    title?: string;
}

/**
 * A running wiki server instance.
 */
export interface WikiServer {
    /** The underlying HTTP server */
    server: http.Server;
    /** The wiki data layer */
    wikiData: WikiData;
    /** The port the server is listening on */
    port: number;
    /** The host the server is bound to */
    host: string;
    /** URL to access the server */
    url: string;
    /** Stop the server */
    close: () => Promise<void>;
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Create and start the wiki server.
 *
 * @param options - Server options
 * @returns A running WikiServer instance
 */
export async function createServer(options: WikiServerOptions): Promise<WikiServer> {
    const port = options.port !== undefined ? options.port : 3000;
    const host = options.host || 'localhost';
    const aiEnabled = options.aiEnabled || false;
    const theme = options.theme || 'auto';

    // Load wiki data
    const wikiData = new WikiData(options.wikiDir);
    wikiData.load();

    // Determine title
    const title = options.title || wikiData.graph.project.name;

    // Generate SPA HTML
    const spaHtml = generateSpaHtml({
        theme,
        title,
        enableSearch: true,
        enableAI: aiEnabled,
        enableGraph: false, // Phase B
    });

    // Create HTTP server
    const handler = createRequestHandler({
        wikiData,
        spaHtml,
        aiEnabled,
        repoPath: options.repoPath,
    });

    const server = http.createServer(handler);

    // Start listening
    await new Promise<void>((resolve, reject) => {
        server.on('error', reject);
        server.listen(port, host, () => resolve());
    });

    // Get actual port (important when port 0 is used for random port)
    const address = server.address();
    const actualPort = typeof address === 'object' && address ? address.port : port;
    const url = `http://${host}:${actualPort}`;

    return {
        server,
        wikiData,
        port: actualPort,
        host,
        url,
        close: () => new Promise<void>((resolve, reject) => {
            server.close((err) => {
                if (err) { reject(err); }
                else { resolve(); }
            });
        }),
    };
}

// Re-export types and modules used by consumers
export { WikiData } from './wiki-data';
export { generateSpaHtml } from './spa-template';
export type { SpaTemplateOptions } from './spa-template';
export type { ModuleSummary, ModuleDetail, SpecialPage } from './wiki-data';
