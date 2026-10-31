import { redactDemoText, redactDemoUrl, type BrowserDemoAction } from './browser-demo-capture';

/** The conversation a recording belongs to; every field must match exactly to touch it. */
export interface BrowserDemoOwner {
    workspaceId: string;
    processId: string;
    routingRef: string;
}

export interface BrowserDemoTab {
    viewId: string;
    /** 1-based order of capture, shown as "Tab N" in review. */
    index: number;
    openerViewId?: string;
    /** The user added an existing tab explicitly instead of opening it from a captured one. */
    addedByUser?: true;
    url: string;
    title: string;
    closed?: true;
}

export type BrowserDemoGapReason = 'paused' | 'rate-limit' | 'step-limit' | 'tab-limit' | 'capture-failed' | 'frame-unavailable' | 'tab-crashed' | 'tab-not-opened';

export type BrowserDemoStep = { id: number; at: number; viewId: string } & (
    | { type: 'action'; action: BrowserDemoAction }
    | { type: 'navigate'; url: string; title: string }
    | { type: 'tab-opened'; openerViewId?: string; addedByUser?: true; url: string }
    | { type: 'switch' }
    | { type: 'tab-closed' }
    | { type: 'gap'; reason: BrowserDemoGapReason }
);

export type BrowserDemoStatus = 'recording' | 'paused' | 'stopped';

export interface BrowserDemoSnapshot {
    id: string;
    owner: BrowserDemoOwner;
    status: BrowserDemoStatus;
    startedAt: number;
    tabs: BrowserDemoTab[];
    steps: BrowserDemoStep[];
    /** Steps were dropped; review must say so. */
    incomplete: boolean;
}

export const BROWSER_DEMO_LIMITS = { steps: 300, tabs: 24, burst: 40, burstWindowMs: 5_000 } as const;

type StepInput = BrowserDemoStep extends infer Step ? Step extends BrowserDemoStep ? Omit<Step, 'id' | 'at' | 'viewId'> : never : never;

/** One owner's in-memory capture. Nothing here is persisted or sent until the user reviews it. */
export class BrowserDemoSession {
    private status: BrowserDemoStatus = 'recording';
    private readonly tabs = new Map<string, BrowserDemoTab>();
    private readonly steps: BrowserDemoStep[] = [];
    private readonly bursts = new Map<string, number[]>();
    private nextId = 1;
    private incomplete = false;
    private activeViewId?: string;
    readonly startedAt: number;

    constructor(readonly id: string, readonly owner: BrowserDemoOwner, private readonly now: () => number = Date.now) {
        this.startedAt = now();
    }

    get state(): BrowserDemoStatus { return this.status; }

    hasTab(viewId: string): boolean {
        return this.tabs.has(viewId) && !this.tabs.get(viewId)!.closed;
    }

    viewIds(): string[] {
        return [...this.tabs.values()].filter(tab => !tab.closed).map(tab => tab.viewId);
    }

    /**
     * Add the starting tab, a tab whose opener is already captured, or (`addedByUser`) an existing
     * tab the user chose explicitly. Returns false when it is not added.
     */
    addTab(viewId: string, page: { url: string; title: string }, openerViewId?: string, addedByUser = false): boolean {
        if (this.status === 'stopped' || this.tabs.has(viewId)) return false;
        if (openerViewId !== undefined && !this.hasTab(openerViewId)) return false;
        if (this.tabs.size >= BROWSER_DEMO_LIMITS.tabs) {
            this.gap(openerViewId ?? this.activeViewId ?? viewId, 'tab-limit');
            return false;
        }
        const url = redactDemoUrl(page.url) ?? '';
        const lineage = { ...(openerViewId ? { openerViewId } : {}), ...(addedByUser ? { addedByUser: true as const } : {}) };
        this.tabs.set(viewId, { viewId, index: this.tabs.size + 1, ...lineage, url, title: redactDemoText(page.title) });
        this.push(viewId, { type: 'tab-opened', ...lineage, url });
        if (this.activeViewId === undefined) this.activeViewId = viewId;
        return true;
    }

    closeTab(viewId: string): void {
        const tab = this.tabs.get(viewId);
        if (!tab || tab.closed || this.status === 'stopped') return;
        tab.closed = true;
        this.push(viewId, { type: 'tab-closed' });
    }

    /** The user brought a captured tab to the front. */
    switchTo(viewId: string): void {
        if (!this.hasTab(viewId) || this.activeViewId === viewId) return;
        this.activeViewId = viewId;
        this.record(viewId, { type: 'switch' });
    }

    navigated(viewId: string, page: { url: string; title: string }): void {
        const tab = this.tabs.get(viewId);
        const url = redactDemoUrl(page.url);
        if (!tab || tab.closed || !url) return;
        const title = redactDemoText(page.title);
        const changed = tab.url !== url;
        tab.url = url;
        tab.title = title || tab.title;
        if (changed) this.record(viewId, { type: 'navigate', url, title });
    }

    action(viewId: string, action: BrowserDemoAction): void {
        if (this.hasTab(viewId)) this.record(viewId, { type: 'action', action });
    }

    /** Capture could not be guaranteed for this tab; review shows the gap instead of silently missing steps. */
    gap(viewId: string, reason: BrowserDemoGapReason): void {
        if (this.status === 'stopped') return;
        this.incomplete = true;
        const last = this.steps[this.steps.length - 1];
        if (last?.type === 'gap' && last.reason === reason && last.viewId === viewId) return;
        if (this.steps.length < BROWSER_DEMO_LIMITS.steps + 1) this.push(viewId, { type: 'gap', reason });
    }

    pause(): void {
        if (this.status !== 'recording') return;
        this.status = 'paused';
        const viewId = this.activeViewId ?? this.viewIds()[0];
        if (viewId) this.push(viewId, { type: 'gap', reason: 'paused' });
    }

    /** Continue a paused capture, or reopen a stopped one so new steps append after the reviewed ones. */
    resume(): void {
        if (this.status !== 'recording') this.status = 'recording';
    }

    stop(): BrowserDemoSnapshot {
        this.status = 'stopped';
        return this.snapshot();
    }

    snapshot(): BrowserDemoSnapshot {
        return {
            id: this.id, owner: { ...this.owner }, status: this.status, startedAt: this.startedAt,
            tabs: [...this.tabs.values()].map(tab => ({ ...tab })),
            steps: this.steps.map(step => ({ ...step })),
            incomplete: this.incomplete,
        };
    }

    private record(viewId: string, step: StepInput): void {
        if (this.status !== 'recording') return;
        if (this.steps.length >= BROWSER_DEMO_LIMITS.steps) { this.gap(viewId, 'step-limit'); return; }
        const now = this.now();
        const burst = (this.bursts.get(viewId) ?? []).filter(at => now - at < BROWSER_DEMO_LIMITS.burstWindowMs);
        if (burst.length >= BROWSER_DEMO_LIMITS.burst) { this.gap(viewId, 'rate-limit'); return; }
        burst.push(now);
        this.bursts.set(viewId, burst);
        this.push(viewId, step);
    }

    private push(viewId: string, step: StepInput): void {
        this.steps.push({ ...step, id: this.nextId++, at: this.now(), viewId } as BrowserDemoStep);
    }
}
