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
import { ContextBuilder } from './context-builder';
import { WebSocketServer } from './websocket';
import { FileWatcher } from './file-watcher';
import type { AskAIFunction } from './ask-handler';
import { ConversationSessionManager } from './conversation-session-manager';
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
    /** AI SDK send function (required when aiEnabled=true) */
    aiSendMessage?: AskAIFunction;
    /** AI model override */
    aiModel?: string;
    /** Enable watch mode for live reload */
    watch?: boolean;
    /** Debounce interval for file watcher in ms (default: 2000) */
    watchDebounceMs?: number;
}

/**
 * A running wiki server instance.
 */
export interface WikiServer {
    /** The underlying HTTP server */
    server: http.Server;
    /** The wiki data layer */
    wikiData: WikiData;
    /** The context builder for AI Q&A (only when AI is enabled) */
    contextBuilder?: ContextBuilder;
    /** The conversation session manager (only when AI is enabled) */
    sessionManager?: ConversationSessionManager;
    /** The WebSocket server (only when watch mode is enabled) */
    wsServer?: WebSocketServer;
    /** The file watcher (only when watch mode is enabled) */
    fileWatcher?: FileWatcher;
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

    // Build context index for AI Q&A
    let contextBuilder: ContextBuilder | undefined;
    let sessionManager: ConversationSessionManager | undefined;
    if (aiEnabled) {
        const markdownData = wikiData.getMarkdownData();
        const topicMarkdownData = wikiData.getTopicMarkdownData();
        contextBuilder = new ContextBuilder(wikiData.graph, markdownData, topicMarkdownData);

        if (options.aiSendMessage) {
            sessionManager = new ConversationSessionManager({
                sendMessage: options.aiSendMessage,
            });
        }
    }

    // Generate SPA HTML
    const spaHtml = generateSpaHtml({
        theme,
        title,
        enableSearch: true,
        enableAI: aiEnabled,
        enableGraph: true,
        enableWatch: !!(options.watch && options.repoPath),
    });

    // Set up WebSocket server and file watcher
    let wsServer: WebSocketServer | undefined;
    let fileWatcher: FileWatcher | undefined;

    // Mutable ref so the router closure always sees the latest wsServer
    const wsRef: { current?: WebSocketServer } = {};

    // Create HTTP server
    const handler = createRequestHandler({
        wikiData,
        spaHtml,
        aiEnabled,
        repoPath: options.repoPath,
        contextBuilder,
        aiSendMessage: options.aiSendMessage,
        aiModel: options.aiModel,
        aiWorkingDirectory: options.repoPath,
        sessionManager,
        get wsServer() { return wsRef.current; },
    });

    const server = http.createServer(handler);

    if (options.watch && options.repoPath) {
        wsServer = new WebSocketServer();
        wsRef.current = wsServer;
        wsServer.attach(server);

        // Handle ping from clients
        wsServer.onMessage((client, msg) => {
            if (msg.type === 'ping') {
                client.send(JSON.stringify({ type: 'pong' }));
            }
        });

        // Set up file watcher
        fileWatcher = new FileWatcher({
            repoPath: options.repoPath,
            wikiDir: options.wikiDir,
            componentGraph: wikiData.graph,
            debounceMs: options.watchDebounceMs,
            onChange: (affectedComponentIds) => {
                // Notify clients about rebuild
                wsServer!.broadcast({ type: 'rebuilding', components: affectedComponentIds });

                // Reload wiki data
                try {
                    wikiData.reload();

                    // Rebuild context index if AI is enabled
                    if (aiEnabled && contextBuilder) {
                        const markdownData = wikiData.getMarkdownData();
                        const newBuilder = new ContextBuilder(wikiData.graph, markdownData);
                        // Note: we can't reassign contextBuilder since it's const,
                        // but the router already has a reference, so we just notify
                    }

                    wsServer!.broadcast({ type: 'reload', components: affectedComponentIds });
                } catch (err) {
                    const msg = err instanceof Error ? err.message : 'Unknown error';
                    wsServer!.broadcast({ type: 'error', message: msg });
                }
            },
            onError: (err) => {
                wsServer!.broadcast({ type: 'error', message: err.message });
            },
        });

        fileWatcher.start();
    }

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
        contextBuilder,
        sessionManager,
        wsServer,
        fileWatcher,
        port: actualPort,
        host,
        url,
        close: async () => {
            if (sessionManager) {
                sessionManager.destroyAll();
            }
            if (fileWatcher) {
                fileWatcher.stop();
            }
            if (wsServer) {
                wsServer.closeAll();
            }
            await new Promise<void>((resolve, reject) => {
                server.close((err) => {
                    if (err) { reject(err); }
                    else { resolve(); }
                });
            });
        },
    };
}

// Re-export types and modules used by consumers
export { WikiData } from './wiki-data';
export { generateSpaHtml } from './spa-template';
export { ContextBuilder } from './context-builder';
export { WebSocketServer } from './websocket';
export { FileWatcher } from './file-watcher';
export type { SpaTemplateOptions } from './spa-template';
export type { ComponentSummary, ComponentDetail, SpecialPage, TopicArticleContent, TopicArticleDetail } from './wiki-data';
export { ConversationSessionManager } from './conversation-session-manager';
export type { ConversationSession, ConversationSessionManagerOptions, SessionSendResult } from './conversation-session-manager';
export type { AskAIFunction, AskRequest, ConversationMessage } from './ask-handler';
export type { ExploreRequest } from './explore-handler';
export type { RetrievedContext, TopicContextEntry } from './context-builder';
export type { WSClient, WSMessage } from './websocket';
export type { FileWatcherOptions } from './file-watcher';
export { handleAdminRequest } from './admin-handlers';
export type { AdminHandlerContext } from './admin-handlers';
export { handleGenerateRequest, getGenerationState, resetGenerationState } from './generate-handler';
export type { GenerateHandlerContext, GenerateRequest } from './generate-handler';
