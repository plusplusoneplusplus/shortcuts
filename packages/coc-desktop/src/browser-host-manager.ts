import { BrowserHostError, type BrowserEngineHost, type BrowserHostedView } from './browser-host-contract';
import {
    BROWSER_VIEW_CLOSED_CHANNEL, BROWSER_VIEW_DOWNLOAD_CHANNEL, BROWSER_VIEW_NEW_TAB_CHANNEL, BROWSER_VIEW_STATE_CHANNEL,
    isBrowserEngine, isValidBrowserSessionKey, isValidBrowserViewId, validateBrowserUrl,
    type BrowserEngine, type BrowserFailureReason, type BrowserNavAction, type BrowserOpenResult, type BrowserOperationResult, type BrowserPreferences,
} from './browser-view-policy';
import type { HtmlPageBounds } from './html-page-policy';

interface Entry {
    ownerId: number;
    viewId: string;
    sessionKey: string;
    engine: BrowserEngine;
    closed: boolean;
    ready: Promise<BrowserHostedView>;
    view?: BrowserHostedView;
    startupFailed?: boolean;
}

function throwRejected(results: PromiseSettledResult<unknown>[]): void {
    const failed = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
    if (failed) { throw failed.reason; }
}

export interface BrowserManagerOptions {
    hosts: Record<BrowserEngine, BrowserEngineHost>;
    getDefault(): BrowserEngine;
    saveDefault(engine: BrowserEngine): void;
    send(ownerId: number, channel: string, payload: unknown): void;
    changed(): void;
}

export class BrowserHostManager {
    private readonly owners = new Map<number, Map<string, Entry>>();
    private readonly clearing = new Set<BrowserEngine>();
    private disposed = false;

    constructor(private readonly options: BrowserManagerOptions) {}

    private entry(ownerId: number, viewId: unknown): Entry | undefined {
        return isValidBrowserViewId(viewId) ? this.owners.get(ownerId)?.get(viewId) : undefined;
    }

    async preferences(): Promise<BrowserPreferences> {
        const engines = await Promise.all(Object.values(this.options.hosts).map(host => host.availability()));
        return { defaultEngine: this.options.getDefault(), engines, clearing: [...this.clearing] };
    }

    async select(engine: unknown): Promise<BrowserOperationResult> {
        if (!isBrowserEngine(engine)) { return { ok: false, reason: 'bad-engine' }; }
        const availability = await this.options.hosts[engine].availability();
        if (availability.reason === 'unsupported-platform') { return { ok: false, reason: availability.reason, message: availability.message }; }
        try {
            this.options.saveDefault(engine);
            this.options.changed();
            return { ok: true };
        } catch (error) {
            return this.failure(error, 'startup-failed');
        }
    }

    async open(ownerId: number, viewId: unknown, url: unknown, sessionKey: unknown, relatedEngine?: unknown): Promise<BrowserOpenResult> {
        if (!isValidBrowserViewId(viewId)) { return { ok: false, reason: 'bad-id' }; }
        if (!isValidBrowserSessionKey(sessionKey)) { return { ok: false, reason: 'bad-session' }; }
        const check = validateBrowserUrl(url);
        if (!check.ok) { return check; }
        if (relatedEngine !== undefined && !isBrowserEngine(relatedEngine)) { return { ok: false, reason: 'bad-engine' }; }
        let entry = this.entry(ownerId, viewId);
        if (entry && entry.sessionKey !== sessionKey) { return { ok: false, reason: 'bad-session' }; }
        let engine: BrowserEngine;
        try {
            engine = entry?.engine ?? (isBrowserEngine(relatedEngine) ? relatedEngine : this.options.getDefault());
        } catch (error) {
            return this.failure(error, 'startup-failed');
        }
        if (this.disposed || this.clearing.has(engine)) { return { ok: false, engine, reason: 'busy', message: 'Browser data is being cleared. Try again when cleanup finishes.' }; }
        if (!entry) {
            let entries = this.owners.get(ownerId);
            if (!entries) { entries = new Map(); this.owners.set(ownerId, entries); }
            entry = { ownerId, viewId, sessionKey, engine, closed: false, ready: Promise.resolve().then(() => this.create(entry!, check.url)) };
            entries.set(viewId, entry);
        } else if (entry.startupFailed) {
            entry.startupFailed = false;
            entry.ready = Promise.resolve().then(() => this.create(entry!, check.url));
        }
        try {
            const view = await entry.ready;
            if (entry.closed) { return { ok: false, engine, reason: 'not-found' }; }
            this.options.send(ownerId, BROWSER_VIEW_STATE_CHANNEL, view.snapshot());
            return { ok: true, engine };
        } catch (error) {
            // Failed startup keeps its selected engine but permits an explicit open retry.
            entry.startupFailed = true;
            return { ...this.failure(error, 'startup-failed'), engine };
        }
    }

    private async create(entry: Entry, url: string): Promise<BrowserHostedView> {
        if (entry.closed) { throw new BrowserHostError('not-found', 'Browser tab closed during startup.'); }
        const host = this.options.hosts[entry.engine];
        const availability = await host.availability();
        if (!availability.available) { throw new BrowserHostError(availability.reason ?? 'startup-failed', availability.message ?? 'Browser engine unavailable.'); }
        const view = await host.create({ ownerId: entry.ownerId, viewId: entry.viewId, sessionKey: entry.sessionKey, url }, {
            state: state => { if (!entry.closed) { this.options.send(entry.ownerId, BROWSER_VIEW_STATE_CHANNEL, { ...state, engine: entry.engine, viewId: entry.viewId }); } },
            newTab: target => {
                if (!entry.closed && validateBrowserUrl(target).ok) { this.options.send(entry.ownerId, BROWSER_VIEW_NEW_TAB_CHANNEL, { openerViewId: entry.viewId, engine: entry.engine, url: target }); }
            },
            download: event => { if (!entry.closed) { this.options.send(entry.ownerId, BROWSER_VIEW_DOWNLOAD_CHANNEL, event); } },
        });
        if (entry.closed) {
            await view.close();
            throw new BrowserHostError('not-found', 'Browser tab closed during startup.');
        }
        entry.view = view;
        return view;
    }

    async navigate(ownerId: number, viewId: unknown, url: unknown): Promise<BrowserOpenResult> {
        const entry = this.entry(ownerId, viewId);
        if (!entry || entry.closed) { return { ok: false, reason: 'not-found' }; }
        const check = validateBrowserUrl(url);
        if (!check.ok) { return { ...check, engine: entry.engine }; }
        try {
            await (await entry.ready).navigate(check.url);
            return { ok: true, engine: entry.engine };
        } catch (error) { return { ...this.failure(error, 'runtime-crashed'), engine: entry.engine }; }
    }

    async command(ownerId: number, viewId: unknown, command: (view: BrowserHostedView) => void | Promise<void>): Promise<void> {
        const entry = this.entry(ownerId, viewId);
        if (!entry || entry.closed) { return; }
        try {
            const view = await entry.ready;
            if (!entry.closed) { await command(view); }
        } catch (error) {
            if (!entry.closed) { this.options.send(ownerId, BROWSER_VIEW_STATE_CHANNEL, {
                viewId: entry.viewId, engine: entry.engine, url: entry.view?.snapshot().url ?? '', title: '',
                canGoBack: false, canGoForward: false, loading: false,
                error: error instanceof Error ? error.message : String(error), errorCode: this.failure(error, 'runtime-crashed').reason,
            }); }
        }
    }

    nav(ownerId: number, viewId: unknown, action: BrowserNavAction): Promise<void> {
        return this.command(ownerId, viewId, view => view.nav(action));
    }

    bounds(ownerId: number, viewId: unknown, bounds: HtmlPageBounds | null): Promise<void> {
        return this.command(ownerId, viewId, view => view.setBounds(bounds));
    }

    async close(ownerId: number, viewId: unknown, notify = false): Promise<void> {
        const entry = this.entry(ownerId, viewId);
        if (entry) { await this.closeEntry(entry, notify); }
    }

    private async closeEntry(entry: Entry, notify = false): Promise<void> {
        if (!entry || entry.closed) { return; }
        entry.closed = true;
        const current = this.owners.get(entry.ownerId);
        if (current?.get(entry.viewId) === entry) { current.delete(entry.viewId); }
        if (notify) { this.options.send(entry.ownerId, BROWSER_VIEW_CLOSED_CHANNEL, { viewId: entry.viewId, engine: entry.engine }); }
        // Startup is allowed to finish; create() then closes the partial view itself.
        const view = await entry.ready.catch(error => {
            if (!(error instanceof BrowserHostError)) { console.error('[coc-desktop] Browser startup failed while closing:', error); }
            return undefined;
        });
        if (view) { await view.close(); }
    }

    async closeOwner(ownerId: number): Promise<void> {
        const entries = this.owners.get(ownerId);
        this.owners.delete(ownerId);
        const results = await Promise.allSettled([...entries?.values() ?? []].map(entry => this.closeEntry(entry)));
        throwRejected(results);
    }

    async clear(engine: unknown): Promise<BrowserOperationResult> {
        if (this.disposed) { return { ok: false, reason: 'busy', message: 'The desktop browser is shutting down.' }; }
        if (!isBrowserEngine(engine)) { return { ok: false, reason: 'bad-engine' }; }
        if (this.clearing.has(engine)) { return { ok: false, reason: 'busy' }; }
        this.clearing.add(engine);
        this.options.changed();
        try {
            const entries = [...this.owners.values()].flatMap(entries => [...entries.values()]).filter(entry => entry.engine === engine);
            const results = await Promise.allSettled(entries.map(entry => this.close(entry.ownerId, entry.viewId, true)));
            throwRejected(results);
            await this.options.hosts[engine].clearData();
            return { ok: true };
        } catch (error) { return this.failure(error, 'cleanup-failed'); }
        finally { this.clearing.delete(engine); this.options.changed(); }
    }

    async dispose(): Promise<void> {
        this.disposed = true;
        const closed = await Promise.allSettled([...this.owners.keys()].map(id => this.closeOwner(id)));
        const disposed = await Promise.allSettled(Object.values(this.options.hosts).map(host => host.dispose()));
        throwRejected([...closed, ...disposed]);
    }

    private failure(error: unknown, reason: BrowserFailureReason): { ok: false; reason: BrowserFailureReason; message: string } {
        return { ok: false, reason: error instanceof BrowserHostError ? error.reason : reason, message: error instanceof Error ? error.message : String(error) };
    }
}
