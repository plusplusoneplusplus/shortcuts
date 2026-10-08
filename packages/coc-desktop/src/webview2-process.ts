import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { BrowserHostError } from './browser-host-contract';
import type { BrowserFailureReason } from './browser-view-policy';

export function browserMessage(value: unknown): Record<string, unknown> | undefined {
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

interface Pending {
    resolve(): void;
    reject(error: Error): void;
    timer: ReturnType<typeof setTimeout>;
}

export class WebView2Process {
    private child?: ChildProcessWithoutNullStreams;
    private starting?: Promise<void>;
    private sequence = 0;
    private readonly pending = new Map<number, Pending>();
    private buffer = '';
    private closing = false;
    private readyResolve?: () => void;
    private readyReject?: (error: Error) => void;
    private readyTimer?: ReturnType<typeof setTimeout>;

    constructor(
        private readonly binary: () => string,
        private readonly profile: string,
        private readonly onEvent: (message: Record<string, unknown>) => void,
        private readonly onFailure: (error: BrowserHostError) => void,
    ) {}

    get running(): boolean { return Boolean(this.child && !this.closing); }

    private start(): Promise<void> {
        if (this.starting) { return this.starting; }
        this.closing = false;
        this.buffer = '';
        this.starting = new Promise<void>((resolve, reject) => {
            this.readyResolve = resolve;
            this.readyReject = reject;
            this.readyTimer = setTimeout(() => this.fail(new BrowserHostError('startup-failed', 'WebView2 startup timed out. Retry or select Electron.')), 20_000);
            let child: ChildProcessWithoutNullStreams;
            try { child = spawn(this.binary(), [this.profile], { stdio: 'pipe', windowsHide: true }); }
            catch (error) {
                this.fail(new BrowserHostError('native-unavailable', error instanceof Error ? error.message : String(error)));
                return;
            }
            this.child = child;
            child.stdout.setEncoding('utf8');
            child.stdout.on('data', (chunk: string) => { if (this.child === child) { this.read(chunk); } });
            child.stderr.on('data', (chunk: Buffer) => { if (this.child === child) { console.error('[coc-desktop] WebView2:', chunk.toString().trim()); } });
            child.stdin.on('error', error => { if (this.child === child) { this.fail(new BrowserHostError('runtime-crashed', error.message)); } });
            child.on('error', error => { if (this.child === child) { this.fail(new BrowserHostError('startup-failed', error.message)); } });
            child.on('exit', (code, signal) => {
                if (this.child !== child) { return; }
                this.child = undefined;
                if (!this.closing) { this.fail(new BrowserHostError('runtime-crashed', `WebView2 host stopped (${signal ?? code}). Retry or select Electron in Desktop Preferences.`)); }
                this.starting = undefined;
            });
        });
        // Spawn can fail synchronously before a caller receives the promise.
        const starting = this.starting;
        void starting.catch(() => { if (this.starting === starting) { this.starting = undefined; } });
        return this.starting;
    }

    private read(chunk: string): void {
        this.buffer += chunk;
        if (this.buffer.length > 1_048_576) {
            this.fail(new BrowserHostError('runtime-crashed', 'WebView2 sent an oversized message.'));
            return;
        }
        let end: number;
        while ((end = this.buffer.indexOf('\n')) >= 0) {
            const line = this.buffer.slice(0, end);
            this.buffer = this.buffer.slice(end + 1);
            let message: Record<string, unknown> | undefined;
            try { message = browserMessage(JSON.parse(line)); }
            catch { this.fail(new BrowserHostError('runtime-crashed', 'WebView2 sent an invalid message.')); return; }
            if (!message) { this.fail(new BrowserHostError('runtime-crashed', 'WebView2 sent an invalid message.')); return; }
            if (message.event === 'ready') {
                clearTimeout(this.readyTimer);
                this.readyResolve?.();
                this.readyResolve = undefined;
                this.readyReject = undefined;
            } else if (typeof message.id === 'number') {
                if (message.id === 0 && message.ok === false) {
                    this.fail(this.error(message));
                    return;
                }
                const pending = this.pending.get(message.id);
                if (pending) {
                    clearTimeout(pending.timer);
                    this.pending.delete(message.id);
                    if (message.ok === true) { pending.resolve(); }
                    else { pending.reject(this.error(message)); }
                }
            } else if (typeof message.event === 'string') { this.onEvent(message); }
            else { this.fail(new BrowserHostError('runtime-crashed', 'WebView2 sent an unexpected message.')); return; }
        }
    }

    private error(message: Record<string, unknown>): BrowserHostError {
        const reasons: BrowserFailureReason[] = ['missing-runtime', 'profile-locked', 'startup-failed', 'runtime-crashed', 'cleanup-failed', 'not-found', 'no-window', 'invalid'];
        const reason = reasons.find(reason => reason === message.reason) ?? 'runtime-crashed';
        return new BrowserHostError(reason, typeof message.message === 'string' ? message.message : 'WebView2 request failed.');
    }

    private fail(error: BrowserHostError): void {
        clearTimeout(this.readyTimer);
        this.readyReject?.(error);
        this.readyReject = undefined;
        this.readyResolve = undefined;
        for (const pending of this.pending.values()) {
            clearTimeout(pending.timer);
            pending.reject(error);
        }
        this.pending.clear();
        this.onFailure(error);
        const child = this.child;
        this.child = undefined;
        this.starting = undefined;
        if (child) { child.kill(); }
    }

    async request(op: string, payload: Record<string, unknown> = {}): Promise<void> {
        if (!this.child && op !== 'open' && op !== 'clear' && op !== 'import-profile-cookies') {
            throw new BrowserHostError('runtime-crashed', 'WebView2 host is not running. Retry explicitly.');
        }
        await this.start();
        const child = this.child;
        if (!child || this.closing) { throw new BrowserHostError('runtime-crashed', 'WebView2 host is not running.'); }
        const id = ++this.sequence;
        await new Promise<void>((resolve, reject) => {
            const timer = setTimeout(() => this.fail(new BrowserHostError('runtime-crashed', `WebView2 ${op} timed out. Retry explicitly.`)), 30_000);
            this.pending.set(id, { resolve, reject, timer });
            child.stdin.write(JSON.stringify({ ...payload, id, op }) + '\n', error => { if (error) { this.fail(new BrowserHostError('runtime-crashed', error.message)); } });
        });
    }

    async dispose(): Promise<void> {
        const child = this.child;
        if (!child) { return; }
        this.closing = true;
        // The quit acknowledgement and process exit can arrive in the same read turn.
        const id = ++this.sequence;
        await new Promise<void>((resolve, reject) => {
            if (child.exitCode !== null) {
                if (child.exitCode === 0) resolve();
                else reject(new BrowserHostError('cleanup-failed', `WebView2 stopped with code ${child.exitCode}.`));
                return;
            }
            const timer = setTimeout(() => {
                child.kill();
                reject(new BrowserHostError('cleanup-failed', 'WebView2 did not stop. Close the app and retry cleanup.'));
            }, 10_000);
            child.once('exit', (code, signal) => {
                clearTimeout(timer);
                if (code === 0) resolve();
                else reject(new BrowserHostError('cleanup-failed', `WebView2 did not stop cleanly (${signal ?? code}).`));
            });
            child.stdin.write(JSON.stringify({ id, op: 'quit' }) + '\n', error => {
                if (error) {
                    clearTimeout(timer);
                    child.kill();
                    reject(new BrowserHostError('cleanup-failed', `Could not stop WebView2: ${error.message}`));
                }
            });
        });
        this.child = undefined;
        this.starting = undefined;
    }
}
