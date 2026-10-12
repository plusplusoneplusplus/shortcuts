import type { WebContents } from 'electron';
import { BrowserHostError } from './browser-host-contract';

/** One adopted URL guest's debugger; never used by SPA contents or file previews. */
export class ElectronBrowserCdp {
    private closed = false;
    private attached = false;
    private readonly pending = new Set<(error: Error) => void>();

    constructor(private readonly contents: WebContents) {
        contents.on('destroyed', this.destroyed);
        contents.on('render-process-gone', this.crashed);
        contents.debugger.on('detach', this.detached);
    }

    private readonly destroyed = () => this.dispose();
    private readonly crashed = () => {
        this.rejectPending(new BrowserHostError('runtime-crashed', 'Browser page crashed during CDP command.'));
    };
    private readonly detached = (_event: unknown, reason: string) => {
        this.attached = false;
        this.rejectPending(new Error(`Browser debugger detached: ${reason}`));
    };

    private rejectPending(error: Error): void {
        for (const reject of [...this.pending]) { reject(error); }
    }

    async send(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
        if (this.closed || this.contents.isDestroyed()) {
            throw new BrowserHostError('not-found', 'Browser tab is closed.');
        }
        const debuggerApi = this.contents.debugger;
        if (!debuggerApi.isAttached()) {
            debuggerApi.attach('1.3');
            this.attached = true;
        }
        return new Promise((resolve, reject) => {
            const finish = (error?: unknown, result?: unknown) => {
                if (!this.pending.delete(fail)) { return; }
                clearTimeout(timer);
                if (error !== undefined) { reject(error); } else { resolve(result); }
            };
            const fail = (error: Error) => finish(error);
            const timer = setTimeout(() => fail(new Error('Browser CDP command timed out after 30s.')), 30_000);
            this.pending.add(fail);
            try {
                debuggerApi.sendCommand(method, params).then(result => finish(undefined, result), error => finish(error));
            } catch (error) { finish(error); }
        });
    }

    dispose(): void {
        if (this.closed) { return; }
        this.closed = true;
        this.rejectPending(new BrowserHostError('not-found', 'Browser tab closed during CDP command.'));
        this.contents.removeListener('destroyed', this.destroyed);
        this.contents.removeListener('render-process-gone', this.crashed);
        this.contents.debugger.removeListener('detach', this.detached);
        if (this.attached && !this.contents.isDestroyed() && this.contents.debugger.isAttached()) {
            this.contents.debugger.detach();
        }
        this.attached = false;
    }
}
