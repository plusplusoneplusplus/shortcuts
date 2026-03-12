/**
 * Server Types
 *
 * Shared type definitions for the CoC execution server module.
 * Mirrors packages/deep-wiki/src/server/types.ts pattern.
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import type * as http from 'http';
import type { ProcessStore, CopilotSDKService } from '@plusplusoneplusplus/pipeline-core';
export type { Route } from './shared/router';

/** Options for the `coc serve` CLI command. */
export interface ServeCommandOptions {
    /** TCP port (default `4000`). */
    port?: number;
    /** Bind address (default `'0.0.0.0'`). */
    host?: string;
    /** Directory for process storage (default `~/.coc/`). */
    dataDir?: string;
    /** Auto-open browser on start (default `true`). */
    open?: boolean;
    /** SPA colour theme (default `'auto'`). */
    theme?: 'auto' | 'light' | 'dark';
    /** Disable colored output. */
    noColor?: boolean;
    /** Timeout in seconds for graceful queue draining on shutdown (undefined = infinite). */
    drainTimeout?: number;
    /** Disable graceful queue draining on shutdown entirely. */
    noDrain?: boolean;
    /** Policy for tasks that were running when the server last stopped (default: 'fail'). */
    queueRestartPolicy?: 'fail' | 'requeue' | 'requeue-if-retriable';
    /** Maximum number of history entries to persist per repo (default: 100). */
    queueHistoryLimit?: number;
    /** Log level for Pino logger (default: 'info'). */
    logLevel?: string;
    /** Directory for .ndjson log files. Defaults to <dataDir>/logs for serve. */
    logDir?: string;
    /** Exit code to use when a restart is requested via POST /api/admin/restart (default: 75). */
    restartExitCode?: number;
}

/** Options for the wiki module within the execution server. */
export interface WikiServerOptions {
    /** Enable wiki API endpoints. */
    enabled?: boolean;
    /** Initial wiki registrations (wikiId → { wikiDir, repoPath? }). */
    wikis?: Record<string, { wikiDir: string; repoPath?: string }>;
    /** Enable AI features (ask, explore, generate) for wikis. */
    aiEnabled?: boolean;
}

/** Options accepted by `createExecutionServer()`. */
export interface ExecutionServerOptions {
    /** Injected process store (FileProcessStore from pipeline-core). */
    store?: ProcessStore;
    /** TCP port (default `4000`). */
    port?: number;
    /** Bind address (default `'0.0.0.0'`). */
    host?: string;
    /** Directory for server state / execution artefacts (default `~/.coc/`). */
    dataDir?: string;
    /** Open the default browser on start. */
    openBrowser?: boolean;
    /** SPA colour theme. */
    theme?: 'auto' | 'light' | 'dark';
    /** Options for the wiki module. */
    wiki?: WikiServerOptions;
    /** Optional AI service injection (for testing). If not provided, uses getCopilotSDKService(). */
    aiService?: CopilotSDKService;
    /** Optional config file path override (for tests). When absent, uses getConfigFilePath(). */
    configPath?: string;
    /** Queue-specific options. */
    queue?: {
        /** Policy for tasks that were running when the server last stopped (default: 'fail'). */
        restartPolicy?: 'fail' | 'requeue' | 'requeue-if-retriable';
        /** Maximum number of history entries to persist per repo (default: 100). */
        historyLimit?: number;
        /** Whether to auto-start the queue executor (default: true). Set to false in tests to prevent task consumption. */
        autoStart?: boolean;
    };
}

/** Options for graceful shutdown with queue draining. */
export interface ServerCloseOptions {
    /** Whether to drain the queue before shutting down (default: false). */
    drain?: boolean;
    /** Maximum time to wait for drain in ms. undefined = infinite. */
    drainTimeoutMs?: number;
}

/** A running execution server instance. */
export interface ExecutionServer {
    server: http.Server;
    store: ProcessStore;
    /** WebSocket server instance (ProcessWebSocketServer from coc/server/websocket). */
    wsServer: any;
    port: number;
    host: string;
    url: string;
    /** Gracefully shut the server down. */
    close: (options?: ServerCloseOptions) => Promise<{ drainOutcome?: 'completed' | 'timeout' }>;
}

/**
 * Request body for POST /api/queue/bulk endpoint.
 * Contains an array of task specifications to enqueue.
 */
export interface BulkQueueRequest {
    /** Array of tasks to enqueue (1-100 items). */
    tasks: Array<{
        type: string;
        priority?: string;
        payload?: any;
        config?: {
            model?: string;
            timeoutMs?: number;
            retryOnFailure?: boolean;
            retryAttempts?: number;
            retryDelayMs?: number;
        };
        displayName?: string;
    }>;
}

/**
 * Response body for POST /api/queue/bulk endpoint.
 * Reports both successful enqueues and validation failures.
 */
export interface BulkQueueResponse {
    /** Successfully enqueued tasks with their IDs. */
    success: Array<{
        /** Index in the original request array (0-based). */
        index: number;
        /** Assigned task ID. */
        taskId: string;
        /** Serialized task snapshot (same format as single POST). */
        task: Record<string, unknown>;
    }>;
    /** Validation or enqueue failures. */
    failed: Array<{
        /** Index in the original request array (0-based). */
        index: number;
        /** Error message explaining the failure. */
        error: string;
        /** Original task spec that failed (for client retry/debugging). */
        taskSpec: Record<string, unknown>;
    }>;
    /** Summary statistics. */
    summary: {
        total: number;
        succeeded: number;
        failed: number;
    };
}
