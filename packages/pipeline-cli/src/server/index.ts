/**
 * Pipeline Execution Server
 *
 * Creates and manages an HTTP server for the `pipeline serve` command.
 * Uses only Node.js built-in modules (http, fs, path, os).
 *
 * Mirrors packages/deep-wiki/src/server/index.ts pattern.
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import * as http from 'http';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { createRequestHandler } from './router';
import type { ExecutionServerOptions, ExecutionServer } from './types';
import type { ProcessStore } from '@plusplusoneplusplus/pipeline-core';

// ============================================================================
// Stub Process Store
// ============================================================================

/**
 * Minimal in-memory ProcessStore stub used when no store is injected.
 * Placeholder until a real store is wired in via a later commit.
 */
function createStubStore(): ProcessStore {
    return {
        addProcess: async () => {},
        updateProcess: async () => {},
        getProcess: async () => undefined,
        getAllProcesses: async () => [],
        removeProcess: async () => {},
        clearProcesses: async () => 0,
        getWorkspaces: async () => [],
        registerWorkspace: async () => {},
    };
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Create and start the pipeline execution server.
 *
 * @param options - Server options
 * @returns A running ExecutionServer instance
 */
export async function createExecutionServer(options: ExecutionServerOptions = {}): Promise<ExecutionServer> {
    const port = options.port ?? 4000;
    const host = options.host ?? 'localhost';
    const dataDir = options.dataDir ?? path.join(os.homedir(), '.pipeline-server');
    const store = options.store ?? createStubStore();

    // Ensure data directory exists
    fs.mkdirSync(dataDir, { recursive: true });

    // SPA shell placeholder
    const spaHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Pipeline Server</title></head><body><div id="app">Pipeline Execution Server</div></body></html>`;

    // Build request handler (health route is prepended automatically)
    const handler = createRequestHandler({ routes: [], spaHtml, store });
    const server = http.createServer(handler);

    // Start listening
    await new Promise<void>((resolve, reject) => {
        server.on('error', reject);
        server.listen(port, host, () => resolve());
    });

    // Resolve actual port (important when port 0 is used for random port)
    const address = server.address();
    const actualPort = typeof address === 'object' && address ? address.port : port;
    const url = `http://${host}:${actualPort}`;

    return {
        server,
        store,
        port: actualPort,
        host,
        url,
        close: async () => {
            await new Promise<void>((resolve, reject) => {
                server.close((err) => {
                    if (err) { reject(err); }
                    else { resolve(); }
                });
            });
        },
    };
}

// Re-exports
export type { ExecutionServerOptions, ExecutionServer, Route } from './types';
export type { ProcessStore } from '@plusplusoneplusplus/pipeline-core';
export { sendJson, send404, send400, send500, readJsonBody, createRequestHandler } from './router';
export type { RouterOptions } from './router';
