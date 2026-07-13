/**
 * CoC Desktop — DevTunnel host lifecycle (AC-03).
 *
 * Ports the host lifecycle of `scripts/coc-serve-loop.ps1` (`Start-DevTunnel`,
 * `Select-DevTunnelUrl`, `Stop-DevTunnel`/`Stop-ProcessTree`) into an
 * Electron-free TypeScript module so Vitest can drive the state machine under
 * plain Node. Once the active CoC server is healthy and the HTTP binding is
 * reconciled (AC-02), the {@link DevTunnelHostManager}:
 *
 *   1. Starts exactly one managed `devtunnel host <id>` child — asynchronously,
 *      so it never delays or replaces the local SPA.
 *   2. Captures stdout/stderr and waits up to `COC_DEVTUNNEL_URL_TIMEOUT` seconds
 *      (default 30s) for the public `*.devtunnels.ms` URL that maps to the
 *      configured HTTP port, then goes Online and exposes the URL.
 *   3. Serializes Start / Stop / Retry / reconnect transitions so a second host
 *      child can never exist.
 *   4. On an unexpected exit while enabled, reconnects with exponential backoff
 *      starting at 2s and capped at 30s, resetting the backoff after a successful
 *      Online transition. Retry cancels a pending backoff and attempts now. Stop
 *      and app quit cancel timers and terminate/reap the whole tunnel process
 *      tree.
 *
 * The manager only ever owns the `devtunnel host` child — it holds no reference
 * to the CoC server handle, so stopping the tunnel or quitting Desktop can never
 * terminate an attached CoC server. This module imports nothing from `electron`.
 */

import { spawn, ChildProcess } from 'child_process';
import {
    DevTunnelConfigureResult,
    DevTunnelErrorCategory,
    defaultDevTunnelMessage,
    ensureDevTunnelHttpBinding,
    resolveDevTunnelCliPath,
} from './devtunnel-cli';

/** Default readiness timeout (seconds) matching `coc-serve-loop.ps1`. */
export const DEVTUNNEL_URL_TIMEOUT_DEFAULT_SEC = 30;
/** Exponential-backoff floor for reconnects (2s), per AC-03. */
export const DEVTUNNEL_BACKOFF_BASE_MS = 2_000;
/** Exponential-backoff ceiling for reconnects (30s), per AC-03. */
export const DEVTUNNEL_BACKOFF_CAP_MS = 30_000;
/** Cap on captured host output kept in memory / surfaced as bounded detail. */
const MAX_OUTPUT_CHARS = 64 * 1024;
/** Cap on user-facing / persisted detail so nothing unbounded leaks (AC-04). */
const MAX_DETAIL_CHARS = 2_000;

/** The four externally observable tunnel states (mirrors the AC-01 menu row). */
export type DevTunnelHostStatus = 'off' | 'starting' | 'online' | 'failed';

/** A normalized, secret-free failure surfaced to the menu / notification (AC-04). */
export interface DevTunnelHostErrorInfo {
    category: DevTunnelErrorCategory;
    message: string;
    /** Bounded diagnostic text (never credentials/tokens/unbounded output). */
    detail?: string;
}

/** The immutable snapshot the caller renders in the Dev Tunnel menu. */
export interface DevTunnelHostState {
    status: DevTunnelHostStatus;
    /** Present only when `status === 'online'`. */
    publicUrl?: string;
    /** Present only when `status === 'failed'`. */
    error?: DevTunnelHostErrorInfo;
}

/**
 * Resolve the URL-readiness timeout in milliseconds. Reuses
 * `COC_DEVTUNNEL_URL_TIMEOUT` as a positive-integer seconds override (matching
 * the serve-loop), falling back to 30s for anything missing or malformed.
 */
export function resolveUrlTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
    const raw = env.COC_DEVTUNNEL_URL_TIMEOUT?.trim();
    if (raw && /^[1-9][0-9]*$/.test(raw)) {
        return Number(raw) * 1_000;
    }
    return DEVTUNNEL_URL_TIMEOUT_DEFAULT_SEC * 1_000;
}

/**
 * The backoff delay (ms) for reconnect attempt `index` (0-based): 2s, 4s, 8s,
 * 16s, then capped at 30s. Ported from AC-03's "starting at 2 seconds and capped
 * at 30 seconds" rule.
 */
export function computeBackoffMs(index: number): number {
    const safe = Number.isFinite(index) && index > 0 ? Math.floor(index) : 0;
    const raw = DEVTUNNEL_BACKOFF_BASE_MS * 2 ** safe;
    return Math.min(raw, DEVTUNNEL_BACKOFF_CAP_MS);
}

/**
 * True when `url`'s port (or a host label like `…-4000-…`) matches `port`.
 * Ports `Test-DevTunnelUrlMatchesPort` from `coc-serve-loop.ps1`.
 */
export function devTunnelUrlMatchesPort(url: string, port: number): boolean {
    let parsed: URL;
    try {
        parsed = new URL(url);
    } catch {
        return false;
    }
    if (parsed.port && Number(parsed.port) === port) {
        return true;
    }
    // devtunnel encodes the port into the host label, e.g. `myid-4000.devtunnels.ms`.
    return new RegExp(`(^|[-.])${port}([-.]|$)`).test(parsed.hostname);
}

/**
 * Extract the public tunnel URL for `port` from captured host output. Prefers a
 * `*.devtunnels.ms` URL whose port/label matches the active CoC port, falling
 * back to the first such URL. Returns `undefined` when none is present yet.
 * Ports `Select-DevTunnelUrl` from `coc-serve-loop.ps1`.
 */
export function selectDevTunnelUrl(text: string, port: number): string | undefined {
    if (!text) {
        return undefined;
    }
    const matches = text.match(/https:\/\/[^\s,]+devtunnels\.ms[^\s,]*/g);
    if (!matches || matches.length === 0) {
        return undefined;
    }
    const urls = matches.map((raw) => raw.replace(/[.;)\]]+$/, ''));
    return urls.find((candidate) => devTunnelUrlMatchesPort(candidate, port)) ?? urls[0];
}

function boundedDetail(text: string): string | undefined {
    const trimmed = (text ?? '').trim();
    if (!trimmed) {
        return undefined;
    }
    return trimmed.length > MAX_DETAIL_CHARS ? `${trimmed.slice(0, MAX_DETAIL_CHARS)}…` : trimmed;
}

/**
 * A spawned `devtunnel host` process, abstracted so tests can drive it without a
 * real CLI. The default ({@link defaultDevTunnelHostSpawner}) wraps
 * `child_process.spawn`; tests inject a fake they can emit output/exit on.
 */
export interface DevTunnelHostProcess {
    /** OS pid (for tree-kill); `undefined` when the spawn produced no process. */
    readonly pid: number | undefined;
    /** Register a listener for merged stdout+stderr text chunks. */
    onOutput(listener: (chunk: string) => void): void;
    /** Register the (fire-once) exit listener. */
    onExit(listener: (code: number | null, signal: string | null) => void): void;
    /** Best-effort terminate the process and its whole tree. */
    kill(): void;
}

/** Spawns a managed `devtunnel host <id>` child. */
export type DevTunnelHostSpawner = (cliPath: string, tunnelId: string) => DevTunnelHostProcess;

/**
 * Kill a child and its whole process tree. On Windows the only supported host
 * platform this shells `taskkill /T /F` (the equivalent of `Stop-ProcessTree`'s
 * CIM walk); elsewhere it falls back to `SIGKILL` so tests off Windows still reap
 * the fake.
 */
export function killProcessTree(
    target: { pid?: number; kill: (signal?: NodeJS.Signals) => void },
    deps: { platform?: NodeJS.Platform; spawn?: typeof spawn } = {},
): void {
    const platform = deps.platform ?? process.platform;
    if (platform === 'win32' && target.pid) {
        const spawnFn = deps.spawn ?? spawn;
        try {
            const killer = spawnFn('taskkill', ['/pid', String(target.pid), '/T', '/F'], { windowsHide: true });
            killer.on?.('error', () => { /* best-effort */ });
        } catch {
            /* best-effort */
        }
        return;
    }
    try {
        target.kill('SIGKILL');
    } catch {
        /* best-effort */
    }
}

/** Default spawner: `devtunnel host <id>` with merged output and tree-kill. */
export function defaultDevTunnelHostSpawner(cliPath: string, tunnelId: string): DevTunnelHostProcess {
    const child: ChildProcess = spawn(cliPath, ['host', tunnelId], {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    return {
        get pid() {
            return child.pid;
        },
        onOutput(listener) {
            child.stdout?.on('data', (d: Buffer) => listener(d.toString()));
            child.stderr?.on('data', (d: Buffer) => listener(d.toString()));
        },
        onExit(listener) {
            child.once('exit', (code, signal) => listener(code, signal));
        },
        kill() {
            killProcessTree(child);
        },
    };
}

/** The reason an attempt was initiated — governs notification vs. modal UX (AC-04). */
type AttemptTrigger = 'manual' | 'launch' | 'reconnect';

/** Injectable seams for {@link DevTunnelHostManager}. */
export interface DevTunnelHostManagerDeps {
    /** AC-02 gate: reconcile the HTTP binding and return `{ ok, port }`. */
    ensureBinding?: (opts: { tunnelId: string; port: number }) => Promise<DevTunnelConfigureResult>;
    /** Resolve the `devtunnel` executable used to host. */
    resolveCliPath?: () => string | undefined;
    /** Spawn the managed `devtunnel host` child. */
    spawn?: DevTunnelHostSpawner;
    /** Fired on every observable state transition (menu/status wiring). */
    onStateChange?: (state: DevTunnelHostState) => void;
    /** Fired once per auto-failure episode (single Windows notification, AC-04). */
    onFailureNotification?: (error: DevTunnelHostErrorInfo) => void;
    /** Override the URL-readiness timeout (else `resolveUrlTimeoutMs(env)`). */
    urlTimeoutMs?: number;
    env?: NodeJS.ProcessEnv;
    setTimer?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
    clearTimer?: (timer: ReturnType<typeof setTimeout>) => void;
    /** Bounded diagnostic sink (defaults to the desktop process stderr). */
    log?: (message: string) => void;
}

type Timer = ReturnType<typeof setTimeout>;

function statesEqual(a: DevTunnelHostState, b: DevTunnelHostState): boolean {
    return (
        a.status === b.status &&
        a.publicUrl === b.publicUrl &&
        a.error?.category === b.error?.category &&
        a.error?.message === b.error?.message &&
        a.error?.detail === b.error?.detail
    );
}

/**
 * Owns the single managed `devtunnel host` child and its state machine. All
 * transitions funnel through the `_phase` guard so a duplicate host process can
 * never exist; the manager never references the CoC server, so stopping/quitting
 * cannot terminate an attached server.
 */
export class DevTunnelHostManager {
    private readonly _ensureBinding: NonNullable<DevTunnelHostManagerDeps['ensureBinding']>;
    private readonly _resolveCliPath: () => string | undefined;
    private readonly _spawn: DevTunnelHostSpawner;
    private readonly _onStateChange?: (state: DevTunnelHostState) => void;
    private readonly _onFailureNotification?: (error: DevTunnelHostErrorInfo) => void;
    private readonly _urlTimeoutMs: number;
    private readonly _setTimer: (fn: () => void, ms: number) => Timer;
    private readonly _clearTimer: (timer: Timer) => void;
    private readonly _log: (message: string) => void;

    /** Whether we intend a host to be running. Stop/quit set this to `stopped`. */
    private _desired: 'running' | 'stopped' = 'stopped';
    private _phase: 'idle' | 'starting' | 'awaiting-url' | 'online' = 'idle';
    private _state: DevTunnelHostState = { status: 'off' };
    private _tunnelId = '';
    private _port = 0;

    private _child: DevTunnelHostProcess | undefined;
    private _outputBuffer = '';
    private _attemptTrigger: AttemptTrigger = 'manual';
    private _attemptPort = 0;
    private _urlTimer: Timer | undefined;
    private _backoffTimer: Timer | undefined;
    private _settleResolve: ((state: DevTunnelHostState) => void) | undefined;

    /** True while inside an auto-reconnect episode (post-online unexpected exit). */
    private _episodeActive = false;
    private _reconnectAttempts = 0;

    constructor(deps: DevTunnelHostManagerDeps = {}) {
        this._ensureBinding = deps.ensureBinding ?? ((opts) => ensureDevTunnelHttpBinding(opts));
        this._resolveCliPath = deps.resolveCliPath ?? (() => resolveDevTunnelCliPath());
        this._spawn = deps.spawn ?? defaultDevTunnelHostSpawner;
        this._onStateChange = deps.onStateChange;
        this._onFailureNotification = deps.onFailureNotification;
        this._urlTimeoutMs = deps.urlTimeoutMs ?? resolveUrlTimeoutMs(deps.env);
        this._setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
        this._clearTimer = deps.clearTimer ?? ((t) => clearTimeout(t));
        this._log = deps.log ?? ((message) => process.stderr.write(`${message}\n`));
    }

    /** The current observable state (menu renders from this). */
    get state(): DevTunnelHostState {
        return { ...this._state, error: this._state.error ? { ...this._state.error } : undefined };
    }

    /**
     * Start (or replace) the managed tunnel for `tunnelId` on the active CoC
     * `port`. `trigger: 'launch'` marks an app-initiated auto-start (failure →
     * one notification); the default `'manual'` marks a user Start (failure → the
     * caller shows a modal from the returned state). A fresh Start ends any prior
     * reconnect episode and resets the backoff.
     */
    async start(
        params: { tunnelId: string; port: number },
        opts: { trigger?: 'manual' | 'launch' } = {},
    ): Promise<DevTunnelHostState> {
        this._tunnelId = params.tunnelId;
        this._port = params.port;
        this._desired = 'running';
        this._endEpisode();
        this._clearBackoffTimer();
        return this._beginAttempt(opts.trigger ?? 'manual');
    }

    /**
     * Retry now: cancel any pending backoff and attempt immediately. Does not
     * change the enabled state. If a reconnect episode is active the escalating
     * backoff resumes on the next failure; otherwise it behaves as a manual retry.
     */
    async retry(): Promise<DevTunnelHostState> {
        this._clearBackoffTimer();
        this._desired = 'running';
        return this._beginAttempt('manual');
    }

    /**
     * Saving a different tunnel ID while enabled stops the old host and starts the
     * newly configured tunnel (AC-01). When disabled it just records the new id.
     */
    async reconfigure(params: { tunnelId: string; port?: number }): Promise<DevTunnelHostState> {
        const wasRunning = this._desired === 'running';
        this._teardownChild();
        this._clearBackoffTimer();
        this._endEpisode();
        this._reconnectAttempts = 0;
        this._tunnelId = params.tunnelId;
        if (params.port !== undefined) {
            this._port = params.port;
        }
        // Release any caller awaiting the torn-down attempt before starting fresh.
        this._resolveSettle();
        if (wasRunning) {
            return this._beginAttempt('manual');
        }
        this._emitOff();
        return this.state;
    }

    /**
     * Stop the managed tunnel and persist the intent to stay off: cancel timers,
     * end any reconnect episode, and terminate/reap the whole host process tree.
     * The CoC server is never touched (the manager holds no server reference).
     */
    async stop(): Promise<DevTunnelHostState> {
        this._desired = 'stopped';
        this._endEpisode();
        this._clearBackoffTimer();
        this._teardownChild();
        this._reconnectAttempts = 0;
        this._emitOff();
        this._resolveSettle();
        return this.state;
    }

    /**
     * Quit cleanup: identical teardown to {@link stop} but the caller does not
     * persist `enabled: false`, so the next launch can auto-start. Cancels timers
     * and reaps the host process tree; never touches the CoC server.
     */
    dispose(): void {
        this._desired = 'stopped';
        this._endEpisode();
        this._clearBackoffTimer();
        this._teardownChild();
        this._reconnectAttempts = 0;
        this._phase = 'idle';
        this._resolveSettle();
    }

    // ── Internal state machine ──────────────────────────────────────────────

    private _beginAttempt(trigger: AttemptTrigger): Promise<DevTunnelHostState> {
        // Duplicate-start prevention: only ever one attempt / host child in flight.
        if (this._phase !== 'idle') {
            return Promise.resolve(this.state);
        }
        return this._attempt(trigger);
    }

    private async _attempt(trigger: AttemptTrigger): Promise<DevTunnelHostState> {
        this._phase = 'starting';
        this._attemptTrigger = trigger;
        this._emitStarting();

        // 1) Reconcile the HTTP binding (AC-02). A failed/ambiguous binding never
        //    starts `devtunnel host`.
        const binding = await this._ensureBinding({ tunnelId: this._tunnelId, port: this._port });
        if (this._desired === 'stopped') {
            return this._abortToOff();
        }
        if (!binding.ok) {
            return this._failAttempt({ category: binding.category, message: binding.message, detail: binding.detail });
        }

        // 2) Resolve the CLI used to host (folds into cli-missing if it vanished).
        //    Synchronous, so the stop check after the binding await still holds.
        const cliPath = this._resolveCliPath();
        if (!cliPath) {
            return this._failAttempt({ category: 'cli-missing', message: defaultDevTunnelMessage('cli-missing') });
        }

        // 3) Spawn exactly one managed host child.
        let child: DevTunnelHostProcess;
        try {
            child = this._spawn(cliPath, this._tunnelId);
        } catch (err) {
            return this._failAttempt({
                category: 'unexpected-exit',
                message: defaultDevTunnelMessage('unexpected-exit'),
                detail: boundedDetail(String((err as Error)?.message ?? err)),
            });
        }

        this._child = child;
        this._attemptPort = binding.port;
        this._outputBuffer = '';
        this._phase = 'awaiting-url';
        const settled = new Promise<DevTunnelHostState>((resolve) => {
            this._settleResolve = resolve;
        });
        child.onOutput((chunk) => this._onOutput(child, chunk));
        child.onExit((code, signal) => this._onExit(child, code, signal));
        // 4) Bounded wait for the public URL, then Online.
        this._urlTimer = this._setTimer(() => this._onUrlTimeout(child), this._urlTimeoutMs);
        return settled;
    }

    private _onOutput(child: DevTunnelHostProcess, chunk: string): void {
        if (child !== this._child) {
            return;
        }
        this._outputBuffer = (this._outputBuffer + chunk).slice(-MAX_OUTPUT_CHARS);
        if (this._phase !== 'awaiting-url') {
            return;
        }
        const url = selectDevTunnelUrl(this._outputBuffer, this._attemptPort);
        if (url) {
            this._onUrlReady(url);
        }
    }

    private _onUrlReady(url: string): void {
        this._clearUrlTimer();
        this._phase = 'online';
        this._reconnectAttempts = 0;
        this._endEpisode();
        this._emit({ status: 'online', publicUrl: url });
        this._resolveSettle();
    }

    private _onUrlTimeout(child: DevTunnelHostProcess): void {
        if (child !== this._child || this._phase !== 'awaiting-url') {
            return;
        }
        this._clearUrlTimer();
        const detail = boundedDetail(this._outputBuffer);
        // Kill the unproductive host child; detaching first makes its exit stale.
        this._teardownChild();
        this._failAttempt({ category: 'url-timeout', message: defaultDevTunnelMessage('url-timeout'), detail });
    }

    private _onExit(child: DevTunnelHostProcess, code: number | null, signal: string | null): void {
        if (child !== this._child) {
            // Stale exit from a child we already detached/killed.
            return;
        }
        this._child = undefined;
        this._clearUrlTimer();

        if (this._desired === 'stopped') {
            // Expected stop/quit — status was already set to off.
            this._phase = 'idle';
            return;
        }

        const detail = boundedDetail(this._outputBuffer || `exit code=${code ?? 'null'} signal=${signal ?? 'null'}`);
        if (this._phase === 'awaiting-url') {
            // Died before publishing a URL → this attempt failed.
            this._phase = 'idle';
            this._failAttempt({ category: 'unexpected-exit', message: defaultDevTunnelMessage('unexpected-exit'), detail });
            return;
        }
        if (this._phase === 'online') {
            // Established, then died → begin/continue the auto-reconnect episode.
            this._phase = 'idle';
            this._beginEpisodeReconnect({ category: 'unexpected-exit', message: defaultDevTunnelMessage('unexpected-exit'), detail });
            return;
        }
        this._phase = 'idle';
    }

    /** Settle a failed attempt, then decide notification vs. escalation. */
    private _failAttempt(error: DevTunnelHostErrorInfo): DevTunnelHostState {
        this._phase = 'idle';
        this._emit({ status: 'failed', error });
        const result = this.state;
        if (this._episodeActive) {
            // Within an ongoing auto-reconnect episode → keep escalating quietly.
            this._scheduleReconnect();
        } else if (this._attemptTrigger !== 'manual') {
            // App-initiated (launch) one-shot failure → a single notification.
            this._fireFailureNotification(error);
        }
        // Manual one-shot failure → caller inspects the returned state (modal).
        this._resolveSettle();
        return result;
    }

    /** A post-online unexpected exit opens (or continues) the reconnect episode. */
    private _beginEpisodeReconnect(error: DevTunnelHostErrorInfo): void {
        this._emit({ status: 'failed', error });
        if (!this._episodeActive) {
            this._episodeActive = true;
            this._reconnectAttempts = 0;
            this._fireFailureNotification(error);
        }
        this._scheduleReconnect();
    }

    /** Read the current run intent without control-flow narrowing (it mutates). */
    private _wantsRunning(): boolean {
        return this._desired === 'running';
    }

    private _scheduleReconnect(): void {
        if (!this._wantsRunning() || this._backoffTimer) {
            return;
        }
        const delay = computeBackoffMs(this._reconnectAttempts);
        this._reconnectAttempts += 1;
        this._backoffTimer = this._setTimer(() => {
            this._backoffTimer = undefined;
            if (!this._wantsRunning()) {
                return;
            }
            void this._beginAttempt('reconnect');
        }, delay);
    }

    private _fireFailureNotification(error: DevTunnelHostErrorInfo): void {
        try {
            this._onFailureNotification?.(error);
        } catch (err) {
            this._log(`[devtunnel] failure-notification handler threw: ${(err as Error)?.message ?? err}`);
        }
    }

    private _abortToOff(): DevTunnelHostState {
        this._teardownChild();
        this._emitOff();
        this._resolveSettle();
        return this.state;
    }

    private _teardownChild(): void {
        this._clearUrlTimer();
        const child = this._child;
        this._child = undefined;
        this._phase = 'idle';
        if (child) {
            try {
                child.kill();
            } catch {
                /* best-effort */
            }
        }
    }

    private _endEpisode(): void {
        this._episodeActive = false;
    }

    private _clearUrlTimer(): void {
        if (this._urlTimer) {
            this._clearTimer(this._urlTimer);
            this._urlTimer = undefined;
        }
    }

    private _clearBackoffTimer(): void {
        if (this._backoffTimer) {
            this._clearTimer(this._backoffTimer);
            this._backoffTimer = undefined;
        }
    }

    private _resolveSettle(): void {
        const resolve = this._settleResolve;
        this._settleResolve = undefined;
        resolve?.(this.state);
    }

    private _emitStarting(): void {
        this._emit({ status: 'starting' });
    }

    private _emitOff(): void {
        this._emit({ status: 'off' });
    }

    private _emit(next: DevTunnelHostState): void {
        const normalized: DevTunnelHostState = {
            status: next.status,
            publicUrl: next.status === 'online' ? next.publicUrl : undefined,
            error: next.status === 'failed' ? next.error : undefined,
        };
        if (statesEqual(this._state, normalized)) {
            return;
        }
        this._state = normalized;
        try {
            this._onStateChange?.(this.state);
        } catch (err) {
            this._log(`[devtunnel] state-change handler threw: ${(err as Error)?.message ?? err}`);
        }
    }
}

/** Convenience factory mirroring the other desktop modules' construction style. */
export function createDevTunnelHostManager(deps: DevTunnelHostManagerDeps = {}): DevTunnelHostManager {
    return new DevTunnelHostManager(deps);
}
