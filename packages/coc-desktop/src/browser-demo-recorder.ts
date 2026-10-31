import { randomUUID } from 'node:crypto';
import type { BrowserHostedView } from './browser-host-contract';
import type { BrowserDemoAction } from './browser-demo-capture';
import { BrowserDemoSession, type BrowserDemoGapReason, type BrowserDemoOwner, type BrowserDemoSnapshot, type BrowserDemoStatus } from './browser-demo-session';
import { BrowserDemoTabCapture, BrowserDemoUnavailableError, type BrowserDemoTabSink } from './browser-demo-tab-capture';
import { isValidBrowserSessionKey, isValidBrowserViewId } from './browser-view-policy';

export const BROWSER_DEMO_STATE_CHANNEL = 'coc-desktop:browser-demo-state';
export const BROWSER_DEMO_COMMAND_CHANNEL = 'coc-desktop:browser-demo-command';

/** Live drafts (recording, paused or awaiting review) per desktop process. */
export const BROWSER_DEMO_MAX_DRAFTS = 8;
/** A requested child tab that the SPA never opens becomes a gap after this long. */
export const BROWSER_DEMO_PENDING_TAB_MS = 30_000;

export type BrowserDemoPauseReason = 'user' | 'scope' | 'disconnected';
export type BrowserDemoErrorReason = 'engine-unsupported' | 'handshake-failed' | 'file-preview' | 'busy' | 'limit' | 'not-found' | 'invalid';

export class BrowserDemoError extends Error {
    constructor(readonly reason: BrowserDemoErrorReason, message: string) {
        super(message);
        this.name = 'BrowserDemoError';
    }
}

/** Compact live state for strips and badges; review fetches the full draft. */
export interface BrowserDemoState {
    id: string;
    owner: BrowserDemoOwner;
    status: BrowserDemoStatus;
    pauseReason?: BrowserDemoPauseReason;
    stepCount: number;
    tabCount: number;
    /** Open captured tabs, including popups. */
    viewIds: string[];
    incomplete: boolean;
    /** Set once when the draft is freed; nothing about it remains in main. */
    ended?: 'discarded' | 'sent';
}

/** What the manager knows about one tab of a window. */
export interface BrowserDemoTabSource {
    view: Pick<BrowserHostedView, 'cdp' | 'snapshot'>;
    sessionKey: string;
    sourceKind: 'url' | 'file';
    /** Why recording cannot start on this tab now (AI turn, paused takeover). */
    busy?: string;
}

export interface BrowserDemoCapture {
    start(): Promise<void>;
    setEnabled(enabled: boolean): void;
    stop(flush?: boolean): Promise<void>;
}

export interface BrowserDemoRecordersOptions {
    lookup(ownerId: number, viewId: string): BrowserDemoTabSource | undefined;
    send(ownerId: number, channel: string, payload: unknown): void;
    capture?(view: Pick<BrowserHostedView, 'cdp'>, sink: BrowserDemoTabSink): BrowserDemoCapture;
    now?(): number;
    pendingTabMs?: number;
}

interface Demo {
    ownerId: number;
    session: BrowserDemoSession;
    captures: Map<string, BrowserDemoCapture>;
    pending: Map<string, { openerViewId: string; timer: ReturnType<typeof setTimeout> }>;
    pauseReason?: BrowserDemoPauseReason;
    stopping?: boolean;
}

export function validBrowserDemoOwner(value: unknown): value is BrowserDemoOwner {
    const owner = value as Partial<BrowserDemoOwner> | null;
    return !!owner && typeof owner === 'object' && isValidBrowserSessionKey(owner.workspaceId) && isValidBrowserSessionKey(owner.processId)
        && isValidBrowserSessionKey(owner.routingRef) && owner.workspaceId.length <= 256 && owner.processId.length <= 256;
}

function sameOwner(a: BrowserDemoOwner, b: BrowserDemoOwner): boolean {
    return a.workspaceId === b.workspaceId && a.processId === b.processId && a.routingRef === b.routingRef;
}

/**
 * Every task-demonstration draft of this desktop process, keyed by the exact owner
 * `(window ownerId, workspaceId, processId, routingRef)`. Drafts live only here and in the
 * owning window's memory; nothing is persisted and nothing leaves the desktop until the user
 * sends a reviewed copy from the SPA.
 */
export class BrowserDemoRecorders {
    private readonly demos = new Map<string, Demo>();

    constructor(private readonly options: BrowserDemoRecordersOptions) {}

    async start(ownerId: number, owner: unknown, viewId: unknown): Promise<BrowserDemoState> {
        if (!validBrowserDemoOwner(owner) || !isValidBrowserViewId(viewId)) throw new BrowserDemoError('invalid', 'Invalid browser demo owner or tab.');
        if ([...this.demos.values()].some(demo => demo.ownerId === ownerId && sameOwner(demo.session.owner, owner))) {
            throw new BrowserDemoError('busy', 'A demo is already being recorded or reviewed for this chat.');
        }
        if (this.member(ownerId, viewId)) throw new BrowserDemoError('busy', 'This tab is already part of a demo recording.');
        if (this.demos.size >= BROWSER_DEMO_MAX_DRAFTS) throw new BrowserDemoError('limit', 'Too many unsent browser demos. Send or discard one first.');
        const source = this.source(ownerId, viewId, owner);
        const demo: Demo = { ownerId, session: new BrowserDemoSession(randomUUID(), { ...owner }, this.options.now), captures: new Map(), pending: new Map() };
        demo.session.addTab(viewId, source.view.snapshot());
        // Reserve ownership before the handshake, so AI input and another start cannot race it.
        this.demos.set(demo.session.id, demo);
        try {
            await this.capture(demo, viewId, source, true);
            if (this.demos.get(demo.session.id) !== demo || this.options.lookup(ownerId, viewId)?.view !== source.view) {
                throw new BrowserDemoError('not-found', 'The browser tab closed while the demo was starting.');
            }
            return this.emit(demo);
        } catch (error) {
            if (this.demos.get(demo.session.id) === demo) await this.release(ownerId, demo.session.id);
            throw error;
        }
    }

    pause(ownerId: number, id: unknown, reason: BrowserDemoPauseReason = 'user'): BrowserDemoState {
        const demo = this.demo(ownerId, id);
        if (demo.stopping) throw new BrowserDemoError('busy', 'The demo is finishing its capture.');
        if (demo.session.state === 'recording') {
            demo.session.pause();
            demo.pauseReason = reason;
            for (const capture of demo.captures.values()) capture.setEnabled(false);
        }
        return this.emit(demo);
    }

    /** Continue a paused recording, or reopen a stopped draft so new steps append after reviewed ones. */
    async resume(ownerId: number, id: unknown): Promise<BrowserDemoState> {
        const demo = this.demo(ownerId, id);
        if (demo.stopping) throw new BrowserDemoError('busy', 'The demo is finishing its capture.');
        const reopened = demo.session.state === 'stopped';
        demo.session.resume();
        demo.pauseReason = undefined;
        if (reopened) {
            for (const viewId of demo.session.viewIds()) {
                const source = this.options.lookup(ownerId, viewId);
                if (source) await this.capture(demo, viewId, source).catch(() => {});
                else demo.session.closeTab(viewId);
            }
        } else for (const capture of demo.captures.values()) capture.setEnabled(true);
        if (this.demos.get(demo.session.id) !== demo) throw new BrowserDemoError('not-found', 'The demo ended while resuming capture.');
        if (this.demos.get(demo.session.id) === demo && !demo.session.viewIds().length) return this.stop(ownerId, id).then(() => this.state(demo));
        return this.emit(demo);
    }

    /** Stop capturing; the draft stays in memory for review until it is sent or discarded. */
    async stop(ownerId: number, id: unknown): Promise<BrowserDemoSnapshot> {
        const demo = this.demo(ownerId, id);
        if (demo.stopping) throw new BrowserDemoError('busy', 'The demo is finishing its capture.');
        demo.stopping = true;
        this.clearPending(demo);
        const captures = [...demo.captures.entries()];
        try {
            // Keep registrations alive until the final actions pass through their sinks.
            const results = await Promise.allSettled(captures.map(([, capture]) => capture.stop(true)));
            for (const [index, [viewId, capture]] of captures.entries()) {
                if (demo.captures.get(viewId) !== capture) continue;
                demo.captures.delete(viewId);
                if (results[index].status === 'rejected') demo.session.gap(viewId, 'capture-failed');
            }
            demo.pauseReason = undefined;
            const snapshot = demo.session.stop();
            if (this.demos.get(demo.session.id) === demo) this.emit(demo);
            return snapshot;
        } finally {
            demo.stopping = false;
        }
    }

    draft(ownerId: number, id: unknown): BrowserDemoSnapshot {
        return this.demo(ownerId, id).session.snapshot();
    }

    /** Free a draft: Discard, or after the SPA sent the reviewed copy. */
    async release(ownerId: number, id: unknown, ended: 'discarded' | 'sent' = 'discarded'): Promise<void> {
        const demo = this.demo(ownerId, id);
        this.demos.delete(demo.session.id);
        this.clearPending(demo);
        const captures = [...demo.captures.values()];
        demo.captures.clear();
        this.options.send(ownerId, BROWSER_DEMO_STATE_CHANNEL, { ...this.state(demo), ended });
        await Promise.allSettled(captures.map(capture => capture.stop(false)));
    }

    /** Explicitly add another tab of the same owner to an active recording. */
    async addTab(ownerId: number, id: unknown, viewId: unknown): Promise<BrowserDemoState> {
        const demo = this.demo(ownerId, id);
        if (demo.stopping) throw new BrowserDemoError('busy', 'The demo is finishing its capture.');
        if (!isValidBrowserViewId(viewId)) throw new BrowserDemoError('invalid', 'Invalid browser tab.');
        if (demo.session.state === 'stopped') throw new BrowserDemoError('busy', 'Resume the recording before adding tabs.');
        if (this.member(ownerId, viewId)) throw new BrowserDemoError('busy', 'This tab is already part of a demo recording.');
        const source = this.source(ownerId, viewId, demo.session.owner);
        if (!demo.session.addTab(viewId, source.view.snapshot(), undefined, true)) return this.emit(demo);
        await this.capture(demo, viewId, source).catch(() => {});
        if (this.demos.get(demo.session.id) !== demo) throw new BrowserDemoError('not-found', 'The demo ended while adding this tab.');
        return this.emit(demo);
    }

    /** Stop capturing one tab; its earlier steps stay until the user edits them out. */
    async removeTab(ownerId: number, id: unknown, viewId: unknown): Promise<BrowserDemoState> {
        const demo = this.demo(ownerId, id);
        if (typeof viewId === 'string' && demo.session.hasTab(viewId)) await this.closeMember(demo, viewId);
        return this.state(demo);
    }

    /**
     * A captured tab asked for a new tab: reserve the view id the SPA will open, so the child
     * joins the same recording when it starts. Returns undefined for tabs nobody records.
     */
    reserveChild(ownerId: number, openerViewId: string, viewId = `browser-${randomUUID()}`): string | undefined {
        const demo = this.member(ownerId, openerViewId);
        if (!demo || demo.stopping || demo.session.state === 'stopped' || demo.pending.size >= 16) return undefined;
        const timer = setTimeout(() => {
            if (!demo.pending.delete(viewId) || this.demos.get(demo.session.id) !== demo) return;
            demo.session.gap(openerViewId, 'tab-not-opened');
            this.emit(demo);
        }, this.options.pendingTabMs ?? BROWSER_DEMO_PENDING_TAB_MS);
        timer.unref?.();
        demo.pending.set(viewId, { openerViewId, timer });
        return viewId;
    }

    /** A reserved child tab started: capture it with its opener as lineage. */
    async tabReady(ownerId: number, viewId: string): Promise<void> {
        for (const demo of this.demos.values()) {
            const pending = demo.ownerId === ownerId ? demo.pending.get(viewId) : undefined;
            if (!pending) continue;
            clearTimeout(pending.timer);
            demo.pending.delete(viewId);
            const source = this.options.lookup(ownerId, viewId);
            if (!source || source.sessionKey !== demo.session.owner.routingRef) { demo.session.gap(pending.openerViewId, 'tab-not-opened'); this.emit(demo); return; }
            await this.adopt(demo, viewId, source, pending.openerViewId);
            return;
        }
    }

    /** A captured tab opened a popup window: the popup is captured too. */
    async popupOpened(ownerId: number, openerViewId: string, popupViewId: string, view: Pick<BrowserHostedView, 'cdp' | 'snapshot'>): Promise<void> {
        const demo = this.member(ownerId, openerViewId);
        if (!demo || demo.stopping || demo.session.state === 'stopped') return;
        await this.adopt(demo, popupViewId, { view, sessionKey: demo.session.owner.routingRef, sourceKind: 'url' }, openerViewId);
    }

    /** The user brought a tab to the front; only captured tabs become steps. */
    switched(ownerId: number, viewId: unknown): void {
        if (typeof viewId !== 'string') return;
        const demo = this.member(ownerId, viewId);
        if (!demo) return;
        demo.session.switchTo(viewId);
        this.emit(demo);
    }

    navigated(ownerId: number, viewId: string, url: string, title: string): void {
        const demo = this.member(ownerId, viewId);
        if (!demo) return;
        demo.session.navigated(viewId, { url, title });
        this.emit(demo);
    }

    crashed(ownerId: number, viewId: string): void {
        const demo = this.member(ownerId, viewId);
        if (!demo) return;
        demo.session.gap(viewId, 'tab-crashed');
        this.emit(demo);
    }

    async tabClosed(ownerId: number, viewId: string): Promise<void> {
        for (const demo of this.demos.values()) {
            if (demo.ownerId !== ownerId) continue;
            const pending = demo.pending.get(viewId);
            if (pending) { clearTimeout(pending.timer); demo.pending.delete(viewId); demo.session.gap(pending.openerViewId, 'tab-not-opened'); this.emit(demo); }
            if (demo.session.hasTab(viewId)) await this.closeMember(demo, viewId);
        }
    }

    /** AI browser commands for this chat fail while its demo is being captured. */
    capturing(workspaceId: string, processId: string): boolean {
        return [...this.demos.values()].some(demo => demo.session.state !== 'stopped'
            && demo.session.owner.workspaceId === workspaceId && demo.session.owner.processId === processId);
    }

    /** The tab is captured by a recording that is not stopped. */
    recordingTab(ownerId: number, viewId: string): boolean {
        const demo = this.member(ownerId, viewId);
        return !!demo && demo.session.state !== 'stopped';
    }

    /** Unsent drafts of one window, or of every window. */
    unsent(ownerId?: number): BrowserDemoState[] {
        return [...this.demos.values()].filter(demo => ownerId === undefined || demo.ownerId === ownerId).map(demo => this.state(demo));
    }

    /** The window went away or reloaded: its guests are gone and its drafts with them. */
    async closeOwner(ownerId: number): Promise<void> {
        await Promise.allSettled([...this.demos.values()].filter(demo => demo.ownerId === ownerId).map(demo => this.release(ownerId, demo.session.id)));
    }

    private source(ownerId: number, viewId: string, owner: BrowserDemoOwner): BrowserDemoTabSource {
        const source = this.options.lookup(ownerId, viewId);
        if (!source || source.sessionKey !== owner.routingRef) throw new BrowserDemoError('not-found', 'Browser tab not found for this chat.');
        if (source.sourceKind !== 'url') throw new BrowserDemoError('file-preview', 'Local HTML previews cannot be recorded.');
        if (source.view.snapshot().engine === 'webview2') {
            throw new BrowserDemoError('engine-unsupported', 'Demo recording is unavailable in WebView2 because it cannot preserve popup opener lineage. Use an Electron browser tab.');
        }
        if (source.busy) throw new BrowserDemoError('busy', source.busy);
        return source;
    }

    private async adopt(demo: Demo, viewId: string, source: BrowserDemoTabSource, openerViewId: string): Promise<void> {
        if (demo.stopping || demo.session.state === 'stopped') return;
        if (!demo.session.addTab(viewId, source.view.snapshot(), openerViewId)) { this.emit(demo); return; }
        await this.capture(demo, viewId, source).catch(() => {});
        if (this.demos.get(demo.session.id) !== demo) return;
        if (demo.session.state === 'paused') demo.captures.get(viewId)?.setEnabled(false);
        this.emit(demo);
    }

    /** With `required` an unavailable engine fails the call; otherwise the tab is kept as an honest gap. */
    private async capture(demo: Demo, viewId: string, source: BrowserDemoTabSource, required = false): Promise<void> {
        if (!source.view.cdp) {
            if (required) throw new BrowserDemoError('engine-unsupported', 'Demo recording is unavailable in this browser engine.');
            demo.session.gap(viewId, 'capture-failed');
            return;
        }
        const sink: BrowserDemoTabSink = {
            actions: (actions: BrowserDemoAction[]) => {
                if (demo.captures.get(viewId) !== capture) return;
                for (const action of actions) demo.session.action(viewId, action);
                this.emit(demo);
            },
            gap: (reason: BrowserDemoGapReason) => {
                if (demo.captures.get(viewId) !== capture) return;
                demo.session.gap(viewId, reason);
                this.emit(demo);
            },
        };
        const capture = this.options.capture ? this.options.capture(source.view, sink) : new BrowserDemoTabCapture(source.view, sink);
        demo.captures.set(viewId, capture);
        if (demo.session.state === 'paused') capture.setEnabled(false);
        try {
            await capture.start();
            if (this.demos.get(demo.session.id) !== demo || !demo.session.hasTab(viewId)) {
                if (demo.captures.get(viewId) === capture) demo.captures.delete(viewId);
                await capture.stop(false);
                throw new BrowserDemoError('not-found', 'The demo or tab ended while capture was starting.');
            }
        } catch (error) {
            if (demo.captures.get(viewId) === capture) demo.captures.delete(viewId);
            if (error instanceof BrowserDemoError) throw error;
            if (required) {
                throw new BrowserDemoError(error instanceof BrowserDemoUnavailableError ? error.reason : 'handshake-failed',
                    error instanceof Error ? error.message : String(error));
            }
            demo.session.gap(viewId, 'capture-failed');
            throw error;
        }
    }

    private async closeMember(demo: Demo, viewId: string): Promise<void> {
        const capture = demo.captures.get(viewId);
        demo.captures.delete(viewId);
        demo.session.closeTab(viewId);
        await capture?.stop(false).catch(() => {});
        if (this.demos.get(demo.session.id) !== demo) return;
        // The last captured tab closed: stop and hand the draft to review.
        if (!demo.session.viewIds().length && demo.session.state !== 'stopped') { await this.stop(demo.ownerId, demo.session.id); return; }
        this.emit(demo);
    }

    private clearPending(demo: Demo): void {
        for (const { timer } of demo.pending.values()) clearTimeout(timer);
        demo.pending.clear();
    }

    private member(ownerId: number, viewId: string): Demo | undefined {
        for (const demo of this.demos.values()) if (demo.ownerId === ownerId && demo.session.hasTab(viewId)) return demo;
        return undefined;
    }

    private demo(ownerId: number, id: unknown): Demo {
        const demo = typeof id === 'string' ? this.demos.get(id) : undefined;
        if (!demo || demo.ownerId !== ownerId) throw new BrowserDemoError('not-found', 'Browser demo not found.');
        return demo;
    }

    private state(demo: Demo): BrowserDemoState {
        const snapshot = demo.session.snapshot();
        return {
            id: snapshot.id, owner: snapshot.owner, status: snapshot.status,
            ...(demo.pauseReason && snapshot.status === 'paused' ? { pauseReason: demo.pauseReason } : {}),
            stepCount: snapshot.steps.length, tabCount: snapshot.tabs.length,
            viewIds: demo.session.viewIds(), incomplete: snapshot.incomplete,
        };
    }

    private emit(demo: Demo): BrowserDemoState {
        const state = this.state(demo);
        this.options.send(demo.ownerId, BROWSER_DEMO_STATE_CHANNEL, state);
        return state;
    }
}

export type BrowserDemoCommand =
    | { action: 'start'; owner: BrowserDemoOwner; viewId: string }
    | { action: 'pause'; id: string; reason?: BrowserDemoPauseReason }
    | { action: 'resume' | 'stop' | 'draft' | 'discard' | 'sent'; id: string }
    | { action: 'add-tab' | 'remove-tab'; id: string; viewId: string }
    | { action: 'switch'; viewId: string }
    | { action: 'list' };

export type BrowserDemoCommandResult =
    | { ok: true; state?: BrowserDemoState; draft?: BrowserDemoSnapshot; drafts?: BrowserDemoState[] }
    | { ok: false; reason: BrowserDemoErrorReason; message: string };

const PAUSE_REASONS = new Set<BrowserDemoPauseReason>(['user', 'scope', 'disconnected']);

/** One IPC request from the owning SPA window; failures come back as values, never as thrown IPC errors. */
export async function runBrowserDemoCommand(recorders: BrowserDemoRecorders, ownerId: number, input: unknown): Promise<BrowserDemoCommandResult> {
    const command = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
    try {
        switch (command.action) {
            case 'start': return { ok: true, state: await recorders.start(ownerId, command.owner, command.viewId) };
            case 'pause': return { ok: true, state: recorders.pause(ownerId, command.id, PAUSE_REASONS.has(command.reason as BrowserDemoPauseReason) ? command.reason as BrowserDemoPauseReason : 'user') };
            case 'resume': return { ok: true, state: await recorders.resume(ownerId, command.id) };
            case 'stop': return { ok: true, draft: await recorders.stop(ownerId, command.id) };
            case 'draft': return { ok: true, draft: recorders.draft(ownerId, command.id) };
            case 'discard': await recorders.release(ownerId, command.id, 'discarded'); return { ok: true };
            case 'sent': await recorders.release(ownerId, command.id, 'sent'); return { ok: true };
            case 'add-tab': return { ok: true, state: await recorders.addTab(ownerId, command.id, command.viewId) };
            case 'remove-tab': return { ok: true, state: await recorders.removeTab(ownerId, command.id, command.viewId) };
            case 'switch': recorders.switched(ownerId, command.viewId); return { ok: true };
            case 'list': return { ok: true, drafts: recorders.unsent(ownerId) };
            default: return { ok: false, reason: 'invalid', message: 'Unknown browser demo command.' };
        }
    } catch (error) {
        if (error instanceof BrowserDemoError) return { ok: false, reason: error.reason, message: error.message };
        return { ok: false, reason: 'handshake-failed', message: error instanceof Error ? error.message : String(error) };
    }
}
