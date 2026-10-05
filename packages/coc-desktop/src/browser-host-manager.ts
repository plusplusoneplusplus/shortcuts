import { BrowserHostError, type BrowserEngineHost, type BrowserEventSink, type BrowserHostedView, type FilePreviewHost } from './browser-host-contract';
import {
    BROWSER_VIEW_CLOSE_REQUESTED_CHANNEL, BROWSER_VIEW_CLOSED_CHANNEL, BROWSER_VIEW_DOWNLOAD_CHANNEL, BROWSER_VIEW_NEW_TAB_CHANNEL, BROWSER_VIEW_STATE_CHANNEL,
    isBrowserEngine, isValidBrowserSessionKey, isValidBrowserViewId, toBrowserSource, validateBrowserUrl,
    type BrowserEngine, type BrowserFailureReason, type BrowserNavAction, type BrowserOpenResult, type BrowserOperationResult, type BrowserPreferences,
    type BrowserSourceKind, type BrowserViewState,
} from './browser-view-policy';
import { validateHtmlPagePath, type HtmlPageBounds } from './html-page-policy';

interface Entry {
    ownerId: number;
    viewId: string;
    sessionKey: string;
    engine: BrowserEngine;
    sourceKind: BrowserSourceKind;
    /** Validated file for `file` views; a different path replaces the view. */
    path?: string;
    closed: boolean;
    ready: Promise<BrowserHostedView>;
    view?: BrowserHostedView;
    startupFailed?: boolean;
    /** A file view kept hidden across a full SPA reload until the reloaded SPA reopens it. */
    detached?: boolean;
}

function throwRejected(results: PromiseSettledResult<unknown>[]): void {
    const failed = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
    if (failed) { throw failed.reason; }
}

export interface BrowserManagerOptions {
    hosts: Record<BrowserEngine, BrowserEngineHost>;
    /** Local HTML previews: always Electron, isolated from every engine profile and never cleared with them. */
    fileHost: FilePreviewHost;
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

    /** Open any source: `file` always goes to the file host, whatever `relatedEngine` says. */
    openSource(ownerId: number, viewId: unknown, source: unknown, sessionKey: unknown, relatedEngine?: unknown): Promise<BrowserOpenResult> {
        const checked = toBrowserSource(source);
        if ('ok' in checked) { return Promise.resolve(checked); }
        return checked.kind === 'file'
            ? this.openFile(ownerId, viewId, checked.path, sessionKey)
            : this.open(ownerId, viewId, checked.url, sessionKey, relatedEngine);
    }

    async open(ownerId: number, viewId: unknown, url: unknown, sessionKey: unknown, relatedEngine?: unknown): Promise<BrowserOpenResult> {
        if (!isValidBrowserViewId(viewId)) { return { ok: false, reason: 'bad-id' }; }
        if (!isValidBrowserSessionKey(sessionKey)) { return { ok: false, reason: 'bad-session' }; }
        const check = validateBrowserUrl(url);
        if (!check.ok) { return check; }
        if (relatedEngine !== undefined && !isBrowserEngine(relatedEngine)) { return { ok: false, reason: 'bad-engine' }; }
        const entry = this.entry(ownerId, viewId);
        if (entry && entry.sessionKey !== sessionKey) { return { ok: false, reason: 'bad-session' }; }
        if (entry && entry.sourceKind !== 'url') { return { ok: false, reason: 'bad-id' }; }
        let engine: BrowserEngine;
        try {
            engine = entry?.engine ?? (isBrowserEngine(relatedEngine) ? relatedEngine : this.options.getDefault());
        } catch (error) {
            return this.failure(error, 'startup-failed');
        }
        if (this.disposed || this.clearing.has(engine)) { return { ok: false, engine, reason: 'busy', message: 'Browser data is being cleared. Try again when cleanup finishes.' }; }
        const create = (e: Entry) => this.createUrl(e, check.url);
        return this.attach(entry ?? this.add({ ownerId, viewId, sessionKey, engine, sourceKind: 'url' }, create), create);
    }

    /** Open a local HTML preview in the file host. The engine preference and cleanup never apply. */
    async openFile(ownerId: number, viewId: unknown, filePath: unknown, sessionKey: unknown): Promise<BrowserOpenResult> {
        if (!isValidBrowserViewId(viewId)) { return { ok: false, reason: 'bad-id' }; }
        if (!isValidBrowserSessionKey(sessionKey)) { return { ok: false, reason: 'bad-session' }; }
        const check = validateHtmlPagePath(filePath);
        if (!check.ok) { return check; }
        let entry = this.entry(ownerId, viewId);
        if (entry && entry.sessionKey !== sessionKey) { return { ok: false, reason: 'bad-session' }; }
        if (entry && entry.sourceKind !== 'file') { return { ok: false, reason: 'bad-id' }; }
        if (this.disposed) { return { ok: false, engine: 'electron', reason: 'busy', message: 'The desktop browser is shutting down.' }; }
        if (entry && entry.path !== check.path) {
            await this.closeEntry(entry);
            entry = undefined;
        }
        const create = (e: Entry) => this.start(e, sink => this.options.fileHost.create({ ownerId, viewId: e.viewId, sessionKey, path: check.path }, sink));
        return this.attach(entry ?? this.add({ ownerId, viewId, sessionKey, engine: 'electron', sourceKind: 'file', path: check.path }, create), create);
    }

    private add(init: Pick<Entry, 'ownerId' | 'viewId' | 'sessionKey' | 'engine' | 'sourceKind' | 'path'>, create: (entry: Entry) => Promise<BrowserHostedView>): Entry {
        let entries = this.owners.get(init.ownerId);
        if (!entries) { entries = new Map(); this.owners.set(init.ownerId, entries); }
        const entry = { ...init, closed: false } as Entry;
        entry.ready = Promise.resolve().then(() => create(entry));
        entries.set(init.viewId, entry);
        return entry;
    }

    /** Start a new or failed view, or replay a live one's state. */
    private async attach(entry: Entry, create: (entry: Entry) => Promise<BrowserHostedView>): Promise<BrowserOpenResult> {
        const engine = entry.engine;
        if (entry.startupFailed) {
            entry.startupFailed = false;
            entry.ready = Promise.resolve().then(() => create(entry));
        }
        entry.detached = false;
        try {
            const view = await entry.ready;
            if (entry.closed) { return { ok: false, engine, reason: 'not-found' }; }
            this.options.send(entry.ownerId, BROWSER_VIEW_STATE_CHANNEL, this.state(entry, view.snapshot()));
            return { ok: true, engine, sourceKind: entry.sourceKind };
        } catch (error) {
            // Failed startup keeps its selected engine but permits an explicit open retry.
            entry.startupFailed = true;
            return { ...this.failure(error, 'startup-failed'), engine };
        }
    }

    private state(entry: Entry, state: BrowserViewState): BrowserViewState {
        return { ...state, engine: entry.engine, viewId: entry.viewId, sourceKind: entry.sourceKind };
    }

    private async createUrl(entry: Entry, url: string): Promise<BrowserHostedView> {
        if (entry.closed) { throw new BrowserHostError('not-found', 'Browser tab closed during startup.'); }
        const host = this.options.hosts[entry.engine];
        const availability = await host.availability();
        if (!availability.available) { throw new BrowserHostError(availability.reason ?? 'startup-failed', availability.message ?? 'Browser engine unavailable.'); }
        return this.start(entry, sink => host.create({ ownerId: entry.ownerId, viewId: entry.viewId, sessionKey: entry.sessionKey, url }, sink));
    }

    private async start(entry: Entry, create: (sink: BrowserEventSink) => Promise<BrowserHostedView>): Promise<BrowserHostedView> {
        if (entry.closed) { throw new BrowserHostError('not-found', 'Browser tab closed during startup.'); }
        const view = await create({
            state: state => { if (!entry.closed) { this.options.send(entry.ownerId, BROWSER_VIEW_STATE_CHANNEL, this.state(entry, state)); } },
            newTab: target => {
                if (!entry.closed && validateBrowserUrl(target).ok) { this.options.send(entry.ownerId, BROWSER_VIEW_NEW_TAB_CHANNEL, { openerViewId: entry.viewId, engine: entry.engine, url: target }); }
            },
            closeRequested: () => {
                if (!entry.closed) { this.options.send(entry.ownerId, BROWSER_VIEW_CLOSE_REQUESTED_CHANNEL, { viewId: entry.viewId }); }
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
        // Previews only move by in-page links that pass the file policy.
        if (entry.sourceKind !== 'url') { return { ok: false, reason: 'unsupported', engine: entry.engine }; }
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
                viewId: entry.viewId, engine: entry.engine, sourceKind: entry.sourceKind, url: entry.view?.snapshot().url ?? '', title: '',
                canGoBack: false, canGoForward: false, loading: false,
                error: error instanceof Error ? error.message : String(error), errorCode: this.failure(error, 'runtime-crashed').reason,
            }); }
        }
    }

    /** Hand a view's current page to the system: an http(s) page for `url` views, the previewed `file:` page for `file` views. */
    openExternal(ownerId: number, viewId: unknown, open: (url: string) => Promise<void>): Promise<void> {
        const sourceKind = this.entry(ownerId, viewId)?.sourceKind;
        return this.command(ownerId, viewId, view => {
            const url = view.snapshot().url;
            if (sourceKind === 'file' ? url.startsWith('file:') : validateBrowserUrl(url).ok) { return open(url); }
        });
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

    /**
     * The owner's SPA did a full reload. URL views close; file views stay live
     * but hidden, so reopening the same view id replays their page, history and
     * scroll. A file view already detached by the previous reload and never
     * reopened since is an orphan and closes.
     */
    async reloadOwner(ownerId: number): Promise<void> {
        const entries = [...this.owners.get(ownerId)?.values() ?? []];
        const results = await Promise.allSettled(entries.map(entry => {
            if (entry.sourceKind !== 'file' || entry.detached) { return this.closeEntry(entry); }
            entry.detached = true;
            return this.command(ownerId, entry.viewId, view => view.setBounds(null));
        }));
        throwRejected(results);
    }

    async clear(engine: unknown): Promise<BrowserOperationResult> {
        if (this.disposed) { return { ok: false, reason: 'busy', message: 'The desktop browser is shutting down.' }; }
        if (!isBrowserEngine(engine)) { return { ok: false, reason: 'bad-engine' }; }
        if (this.clearing.has(engine)) { return { ok: false, reason: 'busy' }; }
        this.clearing.add(engine);
        this.options.changed();
        try {
            const entries = [...this.owners.values()].flatMap(entries => [...entries.values()]).filter(entry => entry.engine === engine && entry.sourceKind === 'url');
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
        const disposed = await Promise.allSettled([...Object.values(this.options.hosts), this.options.fileHost].map(host => host.dispose()));
        throwRejected([...closed, ...disposed]);
    }

    private failure(error: unknown, reason: BrowserFailureReason): { ok: false; reason: BrowserFailureReason; message: string } {
        return { ok: false, reason: error instanceof BrowserHostError ? error.reason : reason, message: error instanceof Error ? error.message : String(error) };
    }
}
