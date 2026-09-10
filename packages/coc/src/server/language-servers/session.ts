/**
 * One language-server process session.
 *
 * A session owns a child process started from a definition's structured
 * command and argument vector, the LSP initialize/shutdown lifecycle, the
 * concise status a user sees, restart backoff after a crash, and disposal once
 * nothing has referenced it for a bounded idle interval.
 *
 * It knows nothing about TypeScript: everything language-specific arrives in
 * the definition. Transport work stays in `LanguageServerConnection`, so a
 * container relay can replace the process without touching this lifecycle.
 */

import { spawn } from 'child_process';
import type { ChildProcessWithoutNullStreams } from 'child_process';
import * as path from 'path';
import { pathToFileURL } from 'url';
import { LanguageServerClientRequests, DEFAULT_CLIENT_CAPABILITIES } from './client-requests';
import type { DynamicRegistration } from './client-requests';
import { LanguageServerConnection, LanguageServerRequestError } from './connection';
import type { ServerNotificationHandler, ServerRequestHandler, SendRequestOptions } from './connection';
import type { JsonValue, LanguageServerDefinition } from './types';

/**
 * Concise state shown next to the editor.
 *
 * `disabled` covers both "turned off in settings" and "not running because
 * nothing needs it"; either way the session is idle and starts on demand.
 */
export type LanguageServerStatus = 'disabled' | 'unavailable' | 'starting' | 'ready' | 'reconnecting' | 'failed';

export interface LanguageServerSessionState {
    status: LanguageServerStatus;
    definitionId: string;
    displayName: string;
    /** Short, user-facing explanation. Never contains environment values. */
    detail?: string;
    /** Reported by the server's `initialize` result, when it sends one. */
    serverName?: string;
    serverVersion?: string;
    /** Negotiated capabilities, available once the status is `ready`. */
    capabilities?: Record<string, unknown>;
    /** Capabilities the running server registered after initialization. */
    dynamicRegistrations?: DynamicRegistration[];
    /**
     * Which executable and toolchain this session resolved, e.g. the workspace
     * TypeScript versus the packaged one. Short text only, never a host path.
     */
    runtime?: string;
    /** Restarts already attempted since the last successful start. */
    restarts: number;
    /**
     * Counts successful handshakes. Every restart, crash recovery or config
     * replacement produces a server that knows no documents, so the browser
     * uses a change here as its cue to replay its open buffers. Zero means the
     * process has never completed a handshake.
     */
    generation: number;
}

export interface LanguageServerSessionOptions {
    definition: LanguageServerDefinition;
    /** Project root for the server, normally from `resolveServerRoot`. */
    rootPath: string;
    /**
     * Summary of the resolved runtime, surfaced in the state so a user can see
     * which toolchain answered. Must not contain host paths.
     */
    runtimeLabel?: string;
    /**
     * Name to use for the executable in user-facing text. An adapter resolves
     * `command` to an absolute host path, which must not reach the browser.
     */
    commandLabel?: string;
    /** Client capabilities sent in `initialize`. Defaults to `DEFAULT_CLIENT_CAPABILITIES`. */
    clientCapabilities?: JsonValue;
    /** Bound on the initialize handshake. Defaults to 20 seconds. */
    startTimeoutMs?: number;
    /** Per-request bound passed to the connection. Defaults to 30 seconds. */
    requestTimeoutMs?: number;
    maxMessageBytes?: number;
    /** Stop the process this long after the last reference detaches. Defaults to 5 minutes. */
    idleTimeoutMs?: number;
    /** Automatic restarts after a crash before the session gives up. Defaults to 3. */
    maxRestarts?: number;
    /** First backoff delay; each further attempt doubles it. Defaults to 1 second. */
    restartBackoffMs?: number;
    onStateChange?: (state: LanguageServerSessionState) => void;
    onError?: (error: Error) => void;
}

const DEFAULT_START_TIMEOUT_MS = 20_000;
const DEFAULT_IDLE_TIMEOUT_MS = 5 * 60_000;
const DEFAULT_MAX_RESTARTS = 3;
const DEFAULT_RESTART_BACKOFF_MS = 1_000;
const MAX_STDERR_CHARS = 4_000;

export class LanguageServerSession {
    private readonly options: LanguageServerSessionOptions;
    private readonly definition: LanguageServerDefinition;
    private readonly readyHandlers = new Set<(connection: LanguageServerConnection) => void>();
    private readonly stateHandlers = new Set<(state: LanguageServerSessionState) => void>();
    private readonly notificationHandlers = new Map<string, Set<ServerNotificationHandler>>();
    private readonly requestHandlers = new Map<string, ServerRequestHandler>();
    private readonly clientRequests: LanguageServerClientRequests;
    private child?: ChildProcessWithoutNullStreams;
    private connection?: LanguageServerConnection;
    private starting?: Promise<void>;
    private restartTimer?: NodeJS.Timeout;
    private idleTimer?: NodeJS.Timeout;
    private stderrTail = '';
    private references = 0;
    private restarts = 0;
    private generation = 0;
    private disposed = false;
    private state: LanguageServerSessionState;

    constructor(options: LanguageServerSessionOptions) {
        this.options = options;
        this.definition = options.definition;
        this.clientRequests = new LanguageServerClientRequests({
            settings: this.definition.settings,
            workspaceFolders: () => [this.workspaceFolder()],
            onRegistrationsChanged: (registrations) => this.setState({ dynamicRegistrations: registrations }),
        });
        this.state = {
            status: 'disabled',
            definitionId: this.definition.id,
            displayName: this.definition.displayName,
            restarts: 0,
            generation: 0,
            runtime: options.runtimeLabel,
        };
    }

    /** Current user-facing state. Safe to send to the browser. */
    getState(): LanguageServerSessionState {
        return { ...this.state };
    }

    /** Capabilities the running server registered dynamically. */
    getDynamicRegistrations(): DynamicRegistration[] {
        return this.clientRequests.getRegistrations();
    }

    get status(): LanguageServerStatus {
        return this.state.status;
    }

    get isDisposed(): boolean {
        return this.disposed;
    }

    /** True while a process is running and has completed initialize. */
    get isReady(): boolean {
        return this.state.status === 'ready' && this.connection !== undefined;
    }

    /**
     * Registers interest in this session and returns the release function.
     *
     * The process stops after the last reference releases and the idle
     * interval elapses, so an open document keeps its server alive and a
     * closed one does not.
     */
    attach(): () => void {
        this.references++;
        this.clearIdleTimer();
        let released = false;
        return () => {
            if (released) {
                return;
            }
            released = true;
            this.references = Math.max(0, this.references - 1);
            if (this.references === 0) {
                this.scheduleIdleStop();
            }
        };
    }

    get referenceCount(): number {
        return this.references;
    }

    /**
     * Starts the process and completes the handshake. Concurrent callers share
     * one attempt; an already-ready session resolves immediately.
     */
    start(): Promise<void> {
        if (this.disposed) {
            return Promise.reject(new Error(`Language server ${this.definition.id} is disposed`));
        }
        if (this.definition.enabled === false) {
            this.setState({ status: 'disabled', detail: 'Disabled in workspace settings' });
            return Promise.reject(new Error(`Language server ${this.definition.id} is disabled`));
        }
        if (this.isReady) {
            return Promise.resolve();
        }
        if (!this.starting) {
            this.starting = this.launch().finally(() => {
                this.starting = undefined;
            });
        }
        return this.starting;
    }

    /**
     * Sends a request, starting the server first when it is not running.
     * Callers never have to sequence startup themselves.
     */
    async sendRequest<T = unknown>(method: string, params?: unknown, options?: SendRequestOptions): Promise<T> {
        await this.start();
        const connection = this.connection;
        if (!connection) {
            throw new LanguageServerRequestError('closed', method, `Language server ${this.definition.id} is not running`);
        }
        return connection.sendRequest<T>(method, params, options);
    }

    /** Sends a notification to a running server. Returns false when it is not running. */
    sendNotification(method: string, params?: unknown): boolean {
        return this.connection?.sendNotification(method, params) ?? false;
    }

    /**
     * Subscribes to a server notification across restarts, so a caller
     * registers once and keeps receiving diagnostics after a reconnect.
     */
    onNotification(method: string, handler: ServerNotificationHandler): () => void {
        let handlers = this.notificationHandlers.get(method);
        if (!handlers) {
            handlers = new Set();
            this.notificationHandlers.set(method, handlers);
        }
        handlers.add(handler);
        this.connection?.onNotification(method, handler);
        return () => {
            this.notificationHandlers.get(method)?.delete(handler);
        };
    }

    /** Registers a server-to-client request handler across restarts. */
    onRequest(method: string, handler: ServerRequestHandler): () => void {
        this.requestHandlers.set(method, handler);
        this.connection?.onRequest(method, handler);
        return () => {
            if (this.requestHandlers.get(method) === handler) {
                this.requestHandlers.delete(method);
            }
        };
    }

    /**
     * Every transition of the user-facing state, in order. This is what a
     * status display subscribes to: `starting`, `reconnecting`, `failed` and
     * `disabled` are otherwise invisible to anything outside this class,
     * because only `ready` has a handler of its own.
     *
     * The `ready` transition fires here before {@link onReady} does, and the
     * connection is already live at that point, so a listener may send on it.
     */
    onStateChange(handler: (state: LanguageServerSessionState) => void): () => void {
        this.stateHandlers.add(handler);
        return () => {
            this.stateHandlers.delete(handler);
        };
    }

    /**
     * Runs after every successful handshake, including reconnects. The
     * document layer replays its open buffers here before sending queries.
     */
    onReady(handler: (connection: LanguageServerConnection) => void): () => void {
        this.readyHandlers.add(handler);
        return () => {
            this.readyHandlers.delete(handler);
        };
    }

    /**
     * User-initiated restart. Clears the backoff budget so a session that gave
     * up can be revived without restarting CoC.
     */
    async restart(): Promise<void> {
        this.clearRestartTimer();
        this.restarts = 0;
        await this.stop();
        if (this.disposed) {
            return;
        }
        await this.start();
    }

    /** Stops the process, keeping the session reusable. */
    async stop(detail?: string): Promise<void> {
        this.clearRestartTimer();
        this.clearIdleTimer();
        const connection = this.connection;
        const child = this.child;
        this.connection = undefined;
        this.child = undefined;
        if (connection) {
            try {
                await connection.sendRequest('shutdown', null, { timeoutMs: 2_000 });
                connection.sendNotification('exit');
            } catch {
                // A server that will not shut down cleanly is killed below.
            }
            connection.dispose('Language server stopped');
        }
        if (child) {
            child.kill();
        }
        this.clientRequests.reset();
        this.setState({ status: 'disabled', detail, capabilities: undefined, dynamicRegistrations: [] });
    }

    /** Releases the process and every listener. The session cannot be restarted. */
    async dispose(): Promise<void> {
        if (this.disposed) {
            return;
        }
        this.disposed = true;
        await this.stop('Session disposed');
        this.readyHandlers.clear();
        this.stateHandlers.clear();
        this.notificationHandlers.clear();
        this.requestHandlers.clear();
    }

    private async launch(): Promise<void> {
        this.setState({ status: this.restarts > 0 ? 'reconnecting' : 'starting', detail: undefined });
        this.stderrTail = '';
        let child: ChildProcessWithoutNullStreams;
        try {
            child = spawn(this.definition.command, this.definition.args, {
                cwd: this.options.rootPath,
                stdio: ['pipe', 'pipe', 'pipe'],
                // Never a shell: the command and arguments stay a structured
                // vector, so nothing in a repository can be executed as script.
                shell: false,
                windowsHide: true,
            });
        } catch (error) {
            this.failUnavailable(error);
            throw error;
        }
        this.child = child;
        child.stderr.setEncoding('utf8');
        child.stderr.on('data', (chunk: string) => this.appendStderr(chunk));
        // Both handlers are bound to this specific process: a restart leaves
        // the previous child's late `exit` in flight, and it must not tear
        // down the connection its successor already owns.
        child.on('error', (error: NodeJS.ErrnoException) => this.handleProcessError(child, error));
        child.on('exit', (code, signal) => this.handleProcessExit(child, code, signal));

        const connection = new LanguageServerConnection({
            input: child.stdout,
            output: child.stdin,
            requestTimeoutMs: this.options.requestTimeoutMs,
            maxMessageBytes: this.options.maxMessageBytes,
            onError: (error) => this.report(error),
        });
        // Built-in answers go on first; a caller's own handler for the same
        // method is installed after and wins.
        this.clientRequests.reset();
        for (const [method, handler] of this.clientRequests.handlers()) {
            connection.onRequest(method, handler);
        }
        for (const [method, handler] of this.requestHandlers) {
            connection.onRequest(method, handler);
        }
        for (const [method, handlers] of this.notificationHandlers) {
            for (const handler of handlers) {
                connection.onNotification(method, handler);
            }
        }
        this.connection = connection;

        try {
            const result = await connection.sendRequest<InitializeResult>('initialize', this.initializeParams(), {
                timeoutMs: this.options.startTimeoutMs ?? DEFAULT_START_TIMEOUT_MS,
            });
            connection.sendNotification('initialized', {});
            if (this.definition.settings !== undefined) {
                connection.sendNotification('workspace/didChangeConfiguration', { settings: this.definition.settings });
            }
            this.restarts = 0;
            this.generation += 1;
            this.setState({
                status: 'ready',
                detail: undefined,
                capabilities: result?.capabilities ?? {},
                dynamicRegistrations: this.clientRequests.getRegistrations(),
                serverName: result?.serverInfo?.name,
                serverVersion: result?.serverInfo?.version,
                restarts: 0,
                generation: this.generation,
            });
            for (const handler of [...this.readyHandlers]) {
                try {
                    handler(connection);
                } catch (error) {
                    this.report(toError(error));
                }
            }
        } catch (error) {
            connection.dispose('Handshake failed');
            this.connection = undefined;
            this.child = undefined;
            child.removeAllListeners('exit');
            child.kill();
            // A spawn `error` event already classified this as `unavailable`;
            // the handshake rejection it caused must not overwrite that.
            if (this.state.status !== 'unavailable') {
                this.setState({ status: 'failed', detail: this.describeFailure('Handshake failed', error) });
            }
            throw toError(error);
        }
    }

    private initializeParams(): Record<string, unknown> {
        const folder = this.workspaceFolder();
        return {
            processId: process.pid,
            clientInfo: { name: 'CoC' },
            rootUri: folder.uri,
            workspaceFolders: [folder],
            capabilities: this.options.clientCapabilities ?? DEFAULT_CLIENT_CAPABILITIES,
            initializationOptions: this.definition.initializationOptions,
        };
    }

    private workspaceFolder(): { uri: string; name: string } {
        const rootPath = path.resolve(this.options.rootPath);
        return { uri: pathToFileURL(rootPath).href, name: path.basename(rootPath) };
    }

    private handleProcessError(child: ChildProcessWithoutNullStreams, error: NodeJS.ErrnoException): void {
        this.report(error);
        if (this.child !== child) {
            return;
        }
        this.failUnavailable(error);
    }

    private handleProcessExit(
        child: ChildProcessWithoutNullStreams,
        code: number | null,
        signal: NodeJS.Signals | null,
    ): void {
        if (this.disposed || this.child !== child) {
            return;
        }
        this.child = undefined;
        this.connection?.dispose('Language server exited');
        this.connection = undefined;
        const how = signal ? `signal ${signal}` : `exit code ${code}`;
        this.clientRequests.reset();
        if (this.references === 0) {
            this.setState({
                status: 'disabled',
                detail: `Language server stopped (${how})`,
                capabilities: undefined,
                dynamicRegistrations: [],
            });
            return;
        }
        this.scheduleRestart(how);
    }

    /**
     * A crash while something still holds the session is retried with doubling
     * backoff; exhausting the budget leaves a `failed` state the user can retry.
     */
    private scheduleRestart(how: string): void {
        const maxRestarts = this.options.maxRestarts ?? DEFAULT_MAX_RESTARTS;
        if (this.restarts >= maxRestarts) {
            this.setState({
                status: 'failed',
                detail: this.describeFailure(`Language server exited (${how}) and did not recover`),
                capabilities: undefined,
            dynamicRegistrations: [],
            });
            return;
        }
        const base = this.options.restartBackoffMs ?? DEFAULT_RESTART_BACKOFF_MS;
        const delay = base * 2 ** this.restarts;
        this.restarts++;
        this.setState({
            status: 'reconnecting',
            detail: `Language server exited (${how}); restarting`,
            capabilities: undefined,
            dynamicRegistrations: [],
            restarts: this.restarts,
        });
        this.clearRestartTimer();
        this.restartTimer = setTimeout(() => {
            this.restartTimer = undefined;
            if (this.disposed || this.references === 0) {
                return;
            }
            this.start().catch((error: unknown) => this.report(toError(error)));
        }, delay);
        this.restartTimer.unref?.();
    }

    private scheduleIdleStop(): void {
        this.clearIdleTimer();
        const idleTimeoutMs = this.options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
        this.idleTimer = setTimeout(() => {
            this.idleTimer = undefined;
            if (this.disposed || this.references > 0) {
                return;
            }
            void this.stop('Stopped after idle timeout').catch((error: unknown) => this.report(toError(error)));
        }, idleTimeoutMs);
        this.idleTimer.unref?.();
    }

    private clearIdleTimer(): void {
        if (this.idleTimer) {
            clearTimeout(this.idleTimer);
            this.idleTimer = undefined;
        }
    }

    private clearRestartTimer(): void {
        if (this.restartTimer) {
            clearTimeout(this.restartTimer);
            this.restartTimer = undefined;
        }
    }

    /** A missing or unrunnable executable is configuration, not a crash. */
    private failUnavailable(error: unknown): void {
        this.child = undefined;
        this.connection?.dispose('Language server could not start');
        this.connection = undefined;
        this.clientRequests.reset();
        const code = (error as NodeJS.ErrnoException | undefined)?.code;
        const missing = code === 'ENOENT';
        this.setState({
            status: missing ? 'unavailable' : 'failed',
            detail: missing
                ? `Executable not found: ${this.options.commandLabel ?? this.definition.command}`
                : this.describeFailure('Language server could not start', error),
            capabilities: undefined,
            dynamicRegistrations: [],
        });
    }

    private describeFailure(prefix: string, error?: unknown): string {
        const parts = [prefix];
        if (error) {
            parts.push(toError(error).message);
        }
        const stderr = this.stderrTail.trim();
        if (stderr) {
            parts.push(stderr.split('\n').slice(-3).join(' '));
        }
        return parts.join(': ');
    }

    /** Keeps a bounded tail of stderr for failure messages, never the whole log. */
    private appendStderr(chunk: string): void {
        this.stderrTail = (this.stderrTail + chunk).slice(-MAX_STDERR_CHARS);
    }

    private setState(patch: Partial<LanguageServerSessionState>): void {
        this.state = { ...this.state, ...patch };
        const state = this.getState();
        this.options.onStateChange?.(state);
        for (const handler of [...this.stateHandlers]) {
            try {
                handler(state);
            } catch (error) {
                this.report(toError(error));
            }
        }
    }

    private report(error: Error): void {
        this.options.onError?.(error);
    }
}

interface InitializeResult {
    capabilities?: Record<string, unknown>;
    serverInfo?: { name?: string; version?: string };
}

function toError(error: unknown): Error {
    return error instanceof Error ? error : new Error(String(error));
}
