import type { BrowserHostedView } from './browser-host-contract';
import { BROWSER_DEMO_DRAIN, BROWSER_DEMO_QUEUE_LIMIT, BROWSER_DEMO_WORLD, buildBrowserDemoCaptureSource, sanitizeDemoObservation, type BrowserDemoAction } from './browser-demo-capture';
import type { BrowserDemoGapReason } from './browser-demo-session';

export type BrowserDemoUnavailableReason = 'engine-unsupported' | 'handshake-failed';

export class BrowserDemoUnavailableError extends Error {
    constructor(readonly reason: BrowserDemoUnavailableReason, message: string) {
        super(message);
        this.name = 'BrowserDemoUnavailableError';
    }
}

export interface BrowserDemoTabSink {
    actions(actions: BrowserDemoAction[]): void;
    gap(reason: BrowserDemoGapReason): void;
}

type Cdp = NonNullable<BrowserHostedView['cdp']>;

/** Frames drained per poll; deeper or wider trees are reported as a gap instead of growing the work. */
export const BROWSER_DEMO_FRAME_LIMIT = 16;
export const BROWSER_DEMO_POLL_MS = 400;

interface Frame { id: string; main: boolean }

/** Drain the world queue; `true`/`false` also turns reporting on or off for that document. */
const drainExpression = (enabled?: boolean) =>
    `typeof window[${JSON.stringify(BROWSER_DEMO_DRAIN)}] === 'function' ? window[${JSON.stringify(BROWSER_DEMO_DRAIN)}](${enabled === undefined ? '' : String(enabled)}) : null`;

/**
 * Drives the capture script in one URL tab over engine-neutral CDP commands only (both engines
 * forward commands; neither needs a new event). The script lives in a private isolated world
 * installed on every new document; main polls each frame's world and passes sanitized actions on.
 */
export class BrowserDemoTabCapture {
    private scriptId?: string;
    private timer?: ReturnType<typeof setInterval>;
    private polling?: Promise<void>;
    private readiness?: AbortController;
    private generation = 0;
    private enabled = true;
    private discardQueued = false;
    private enableRevision = 0;
    private readonly docs = new Map<string, string>();
    private readonly reportedFrames = new Set<string>();
    private readonly source = buildBrowserDemoCaptureSource();

    constructor(private readonly view: Pick<BrowserHostedView, 'cdp' | 'waitForControlReady'>, private readonly sink: BrowserDemoTabSink, private readonly pollMs = BROWSER_DEMO_POLL_MS) {}

    /** Install and prove the script runs in the main frame; throws `BrowserDemoUnavailableError` when it cannot. */
    async start(): Promise<void> {
        const cdp = this.view.cdp?.bind(this.view);
        if (!cdp) throw new BrowserDemoUnavailableError('engine-unsupported', 'This browser engine cannot run the demo recorder.');
        const generation = ++this.generation;
        const readiness = new AbortController();
        this.readiness = readiness;
        try {
            await this.view.waitForControlReady?.(readiness.signal);
            if (readiness.signal.aborted || generation !== this.generation) return;
            this.readiness = undefined;
            await cdp('Page.enable', {});
            const added = await cdp('Page.addScriptToEvaluateOnNewDocument', { source: this.source, worldName: BROWSER_DEMO_WORLD, runImmediately: true }) as { identifier?: unknown } | undefined;
            if (typeof added?.identifier === 'string') this.scriptId = added.identifier;
            const frames = await this.frames(cdp);
            const main = frames.find(frame => frame.main);
            if (!main || !await this.drainFrame(cdp, main, this.enabled, generation)) throw new Error('The recorder did not answer in the page.');
        } catch (error) {
            if (readiness.signal.aborted) return;
            this.readiness = undefined;
            await this.stop(false);
            if (error instanceof BrowserDemoUnavailableError) throw error;
            throw new BrowserDemoUnavailableError('handshake-failed', `The demo recorder could not start in this tab: ${error instanceof Error ? error.message : String(error)}`);
        }
        if (generation !== this.generation) {
            await this.stop(false);
            return;
        }
        this.timer = setInterval(() => { void this.poll(); }, this.pollMs);
        this.timer.unref?.();
    }

    /** Paused documents stop queueing; anything queued meanwhile is drained and dropped. */
    setEnabled(enabled: boolean): void {
        if (this.enabled !== enabled) {
            this.discardQueued = true;
            this.enableRevision++;
        }
        this.enabled = enabled;
    }

    poll(): Promise<void> {
        const cdp = this.view.cdp?.bind(this.view);
        if (!cdp || !this.timer) return Promise.resolve();
        if (this.polling) return this.polling;
        const generation = this.generation;
        this.polling = this.collect(cdp, generation).finally(() => { this.polling = undefined; });
        return this.polling;
    }

    /** Stop capture; with `flush` the last queued actions are collected first so a final click is kept. */
    async stop(flush = true): Promise<void> {
        if (this.readiness) {
            this.readiness.abort(new Error('Demo capture stopped before the page became ready.'));
            this.readiness = undefined;
            ++this.generation;
            if (flush) this.sink.gap('capture-failed');
            return;
        }
        if (this.timer) clearInterval(this.timer);
        this.timer = undefined;
        const cdp = this.view.cdp?.bind(this.view);
        await this.polling?.catch(() => {});
        if (flush) {
            if (cdp) await this.collect(cdp, this.generation);
            else this.sink.gap('capture-failed');
        }
        const generation = ++this.generation;
        if (!cdp) return;
        const scriptId = this.scriptId;
        this.scriptId = undefined;
        if (scriptId) await cdp('Page.removeScriptToEvaluateOnNewDocument', { identifier: scriptId }).catch(() => {});
        // Documents that stay open keep the script but stop queueing.
        const frames = await this.frames(cdp).catch(() => [] as Frame[]);
        for (const frame of frames) await this.drainFrame(cdp, frame, false, generation, false).catch(() => {});
    }

    private async collect(cdp: Cdp, generation: number): Promise<void> {
        const revision = this.enableRevision;
        if (this.discardQueued) {
            this.discardQueued = false;
            await this.pollFrames(cdp, generation, false, revision);
        }
        await this.pollFrames(cdp, generation, this.enabled, revision);
    }

    private async pollFrames(cdp: Cdp, generation: number, enabled: boolean = this.enabled, revision = this.enableRevision): Promise<void> {
        let frames: Frame[];
        try { frames = await this.frames(cdp); } catch {
            if (generation === this.generation && revision === this.enableRevision) this.sink.gap('capture-failed');
            return;
        }
        for (const frame of frames) {
            if (generation !== this.generation || revision !== this.enableRevision) return;
            try { await this.drainFrame(cdp, frame, enabled, generation, true, revision); } catch {
                if (generation !== this.generation || revision !== this.enableRevision) return;
                if (frame.main) this.sink.gap('capture-failed');
                else if (!this.reportedFrames.has(frame.id)) {
                    this.reportedFrames.add(frame.id);
                    this.sink.gap('frame-unavailable');
                }
            }
        }
    }

    private async frames(cdp: Cdp): Promise<Frame[]> {
        const reply = await cdp('Page.getFrameTree', {}) as { frameTree?: unknown } | undefined;
        const frames: Frame[] = [];
        let overflow = false;
        const visit = (node: unknown, main: boolean) => {
            const record = node as { frame?: { id?: unknown }; childFrames?: unknown } | undefined;
            const id = record?.frame?.id;
            if (typeof id !== 'string' || id.length > 128) return;
            if (frames.length >= BROWSER_DEMO_FRAME_LIMIT) { overflow = true; return; }
            frames.push({ id, main });
            if (Array.isArray(record?.childFrames)) for (const child of record.childFrames) visit(child, false);
        };
        visit(reply?.frameTree, true);
        if (!frames.length) throw new Error('The page has no main frame.');
        if (overflow && !this.reportedFrames.has('*')) {
            this.reportedFrames.add('*');
            this.sink.gap('frame-unavailable');
        }
        return frames;
    }

    /** Returns false when the frame's world never answers. */
    private async drainFrame(cdp: Cdp, frame: Frame, enabled: boolean, generation: number, deliver = true, revision = this.enableRevision): Promise<boolean> {
        const world = await cdp('Page.createIsolatedWorld', { frameId: frame.id, worldName: BROWSER_DEMO_WORLD }) as { executionContextId?: unknown } | undefined;
        const contextId = world?.executionContextId;
        if (typeof contextId !== 'number') throw new Error('No isolated world for the frame.');
        const evaluate = async (expression: string) => {
            const reply = await cdp('Runtime.evaluate', { expression, contextId, returnByValue: true }) as { result?: { value?: unknown }; exceptionDetails?: unknown } | undefined;
            if (reply?.exceptionDetails) throw new Error('The recorder script failed in the page.');
            return reply?.result?.value;
        };
        let value = await evaluate(drainExpression(enabled));
        const lostScript = value === null || value === undefined;
        if (lostScript) {
            // A document this tab already drained lost its script: actions there may be missing.
            if (this.docs.has(frame.id) && generation === this.generation && revision === this.enableRevision && deliver) this.sink.gap('capture-failed');
            await evaluate(this.source);
            value = await evaluate(drainExpression(enabled));
        }
        const drained = parseDrain(value);
        if (!drained) throw new Error('The recorder returned an invalid reply.');
        if (generation !== this.generation || revision !== this.enableRevision || !deliver) return true;
        if (enabled && !lostScript && this.docs.has(frame.id) && this.docs.get(frame.id) !== drained.doc) {
            this.sink.gap('capture-failed');
        }
        this.docs.set(frame.id, drained.doc);
        if (!enabled) return true;
        const actions: BrowserDemoAction[] = [];
        let invalid = 0;
        for (const item of drained.items) {
            const action = sanitizeDemoObservation(item);
            if (action) actions.push(action); else invalid++;
        }
        if (actions.length) this.sink.actions(actions);
        if (drained.dropped > 0) this.sink.gap('rate-limit');
        if (invalid > 0) this.sink.gap('capture-failed');
        return true;
    }
}

function parseDrain(value: unknown): { doc: string; items: unknown[]; dropped: number } | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const { doc, items, dropped } = value as Record<string, unknown>;
    if (typeof doc !== 'string' || doc.length > 32 || !Array.isArray(items) || items.length > BROWSER_DEMO_QUEUE_LIMIT) return undefined;
    return { doc, items, dropped: typeof dropped === 'number' && Number.isFinite(dropped) ? dropped : 0 };
}
