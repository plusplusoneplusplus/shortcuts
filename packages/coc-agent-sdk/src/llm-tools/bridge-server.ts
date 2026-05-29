/**
 * CocToolBridgeServer — parent-process loopback IPC channel for the CoC LLM-tool
 * MCP bridge.
 *
 * The MCP bridge (`bridge.ts`) runs as a child process spawned by Codex's CLI or
 * Claude Code, so it cannot call the in-process CoC tool handlers directly. This
 * server hosts the per-invocation {@link CocToolRuntime}s and exposes them over a
 * `127.0.0.1` HTTP endpoint that the bridge proxies to:
 *
 *   POST /list  { }                       → { tools: RuntimeToolDescriptor[] }
 *   POST /call  { name, arguments }        → RuntimeToolResult ({ content, isError })
 *
 * Each registered runtime gets a random bearer token; the bridge presents it on
 * every request. `/call` awaits `runtime.callTool()` with no server-side timeout,
 * so blocking tools such as `ask_user` keep the HTTP request open until the SPA
 * submits an answer — preserving blocking/resume semantics across the process
 * boundary.
 *
 * Isolation & lifecycle:
 * - One shared server per process ({@link cocToolBridgeServer}), reference-counted
 *   by active registrations. It binds lazily on first registration and shuts down
 *   when the last runtime unregisters — no idle server, no session caching.
 * - Bound to loopback only and token-gated; never exposed off-host.
 */

import * as http from 'http';
import * as crypto from 'crypto';
import type { AddressInfo } from 'net';
import { getSDKLogger } from '../logger';
import { CocToolRuntime } from './coc-tool-runtime';

/** Handle returned from {@link CocToolBridgeServer.register}. */
export interface CocToolBridgeRegistration {
    /** Bearer token the bridge must present on every request. */
    token: string;
    /** Base endpoint URL (e.g. `http://127.0.0.1:54321`). */
    endpoint: string;
    /** Remove this runtime and tear the server down if it was the last one. */
    unregister: () => void;
}

const MAX_BODY_BYTES = 16 * 1024 * 1024;

export class CocToolBridgeServer {
    private server: http.Server | null = null;
    private startPromise: Promise<void> | null = null;
    private port = 0;
    private readonly runtimes = new Map<string, CocToolRuntime>();

    /** Number of currently registered runtimes. */
    public get activeCount(): number {
        return this.runtimes.size;
    }

    /** Base endpoint while the server is listening, otherwise `null`. */
    public get endpoint(): string | null {
        return this.server ? `http://127.0.0.1:${this.port}` : null;
    }

    /**
     * Register a per-invocation runtime, starting the loopback server if needed.
     * Returns the endpoint + token to embed in the bridge MCP config, and an
     * `unregister()` to call when the turn completes or aborts.
     */
    public async register(runtime: CocToolRuntime): Promise<CocToolBridgeRegistration> {
        await this.ensureStarted();
        const token = crypto.randomBytes(24).toString('hex');
        this.runtimes.set(token, runtime);
        getSDKLogger().debug({ activeCount: this.runtimes.size, port: this.port }, '[CocToolBridge] runtime registered');
        return {
            token,
            endpoint: `http://127.0.0.1:${this.port}`,
            unregister: () => this.unregister(token),
        };
    }

    private unregister(token: string): void {
        if (!this.runtimes.delete(token)) return;
        getSDKLogger().debug({ activeCount: this.runtimes.size }, '[CocToolBridge] runtime unregistered');
        if (this.runtimes.size === 0) {
            this.stop();
        }
    }

    private ensureStarted(): Promise<void> {
        if (this.server) return Promise.resolve();
        if (this.startPromise) return this.startPromise;

        this.startPromise = new Promise<void>((resolve, reject) => {
            const server = http.createServer((req, res) => {
                void this.handleRequest(req, res);
            });
            // Disable the request-receive timeout so a long-blocking tools/call
            // (e.g. ask_user awaiting the user) is never force-closed.
            server.requestTimeout = 0;
            server.headersTimeout = 0;
            server.once('error', (err) => {
                this.startPromise = null;
                reject(err);
            });
            server.listen(0, '127.0.0.1', () => {
                this.port = (server.address() as AddressInfo).port;
                this.server = server;
                getSDKLogger().debug({ port: this.port }, '[CocToolBridge] loopback server started');
                resolve();
            });
        });
        return this.startPromise;
    }

    private stop(): void {
        const server = this.server;
        this.server = null;
        this.startPromise = null;
        this.port = 0;
        if (server) {
            server.close(() => {});
            getSDKLogger().debug('[CocToolBridge] loopback server stopped');
        }
    }

    /** Force-stop the server and drop all runtimes (test/teardown helper). */
    public closeAll(): void {
        this.runtimes.clear();
        this.stop();
    }

    private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
        try {
            if (req.method !== 'POST') {
                return sendJson(res, 405, { error: 'Method not allowed' });
            }

            const runtime = this.resolveRuntime(req);
            if (!runtime) {
                return sendJson(res, 401, { error: 'Unknown or missing bridge token' });
            }

            const url = req.url ?? '';
            if (url === '/list') {
                await readJsonBody(req); // drain body
                return sendJson(res, 200, { tools: runtime.listTools() });
            }

            if (url === '/call') {
                const body = await readJsonBody(req) as { name?: unknown; arguments?: unknown };
                const name = typeof body?.name === 'string' ? body.name : '';
                if (!name) {
                    return sendJson(res, 400, { error: 'Missing tool name' });
                }
                const result = await runtime.callTool(name, body?.arguments ?? {});
                return sendJson(res, 200, result);
            }

            return sendJson(res, 404, { error: `Unknown path: ${url}` });
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            getSDKLogger().debug({ err: message }, '[CocToolBridge] request failed');
            try {
                sendJson(res, 500, { error: message });
            } catch {
                // response may already be partially written; nothing to do.
            }
        }
    }

    private resolveRuntime(req: http.IncomingMessage): CocToolRuntime | undefined {
        const auth = req.headers['authorization'];
        const header = Array.isArray(auth) ? auth[0] : auth;
        if (!header) return undefined;
        const match = /^Bearer\s+(.+)$/i.exec(header.trim());
        const token = match ? match[1] : header.trim();
        return this.runtimes.get(token);
    }
}

/** Process-wide shared bridge server, reference-counted by active registrations. */
export const cocToolBridgeServer = new CocToolBridgeServer();

// ============================================================================
// Helpers
// ============================================================================

function sendJson(res: http.ServerResponse, status: number, payload: unknown): void {
    const body = JSON.stringify(payload);
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(body);
}

function readJsonBody(req: http.IncomingMessage): Promise<unknown> {
    return new Promise((resolve, reject) => {
        let size = 0;
        const chunks: Buffer[] = [];
        req.on('data', (chunk: Buffer) => {
            size += chunk.length;
            if (size > MAX_BODY_BYTES) {
                reject(new Error('Request body too large'));
                req.destroy();
                return;
            }
            chunks.push(chunk);
        });
        req.on('end', () => {
            if (chunks.length === 0) {
                resolve({});
                return;
            }
            try {
                resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
            } catch (err) {
                reject(err instanceof Error ? err : new Error(String(err)));
            }
        });
        req.on('error', reject);
    });
}
