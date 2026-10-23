import { BrowserControlPage, type BrowserCdpSender } from './browser-control-page';

/** The 60s control deadline. It pauses while a held navigation waits for the user's approval. */
export class ControlDeadline {
    private timer?: ReturnType<typeof setTimeout>;
    private remaining: number;
    private started = 0;
    private holds = 0;
    private done = false;

    constructor(ms: number, private readonly expire: () => void) {
        this.remaining = ms;
        this.start();
    }

    private start(): void {
        this.started = Date.now();
        this.timer = setTimeout(() => { this.done = true; this.expire(); }, this.remaining);
        this.timer.unref?.();
    }

    /** Pause until the returned release runs; nested holds resume with the time that was left. */
    hold(): () => void {
        if (this.done) return () => {};
        if (this.holds++ === 0 && this.timer) {
            clearTimeout(this.timer);
            this.timer = undefined;
            this.remaining = Math.max(0, this.remaining - (Date.now() - this.started));
        }
        let released = false;
        return () => {
            if (released) return;
            released = true;
            if (--this.holds === 0 && !this.done) this.start();
        };
    }

    clear(): void {
        this.done = true;
        if (this.timer) clearTimeout(this.timer);
        this.timer = undefined;
    }
}

/** Serializes trusted input sequences without releasing an outstanding CDP call on cancellation. */
export class BrowserControlQueue {
    private readonly page: BrowserControlPage;
    private tail: Promise<void> = Promise.resolve();
    private active?: AbortSignal;
    private readonly pending = new Set<AbortController>();
    private readonly deadlines = new Set<ControlDeadline>();
    private readonly holds = new Set<Map<ControlDeadline, () => void>>();

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
        const deadline = new ControlDeadline(60_000, () => controller.abort(new Error('Browser command timed out after 60s')));
        this.deadlines.add(deadline);
        for (const held of this.holds) held.set(deadline, deadline.hold());
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
            deadline.clear();
            this.deadlines.delete(deadline);
            for (const held of this.holds) held.delete(deadline);
            signal?.removeEventListener('abort', abort);
            controller.signal.removeEventListener('abort', onAbort);
            this.pending.delete(controller);
        });
    }

    /** Pause every queued or running command's deadline, including ones queued while held. */
    hold(): () => void {
        const held = new Map<ControlDeadline, () => void>();
        for (const deadline of this.deadlines) held.set(deadline, deadline.hold());
        this.holds.add(held);
        return () => {
            if (!this.holds.delete(held)) return;
            for (const release of held.values()) release();
        };
    }

    cancel(reason: Error): void {
        for (const controller of this.pending) controller.abort(reason);
        this.page.dispose();
    }
}
