/**
 * Server Client
 *
 * Fire-and-forget HTTP client that syncs AI process mutations to a remote
 * AI execution server. Uses only Node.js built-in http/https modules.
 *
 * - Every public method enqueues a request; nothing blocks the caller.
 * - A flush loop drains items sequentially with exponential back-off on failure.
 * - Queue is bounded (default 500); oldest items are dropped when full.
 */

import * as http from 'http';
import * as https from 'https';
import * as vscode from 'vscode';
import { AIProcess, serializeProcess } from './types';
import { WorkspaceInfo } from './workspace-identity';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface QueueItem {
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
    path: string;
    body?: unknown;
}

// ---------------------------------------------------------------------------
// ServerClient
// ---------------------------------------------------------------------------

export class ServerClient implements vscode.Disposable {
    private readonly host: string;
    private readonly port: number;
    private readonly protocol: 'http:' | 'https:';
    private readonly requestModule: typeof http | typeof https;
    private readonly basePath: string;

    private readonly queue: QueueItem[] = [];
    private readonly maxQueueSize: number;
    private flushing = false;
    private retryTimer: ReturnType<typeof setTimeout> | undefined;
    private backoffMs = 1000;
    private disposed = false;

    private _connected = false;

    private readonly _onDidChangeConnection = new vscode.EventEmitter<boolean>();
    readonly onDidChangeConnection: vscode.Event<boolean> = this._onDidChangeConnection.event;

    /** Current connection state */
    get connected(): boolean { return this._connected; }

    constructor(serverUrl: string, maxQueueSize = 500) {
        const parsed = new URL(serverUrl);
        this.host = parsed.hostname;
        this.port = parsed.port ? Number(parsed.port) : (parsed.protocol === 'https:' ? 443 : 80);
        this.protocol = parsed.protocol as 'http:' | 'https:';
        this.basePath = parsed.pathname.replace(/\/$/, '');
        this.requestModule = this.protocol === 'https:' ? https : http;
        this.maxQueueSize = maxQueueSize;
    }

    // ------------------------------------------------------------------
    // Public API — each method is fire-and-forget
    // ------------------------------------------------------------------

    registerWorkspace(info: WorkspaceInfo): void {
        this.enqueue({ method: 'POST', path: '/api/workspaces', body: info });
    }

    submitProcess(process: AIProcess, workspace: WorkspaceInfo): void {
        const serialized = serializeProcess(process as AIProcess & Record<string, unknown>);
        this.enqueue({
            method: 'POST',
            path: '/api/processes',
            body: { ...serialized, workspaceId: workspace.id },
        });
    }

    updateProcess(id: string, updates: Partial<AIProcess>): void {
        // Serialize the full object so dates are converted to ISO strings
        const body = serializeProcess(updates as AIProcess & Record<string, unknown>);
        this.enqueue({ method: 'PATCH', path: `/api/processes/${id}`, body });
    }

    removeProcess(id: string): void {
        this.enqueue({ method: 'DELETE', path: `/api/processes/${id}` });
    }

    cancelProcess(id: string): void {
        this.enqueue({ method: 'POST', path: `/api/processes/${id}/cancel` });
    }

    async healthCheck(): Promise<boolean> {
        try {
            const status = await this.httpRequest('GET', '/api/health');
            const ok = status >= 200 && status < 300;
            this.setConnected(ok);
            return ok;
        } catch {
            this.setConnected(false);
            return false;
        }
    }

    // ------------------------------------------------------------------
    // Queue management
    // ------------------------------------------------------------------

    /** Visible for testing */
    get queueLength(): number { return this.queue.length; }

    private enqueue(item: QueueItem): void {
        if (this.disposed) { return; }
        // Drop oldest when queue is full
        while (this.queue.length >= this.maxQueueSize) {
            this.queue.shift();
        }
        this.queue.push(item);
        this.scheduleFlush();
    }

    private scheduleFlush(): void {
        if (this.flushing || this.disposed) { return; }
        // If a retry timer is pending we don't interrupt it
        if (this.retryTimer) { return; }
        void this.flushQueue();
    }

    private async flushQueue(): Promise<void> {
        if (this.flushing || this.disposed) { return; }
        this.flushing = true;

        try {
            while (this.queue.length > 0 && !this.disposed) {
                const item = this.queue[0];
                try {
                    await this.httpRequest(item.method, item.path, item.body);
                    // Success — remove from queue and reset back-off
                    this.queue.shift();
                    this.backoffMs = 1000;
                    this.setConnected(true);
                } catch {
                    // Failure — stop flushing and schedule retry
                    this.setConnected(false);
                    this.retryTimer = setTimeout(() => {
                        this.retryTimer = undefined;
                        void this.flushQueue();
                    }, this.backoffMs);
                    this.backoffMs = Math.min(this.backoffMs * 2, 30_000);
                    return;
                }
            }
        } finally {
            this.flushing = false;
        }
    }

    // ------------------------------------------------------------------
    // HTTP helpers
    // ------------------------------------------------------------------

    private httpRequest(method: string, reqPath: string, body?: unknown): Promise<number> {
        return new Promise<number>((resolve, reject) => {
            const options: http.RequestOptions = {
                hostname: this.host,
                port: this.port,
                path: this.basePath + reqPath,
                method,
                headers: { 'Content-Type': 'application/json' },
                timeout: 5000,
            };

            const req = this.requestModule.request(options, (res) => {
                // Consume response body to free socket
                res.resume();
                const status = res.statusCode ?? 0;
                if (status >= 200 && status < 300) {
                    resolve(status);
                } else {
                    reject(new Error(`HTTP ${status}`));
                }
            });

            req.on('error', reject);
            req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });

            if (body !== undefined) {
                req.write(JSON.stringify(body));
            }
            req.end();
        });
    }

    // ------------------------------------------------------------------
    // Connection state
    // ------------------------------------------------------------------

    private setConnected(value: boolean): void {
        if (this._connected !== value) {
            this._connected = value;
            this._onDidChangeConnection.fire(value);
        }
    }

    // ------------------------------------------------------------------
    // Disposal
    // ------------------------------------------------------------------

    dispose(): void {
        this.disposed = true;
        if (this.retryTimer) {
            clearTimeout(this.retryTimer);
            this.retryTimer = undefined;
        }
        this._onDidChangeConnection.dispose();
    }
}
