import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import { randomUUID } from 'crypto';
import { createRequire } from 'module';
import * as path from 'path';
import { pathToFileURL } from 'url';
import {
    createMessageConnection, ErrorCodes, ResponseError, StreamMessageReader, StreamMessageWriter,
    type MessageConnection,
} from 'vscode-jsonrpc/node';
import type { CanvasDeclaration } from '@github/copilot-sdk';
import type { CLIConfig } from '../../config';
import type { DiscoveredCanvasExtension } from './discovery';

const bundledRequire = createRequire(__filename);
const loggedUnknownMethods = new Set<string>();

export interface CanvasExtensionHostOptions {
    config: Pick<CLIConfig, 'canvasExtensions'>;
    extension: DiscoveredCanvasExtension;
    processId: string;
    dataDir: string;
    log: (message: string) => void;
    /** Bound by the registry to this extension's owning conversation. */
    send: (prompt: string) => Promise<{ messageId: string }>;
    ephemeralQuery: (question: string) => Promise<{ answer: string }>;
    timeoutMs?: number;
}

export interface CanvasInstanceRequest {
    canvasId: string;
    instanceId: string;
    input?: Record<string, unknown>;
}

export interface CanvasExtensionOpenResult {
    title?: string;
    url?: string;
    status?: string;
}

/** Canvas runtime only. Provider clients and sessions are never involved. */
export class CanvasExtensionHost {
    private readonly child: ChildProcessWithoutNullStreams;
    private readonly connection: MessageConnection;
    private readonly exited: Promise<void>;
    private stopped = false;
    private stopPromise?: Promise<void>;
    private rejectReady!: (error: Error) => void;
    private resolveReady!: (declarations: CanvasDeclaration[]) => void;
    private readonly ready = new Promise<CanvasDeclaration[]>((resolve, reject) => {
        this.resolveReady = resolve;
        this.rejectReady = reject;
    });
    readonly declarations: CanvasDeclaration[] = [];

    static async start(options: CanvasExtensionHostOptions): Promise<CanvasExtensionHost> {
        if (!options.config.canvasExtensions?.enabled) throw new Error('Canvas extensions are disabled');
        const host = new CanvasExtensionHost(options);
        try {
            host.declarations.push(...await host.withDeadline(host.ready));
            return host;
        } catch (error) {
            await host.dispose();
            throw error;
        }
    }

    private constructor(private readonly options: CanvasExtensionHostOptions) {
        this.child = spawn(process.execPath, [
            '--import', pathToFileURL(path.join(__dirname, 'coc-sdk-resolver.mjs')).href,
            options.extension.extensionPath,
        ], {
            cwd: options.extension.cwd,
            env: {
                ...process.env,
                SESSION_ID: options.processId,
                COPILOT_HOME: path.join(options.dataDir, 'canvas-ext', 'home'),
                ...(process.versions.electron ? { ELECTRON_RUN_AS_NODE: '1' } : {}),
            },
            stdio: ['pipe', 'pipe', 'pipe'],
            windowsHide: true,
        });
        this.connection = createMessageConnection(
            new StreamMessageReader(this.child.stdout), new StreamMessageWriter(this.child.stdin),
        );
        this.exited = new Promise(resolve => {
            this.child.once('close', (code, signal) => {
                this.fail(new Error(`Canvas extension exited (${signal ?? code})`));
                resolve();
            });
        });
        this.child.once('error', error => {
            this.fail(error);
            void this.dispose();
        });
        this.child.stderr.setEncoding('utf8');
        this.child.stderr.on('data', (chunk: string) => this.log(chunk.trimEnd()));
        this.connection.onError(([error]) => {
            this.fail(error);
            void this.dispose();
        });
        this.connection.onClose(() => {
            this.fail(new Error('Canvas extension connection closed'));
            void this.dispose();
        });
        this.connection.onRequest((method, params) => this.handleRequest(method, params));
        this.connection.listen();
    }

    get running(): boolean { return !this.stopped; }

    open(request: CanvasInstanceRequest): Promise<CanvasExtensionOpenResult> {
        return this.request('canvas.open', request);
    }

    invoke(request: CanvasInstanceRequest & { actionName: string }): Promise<unknown> {
        return this.request('canvas.action.invoke', request);
    }

    close(request: Pick<CanvasInstanceRequest, 'canvasId' | 'instanceId'>): Promise<void> {
        return this.request('canvas.close', request);
    }

    dispose(): Promise<void> {
        if (this.stopPromise) return this.stopPromise;
        this.fail(new Error('Canvas extension stopped'));
        this.stopPromise = (async () => {
            if (this.child.exitCode !== null || this.child.signalCode !== null) return;
            this.child.kill();
            const timer = setTimeout(() => this.child.kill('SIGKILL'), 2000);
            try { await this.exited; } finally { clearTimeout(timer); }
        })();
        return this.stopPromise;
    }

    private request<T>(method: string, params: object): Promise<T> {
        if (this.stopped) return Promise.reject(new Error('Canvas extension is not running'));
        return this.withDeadline(this.connection.sendRequest<T>(method, {
            ...params,
            sessionId: this.options.processId,
            extensionId: this.options.extension.extensionKey,
            session: { workingDirectory: this.options.extension.cwd },
        }));
    }

    private async handleRequest(method: string, raw: unknown): Promise<unknown> {
        if (method === 'connect' || method === 'ping') {
            // This internal module is read from the exact installed SDK, keeping its pin authoritative.
            const sdkDirectory = path.dirname(bundledRequire.resolve('@github/copilot-sdk'));
            const { getSdkProtocolVersion } = bundledRequire(path.join(sdkDirectory, 'sdkProtocolVersion.js'));
            return { protocolVersion: getSdkProtocolVersion() };
        }
        const supported = ['session.resume', 'session.log', 'session.send', 'session.ui.ephemeralQuery'];
        if (!supported.includes(method)) {
            const key = `${this.options.extension.extensionKey}\0${method}`;
            if (!loggedUnknownMethods.has(key)) {
                loggedUnknownMethods.add(key);
                this.log(`Unsupported JSON-RPC method: ${method}`);
            }
            throw new ResponseError(ErrorCodes.MethodNotFound, `Method not found: ${method}`);
        }
        if (!raw || typeof raw !== 'object' || !('sessionId' in raw)
            || raw.sessionId !== this.options.processId) {
            throw new ResponseError(ErrorCodes.InvalidParams, 'Invalid canvas extension sessionId');
        }
        const params = raw as Record<string, unknown>;
        if (method === 'session.resume') {
            const canvases = params.canvases ?? [];
            if (!Array.isArray(canvases) || canvases.some(canvas => !canvas
                || typeof canvas.id !== 'string' || typeof canvas.displayName !== 'string'
                || typeof canvas.description !== 'string')) {
                throw new ResponseError(ErrorCodes.InvalidParams, 'Invalid canvas declarations');
            }
            this.resolveReady(canvases);
            return { sessionId: this.options.processId, capabilities: {} };
        }
        const field = method === 'session.log' ? 'message' : method === 'session.send' ? 'prompt' : 'question';
        if (typeof params[field] !== 'string') {
            throw new ResponseError(ErrorCodes.InvalidParams, `Expected ${field}`);
        }
        if (method === 'session.log') {
            this.log(params.message as string);
            return { eventId: randomUUID() };
        }
        if (method === 'session.send') return this.options.send(params.prompt as string);
        return this.options.ephemeralQuery(params.question as string);
    }

    private fail(error: Error): void {
        if (this.stopped) return;
        this.stopped = true;
        this.rejectReady(error);
        this.connection.dispose();
    }

    private async withDeadline<T>(promise: Promise<T>): Promise<T> {
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
            return await Promise.race([promise, new Promise<never>((_, reject) => {
                timer = setTimeout(() => {
                    reject(new Error('Canvas extension request timed out'));
                    void this.dispose();
                }, this.options.timeoutMs ?? 60_000);
            })]);
        } finally {
            clearTimeout(timer);
        }
    }

    private log(message: string): void {
        for (const line of message.split(/\r?\n/)) {
            this.options.log(`[canvas-extension ${this.options.extension.extensionKey}] ${line}`);
        }
    }
}
