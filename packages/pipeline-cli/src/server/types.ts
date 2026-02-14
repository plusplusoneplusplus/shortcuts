/**
 * Server Types
 *
 * Shared type definitions for the pipeline execution server module.
 * Mirrors packages/deep-wiki/src/server/types.ts pattern.
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import type * as http from 'http';
import type { ProcessStore } from '@plusplusoneplusplus/pipeline-core';

/** Options accepted by `createExecutionServer()`. */
export interface ExecutionServerOptions {
    /** Injected process store (FileProcessStore from pipeline-core). */
    store?: ProcessStore;
    /** TCP port (default `4000`). */
    port?: number;
    /** Bind address (default `'localhost'`). */
    host?: string;
    /** Directory for server state / execution artefacts (default `~/.pipeline-server/`). */
    dataDir?: string;
    /** Open the default browser on start. */
    openBrowser?: boolean;
    /** SPA colour theme. */
    theme?: 'auto' | 'light' | 'dark';
}

/** A running execution server instance. */
export interface ExecutionServer {
    server: http.Server;
    store: ProcessStore;
    port: number;
    host: string;
    url: string;
    /** Gracefully shut the server down. */
    close: () => Promise<void>;
}

/**
 * Route definition for the router table.
 * `pattern` is either an exact string or a RegExp.
 * `method` defaults to `'GET'` when omitted.
 */
export interface Route {
    method?: string;
    pattern: string | RegExp;
    handler: (req: http.IncomingMessage, res: http.ServerResponse, match?: RegExpMatchArray) => void | Promise<void>;
}
