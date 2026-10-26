import type { BrowserTakeoverState } from '@plusplusoneplusplus/coc-client';

/** One in-memory conversation turn; pending operations stay outside the engine queues. */
export class BrowserHumanTakeover {
    status: BrowserTakeoverState['status'] = 'agent';
    revision = 0;
    reason?: string;
    error?: string;
    note?: string;
    private ended?: Error;
    private returning = false;
    private tail: Promise<void> = Promise.resolve();
    private active?: { controller: AbortController; settled: Promise<void> };
    private readonly pending = new Map<AbortController, { hold?: () => () => void; release?: () => void }>();
    private gate?: { promise: Promise<void>; release(): void };
    private barrier: Promise<void> = Promise.resolve();

    constructor(readonly owner: Pick<BrowserTakeoverState, 'workspaceId' | 'processId' | 'turnId' | 'routingRef'>,
        private readonly changed: (state: BrowserTakeoverState) => void) {}

    get paused(): boolean { return !!this.gate; }
    state(): BrowserTakeoverState { return { ...this.owner, status: this.status, reason: this.reason, error: this.error }; }
    private publish(): void { this.changed(this.state()); }

    async wait(signal?: AbortSignal): Promise<void> {
        while (this.gate) {
            signal?.throwIfAborted();
            await new Promise<void>((resolve, reject) => {
                const abort = () => { cleanup(); reject(signal?.reason); };
                const cleanup = () => signal?.removeEventListener('abort', abort);
                signal?.addEventListener('abort', abort, { once: true });
                this.gate!.promise.then(() => { cleanup(); resolve(); });
            });
        }
        signal?.throwIfAborted();
        if (this.ended) throw this.ended;
    }

    run<T>(operation: (signal: AbortSignal) => Promise<T>, signal?: AbortSignal,
        hold?: () => () => void, validate?: (signal: AbortSignal) => Promise<void>, forceValidation = false): Promise<T> {
        if (this.ended) return Promise.reject(this.ended);
        if (signal?.aborted) return Promise.reject(signal.reason);
        const controller = new AbortController();
        const abort = () => controller.abort(signal?.reason);
        signal?.addEventListener('abort', abort, { once: true });
        const pending = { hold, release: this.paused ? hold?.() : undefined };
        this.pending.set(controller, pending);
        const revision = this.paused ? this.revision - 1 : this.revision;
        let rejectAbort!: (error: unknown) => void;
        const aborted = new Promise<never>((_yes, no) => { rejectAbort = no; });
        const onAbort = () => rejectAbort(controller.signal.reason);
        controller.signal.addEventListener('abort', onAbort, { once: true });
        const execution = this.tail.then(async () => {
            await this.wait(controller.signal);
            controller.signal.throwIfAborted();
            let settled!: () => void;
            const active = { controller, settled: new Promise<void>(resolve => { settled = resolve; }) };
            this.active = active;
            try {
                if (forceValidation || revision !== this.revision) {
                    if (!validate) throw new Error('stale-action: page validity unavailable; replan browser action');
                    await validate(controller.signal);
                    controller.signal.throwIfAborted();
                }
                const result = await operation(controller.signal);
                controller.signal.throwIfAborted();
                return result;
            } finally {
                if (this.active === active) this.active = undefined;
                settled();
            }
        });
        this.tail = execution.then(() => {}, () => {});
        return Promise.race([execution, aborted]).finally(() => {
            pending.release?.();
            this.pending.delete(controller);
            signal?.removeEventListener('abort', abort);
            controller.signal.removeEventListener('abort', onAbort);
        });
    }

    /** Synchronous dispatch/privacy stop; ready resolves after in-flight engine calls and releases settle. */
    take(reason?: string): Promise<void> {
        if (this.ended) return Promise.reject(this.ended);
        if (this.gate) { if (reason !== undefined) { this.reason = reason; this.publish(); } return this.barrier; }
        let release!: () => void;
        this.gate = { promise: new Promise(resolve => { release = resolve; }), release: () => release() };
        this.status = 'taking-over'; this.reason = reason; this.error = undefined; this.revision++;
        for (const pending of this.pending.values()) pending.release ??= pending.hold?.();
        const active = this.active;
        this.barrier = (active?.settled ?? Promise.resolve()).then(() => {
            if (!this.ended && this.status === 'taking-over') { this.status = 'human'; this.publish(); }
        });
        active?.controller.abort(new Error('unknown-outcome: interrupted by human takeover; do not replay this action'));
        this.publish();
        return this.barrier;
    }

    /** Refresh is private until success; failure retains the pause and permits an explicit retry. */
    async returnToAgent(refresh: () => Promise<void>, note?: string): Promise<void> {
        if (!this.gate || this.returning) throw new Error('Browser is not ready to return');
        this.returning = true;
        try {
            await this.barrier;
            if (this.ended) throw this.ended;
            this.status = 'checking'; this.error = undefined; this.publish();
            await refresh();
            if (this.ended) throw this.ended;
            this.note = note;
            this.status = 'agent'; this.reason = undefined;
            const gate = this.gate; this.gate = undefined;
            for (const pending of this.pending.values()) { pending.release?.(); pending.release = undefined; }
            this.publish(); gate?.release();
        } catch (error) {
            if (!this.ended) { this.status = 'human'; this.error = 'Could not refresh the page. Retry Return to agent or Stop.'; this.publish(); }
            throw error;
        } finally { this.returning = false; }
    }

    stop(reason = 'Browser human takeover stopped'): void {
        if (this.ended) return;
        this.ended = new Error(reason);
        this.status = 'terminated'; this.error = reason;
        for (const [controller, pending] of this.pending) { controller.abort(this.ended); pending.release?.(); pending.release = undefined; }
        this.active?.controller.abort(this.ended);
        const gate = this.gate; this.gate = undefined; gate?.release();
        this.publish();
    }
}
