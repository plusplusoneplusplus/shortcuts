import { BrowserControlPage, type BrowserCdpSender } from './browser-control-page';

/** Serializes trusted input sequences without releasing an outstanding CDP call on cancellation. */
export class BrowserControlQueue {
    private readonly page: BrowserControlPage;
    private tail: Promise<void> = Promise.resolve();
    private active?: AbortSignal;
    private readonly pending = new Set<AbortController>();

    constructor(send: BrowserCdpSender) {
        this.page = new BrowserControlPage(async (method, params, sessionId) => {
            const signal = this.active;
            if (!signal) throw new Error('Browser control requires an active command');
            const release = (method === 'Input.dispatchMouseEvent' && params?.type === 'mouseReleased')
                || (method === 'Input.dispatchKeyEvent' && params?.type === 'keyUp');
            // Complete a dispatched press so Stop never leaves a mouse button or key held.
            if (!release) signal.throwIfAborted();
            const result = await (sessionId === undefined ? send(method, params) : send(method, params, sessionId));
            // Let snapshots retain their ref counter; the next CDP call and final result still check cancellation.
            return result;
        });
    }

    run<T>(operation: (page: BrowserControlPage, signal: AbortSignal) => Promise<T>, signal?: AbortSignal): Promise<T> {
        if (signal?.aborted) return Promise.reject(signal.reason);
        const controller = new AbortController();
        this.pending.add(controller);
        const abort = () => controller.abort(signal?.reason);
        signal?.addEventListener('abort', abort, { once: true });
        const timeout = setTimeout(() => controller.abort(new Error('Browser command timed out after 30s')), 30_000);
        timeout.unref();
        let rejectAborted!: (reason: unknown) => void;
        const aborted = new Promise<never>((_resolve, reject) => { rejectAborted = reject; });
        const onAbort = () => rejectAborted(controller.signal.reason);
        controller.signal.addEventListener('abort', onAbort, { once: true });
        const execution = this.tail.then(async () => {
            controller.signal.throwIfAborted();
            this.active = controller.signal;
            try {
                const result = await operation(this.page, controller.signal);
                controller.signal.throwIfAborted();
                return result;
            } finally {
                this.active = undefined;
            }
        });
        // Keep the serialization barrier until the underlying call settles, even if its caller has left.
        this.tail = execution.then(() => {}, () => {});
        return Promise.race([execution, aborted]).finally(() => {
            clearTimeout(timeout);
            signal?.removeEventListener('abort', abort);
            controller.signal.removeEventListener('abort', onAbort);
            this.pending.delete(controller);
        });
    }

    cancel(reason: Error): void {
        for (const controller of this.pending) controller.abort(reason);
        this.page.dispose();
    }
}
