import type { TrouterWake } from './trouter';

export interface TeamsReadHints {
    rootMessageIds: readonly string[];
    reconcile: boolean;
    signal?: AbortSignal;
}

/** Bounded wake mailbox; reads are single-flight and fallback is completion-relative. */
export class TeamsNotificationScheduler {
    private readonly lifetime = new AbortController();
    private readonly roots = new Set<string>();
    private pending = false;
    private reconcile = false;
    private running = false;
    private retryAt = 0;
    private timer?: ReturnType<typeof setTimeout>;

    constructor(private readonly scan: (hints: TeamsReadHints) => Promise<{ success: boolean; retryAt: number }>) {}

    start(): void { this.wake({ cause: 'disconnect' }); }

    stop(): void {
        this.lifetime.abort();
        clearTimeout(this.timer);
        this.timer = undefined;
        this.roots.clear();
        this.pending = false;
    }

    wake(wake: TrouterWake): void {
        if (this.lifetime.signal.aborted) return;
        this.pending = true;
        if (wake.cause !== 'message' || !wake.rootMessageId) this.reconcile = true;
        if (wake.rootMessageId) {
            this.roots.add(wake.rootMessageId);
            if (this.roots.size > 64) {
                this.reconcile = true;
                this.roots.clear();
            }
        }
        if (!this.running) this.arm(Math.max(0, this.retryAt - Date.now()));
    }

    private arm(delay: number): void {
        clearTimeout(this.timer);
        this.timer = setTimeout(() => {
            this.timer = undefined;
            void this.run();
        }, Math.min(2_147_483_647, delay));
    }

    private async run(): Promise<void> {
        if (this.running || this.lifetime.signal.aborted) return;
        if (this.retryAt > Date.now()) {
            this.arm(this.retryAt - Date.now());
            return;
        }
        this.running = true;
        const hints: TeamsReadHints = {
            rootMessageIds: [...this.roots], reconcile: this.reconcile || !this.pending,
            signal: this.lifetime.signal,
        };
        this.pending = false;
        this.reconcile = false;
        this.roots.clear();
        let result = { success: false, retryAt: 0 };
        try {
            result = await this.scan(hints);
        } catch {
            console.error('[teams-notification] Reconciliation callback failed; retrying');
        }
        this.running = false;
        if (this.lifetime.signal.aborted) return;
        this.retryAt = result.retryAt;
        if (!result.success) {
            this.pending = true;
            this.reconcile ||= hints.reconcile;
            for (const root of hints.rootMessageIds) this.roots.add(root);
            if (this.roots.size > 64) {
                this.reconcile = true;
                this.roots.clear();
            }
            this.retryAt = Math.max(this.retryAt, Date.now() + (result.retryAt > Date.now() ? 0 : 2000));
        }
        this.arm(Math.max(this.pending ? 0 : 60_000, this.retryAt - Date.now()));
    }
}
