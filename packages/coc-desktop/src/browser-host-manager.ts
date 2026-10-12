import { BrowserHostError, type BrowserEngineHost, type BrowserEventSink, type BrowserHostedView, type FilePreviewHost } from './browser-host-contract';
import {
    BROWSER_VIEW_FOCUS_ADDRESS_REQUESTED_CHANNEL, BROWSER_VIEW_OPEN_MENU_REQUESTED_CHANNEL, BROWSER_VIEW_CLOSE_REQUESTED_CHANNEL, BROWSER_VIEW_CLOSED_CHANNEL, BROWSER_VIEW_DOWNLOAD_CHANNEL, BROWSER_VIEW_NEW_TAB_CHANNEL, BROWSER_VIEW_STATE_CHANNEL,
    BROWSER_PAGE_ZOOM, isBrowserPageZoom, isBrowserEngine, isValidBrowserSessionKey, isValidBrowserViewId, toBrowserSource, validateBrowserUrl,
    type BrowserEngine, type BrowserFailureReason, type BrowserNavAction, type BrowserOpenResult, type BrowserOperationResult, type BrowserPreferences,
    type BrowserSourceKind, type BrowserViewState,
} from './browser-view-policy';
import { parseBrowserCookies } from './browser-cookie-import';
import { validateHtmlPagePath, type HtmlPageBounds } from './html-page-policy';
import type { BrowserHistoryStore } from './browser-history';
import { BrowserControlQueue } from './browser-control-queue';
import type { BrowserControlPage } from './browser-control-page';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import type { BrowserCommandRequest, BrowserCommandResult, BrowserControlTab } from '@plusplusoneplusplus/coc-client';
import { BROWSER_CONTROL_REVEAL_CHANNEL, BROWSER_CONTROL_FOCUSED_CHANNEL, validateBrowserCommandRequest } from './browser-control-command';

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
    control?: BrowserControlQueue;
    popout?: boolean;
}

function throwRejected(results: PromiseSettledResult<unknown>[]): void {
    const failed = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
    if (failed) { throw failed.reason; }
}

export interface BrowserManagerOptions {
    history: Pick<BrowserHistoryStore, 'recordVisit' | 'updateTitle' | 'flush' | 'clearEngine'>;
    hosts: Record<BrowserEngine, BrowserEngineHost>;
    /** Local HTML previews: always Electron, isolated from every engine profile and never cleared with them. */
    fileHost: FilePreviewHost;
    getDefault(): BrowserEngine;
    saveDefault(engine: BrowserEngine): void;
    getPageZoom(): number;
    savePageZoom(percent: number): void;
    send(ownerId: number, channel: string, payload: unknown): void;
    changed(): void;
}

export class BrowserHostManager {
    private readonly controlScopes = new Map<number, { workspaceId: string; sessionKey: string }>();
    private readonly owners = new Map<number, Map<string, Entry>>();
    private readonly clearing = new Set<BrowserEngine>();
    private disposed = false;
    private readonly imports = new Map<BrowserEngine, Set<Promise<BrowserOperationResult>>>();
    private zoomUpdate: Promise<unknown> = Promise.resolve();

    constructor(private readonly options: BrowserManagerOptions) {}

    bindControlScope(ownerId: number, workspaceId: unknown, sessionKey: unknown): void {
        if (workspaceId === null && sessionKey === null) { this.controlScopes.delete(ownerId); return; }
        if (typeof workspaceId !== 'string' || !isValidBrowserSessionKey(workspaceId) || !isValidBrowserSessionKey(sessionKey)) throw new TypeError('Invalid browser workspace scope');
        this.controlScopes.set(ownerId, { workspaceId, sessionKey });
    }

    private controlId(entry: Entry): string { return `t${entry.ownerId}:${entry.viewId}`; }

    private scopedEntries(ownerId: number, workspaceId: string): Entry[] {
        const scope = this.controlScopes.get(ownerId);
        if (!scope || scope.workspaceId !== workspaceId) throw new Error('Browser workspace scope changed');
        return [...this.owners.values()].flatMap(entries => [...entries.values()]).filter(entry =>
            !entry.closed && entry.sourceKind === 'url' && entry.sessionKey === scope.sessionKey);
    }

    async executeControl(ownerId: number, input: BrowserCommandRequest, signal?: AbortSignal): Promise<BrowserCommandResult> {
        const request = validateBrowserCommandRequest(input);
        signal?.throwIfAborted();
        let entries = this.scopedEntries(ownerId, request.workspaceId);
        const command = request.command;
        if (command.action === 'tabs') {
            const tabs: BrowserControlTab[] = [];
            for (const entry of entries) {
                const view = await entry.ready;
                signal?.throwIfAborted();
                if (entry.closed) continue;
                const state = view.snapshot();
                if (!validateBrowserUrl(state.url).ok) continue;
                tabs.push({ id: this.controlId(entry), title: state.title, url: state.url, engine: entry.engine });
            }
            return { tabs };
        }
        const target = command.action === 'select' ? command.tab : request.selectedTab;
        let entry = target ? entries.find(entry => this.controlId(entry) === target) : undefined;
        // Select fails closed; open can replace a vanished remembered selection.
        if (target && !entry && command.action !== 'open') throw new Error('Browser tab not found in this workspace');
        if (command.action === 'open' && (command.newTab || !entry)) {
            const viewId = `browser-${randomUUID()}`;
            const scope = this.controlScopes.get(ownerId)!;
            const opened = this.open(ownerId, viewId, command.url!, scope.sessionKey);
            // Publish through the existing unified panel before Electron waits for guest adoption.
            this.options.send(ownerId, BROWSER_CONTROL_REVEAL_CHANNEL, {
                workspaceId: request.workspaceId, processId: request.processId, viewId, url: command.url, routingRef: scope.sessionKey,
            });
            const result = await opened;
            if (!result.ok) throw new Error(result.message ?? result.reason);
            entries = this.scopedEntries(ownerId, request.workspaceId);
            entry = entries.find(entry => entry.ownerId === ownerId && entry.viewId === viewId);
        }
        if (!entry) throw new Error('No browser tab selected; use tabs, select or open');
        const selected = entry;
        if (command.action === 'select' || command.action === 'open') {
            if (selected.popout) await (await selected.ready).focus();
            else this.options.send(selected.ownerId, BROWSER_CONTROL_REVEAL_CHANNEL, {
                workspaceId: request.workspaceId, processId: request.processId, viewId: selected.viewId,
                url: command.action === 'open' ? command.url : selected.view?.snapshot().url, routingRef: selected.sessionKey,
            });
        }
        return this.withControlPage(selected.ownerId, selected.viewId, selected.sessionKey, async (page, activeSignal, view) => {
            this.scopedEntries(ownerId, request.workspaceId);
            switch (command.action) {
                case 'open':
                    if (view.snapshot().url !== command.url) await view.navigate(command.url!);
                    break;
                case 'select': break;
                case 'snapshot': {
                    const snapshot = await page.snapshot({ ref: command.ref, all: command.all });
                    const interactive = command.ref || command.all ? await page.snapshot() : snapshot;
                    return {
                        tab: this.controlId(selected), title: snapshot.title, url: snapshot.url,
                        elements: snapshot.elements, interactiveElements: interactive.elements,
                    };
                }
                case 'read': {
                    const text = await page.read(command.ref);
                    const offset = command.offset ?? 0;
                    return { tab: this.controlId(selected), text: text.slice(offset, offset + 8000), textTotal: text.length };
                }
                case 'eval': return { tab: this.controlId(selected), value: await page.evaluate(command.js!) };
                case 'screenshot': return { tab: this.controlId(selected), image: await page.screenshot(command.ref) };
                case 'click': await page.click(command.ref!); break;
                case 'type': await page.type(command.ref!, command.text!, command.submit); break;
                case 'select_option': await page.selectOption(command.ref!, command.value!); break;
                case 'press': await page.press(command.key!); break;
                case 'scroll': await page.scroll((command.direction ?? 'down') as 'up' | 'down' | 'left' | 'right', command.ref); break;
                case 'navigate': await view.nav(command.direction as 'back' | 'forward' | 'reload'); break;
                case 'wait': await page.wait(command.text ?? command.ms!, activeSignal); break;
            }
            activeSignal.throwIfAborted();
            await view.waitForControlReady?.(activeSignal);
            while (view.snapshot().loading) {
                await delay(25, undefined, { signal: activeSignal });
                activeSignal.throwIfAborted();
            }
            const snapshot = await page.snapshot();
            return { tab: this.controlId(selected), title: snapshot.title, url: snapshot.url, elements: snapshot.elements };
        }, signal);
    }

    private entry(ownerId: number, viewId: unknown): Entry | undefined {
        return isValidBrowserViewId(viewId) ? this.owners.get(ownerId)?.get(viewId) : undefined;
    }

    async preferences(): Promise<BrowserPreferences> {
        const engines = await Promise.all(Object.values(this.options.hosts).map(host => host.availability()));
        return {
            defaultEngine: this.options.getDefault(), engines, clearing: [...this.clearing],
            pageZoom: { percent: this.options.getPageZoom(), min: BROWSER_PAGE_ZOOM.min, max: BROWSER_PAGE_ZOOM.max, step: BROWSER_PAGE_ZOOM.step },
        };
    }

    setPageZoom(percent: unknown): Promise<BrowserOperationResult> {
        if (!isBrowserPageZoom(percent)) { return Promise.resolve({ ok: false, reason: 'invalid' }); }
        const update = this.zoomUpdate.then(async (): Promise<BrowserOperationResult> => {
            if (this.disposed) { return { ok: false, reason: 'busy' }; }
            try {
                this.options.savePageZoom(percent);
                const entries = [...this.owners.values()].flatMap(owner => [...owner.values()]);
                const results = await Promise.allSettled(entries.filter(entry => entry.sourceKind === 'url').map(async entry => {
                    const view = await entry.ready;
                    if (entry.closed) { return; }
                    if (!view.setPageZoom) { throw new BrowserHostError('unsupported', 'Web page zoom is unavailable for this browser engine.'); }
                    await view.setPageZoom(percent);
                }));
                throwRejected(results);
                return { ok: true };
            } catch (error) {
                return this.failure(error, 'runtime-crashed');
            } finally {
                this.options.changed();
            }
        });
        this.zoomUpdate = update;
        return update;
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
        if (entry.sourceKind === 'url') {
            entry.control = new BrowserControlQueue((method, params) => {
                if (entry.closed || this.disposed) throw new BrowserHostError('not-found', 'Browser tab closed');
                if (!entry.view?.cdp) throw new BrowserHostError('unsupported', 'Browser control is unavailable for this view');
                return entry.view.cdp(method, params);
            });
        }
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
        try {
            const view = await entry.ready;
            if (entry.closed) { return { ok: false, engine, reason: 'not-found' }; }
            this.options.send(entry.ownerId, BROWSER_VIEW_STATE_CHANNEL, this.state(entry, view.snapshot()));
            return {
                ok: true, engine, sourceKind: entry.sourceKind,
                ...(view.embed ? { embed: view.embed, src: view.src, partition: view.partition } : {}),
            };
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
        return this.start(entry, sink => host.create({
            ownerId: entry.ownerId, viewId: entry.viewId, sessionKey: entry.sessionKey, url,
            pageZoomPercent: this.options.getPageZoom(),
        }, sink));
    }

    private async start(entry: Entry, create: (sink: BrowserEventSink) => Promise<BrowserHostedView>): Promise<BrowserHostedView> {
        if (entry.closed) { throw new BrowserHostError('not-found', 'Browser tab closed during startup.'); }
        const view = await create({
            state: state => {
                if (entry.closed) return;
                if (state.errorCode === 'runtime-crashed') {
                    entry.control?.cancel(new BrowserHostError('runtime-crashed', state.error || 'Browser tab crashed'));
                }
                this.options.send(entry.ownerId, BROWSER_VIEW_STATE_CHANNEL, this.state(entry, state));
            },
            visited: (url, title) => {
                if (!entry.closed && entry.sourceKind === 'url') {
                    void this.options.history.recordVisit(entry.engine, url, title)
                        .catch(error => console.error('[coc-desktop] Browser history save failed:', error));
                }
            },
            titleUpdated: (url, title) => {
                if (!entry.closed && entry.sourceKind === 'url') {
                    void this.options.history.updateTitle(entry.engine, url, title)
                        .catch(error => console.error('[coc-desktop] Browser history title save failed:', error));
                }
            },
            newTab: target => {
                if (!entry.closed && validateBrowserUrl(target).ok) { this.options.send(entry.ownerId, BROWSER_VIEW_NEW_TAB_CHANNEL, { openerViewId: entry.viewId, engine: entry.engine, url: target }); }
            },
            focusAddressRequested: () => {
                if (!entry.closed) { this.options.send(entry.ownerId, BROWSER_VIEW_FOCUS_ADDRESS_REQUESTED_CHANNEL, { viewId: entry.viewId }); }
            },
            openMenuRequested: () => {
                if (!entry.closed) { this.options.send(entry.ownerId, BROWSER_VIEW_OPEN_MENU_REQUESTED_CHANNEL, { viewId: entry.viewId }); }
            },
            closeRequested: () => {
                if (!entry.closed) { this.options.send(entry.ownerId, BROWSER_VIEW_CLOSE_REQUESTED_CHANNEL, { viewId: entry.viewId }); }
            },
            download: event => { if (!entry.closed) { this.options.send(entry.ownerId, BROWSER_VIEW_DOWNLOAD_CHANNEL, event); } },
            closed: () => { void this.closeEntry(entry, true).catch(error => console.error('[coc-desktop] Browser guest cleanup failed:', error)); },
            controlPopoutOpened: (viewId, view) => {
                if (entry.closed || entry.sourceKind !== 'url' || !isValidBrowserViewId(viewId) || !view.cdp) return;
                const popout: Entry = {
                    ownerId: entry.ownerId, viewId, sessionKey: entry.sessionKey, engine: entry.engine,
                    sourceKind: 'url', closed: false, ready: Promise.resolve(view), view, popout: true,
                };
                popout.control = new BrowserControlQueue((method, params) => {
                    if (popout.closed || this.disposed) throw new Error('Browser popout closed');
                    return view.cdp!(method, params);
                });
                this.owners.get(entry.ownerId)?.set(viewId, popout);
            },
            controlPopoutClosed: viewId => {
                const popout = this.entry(entry.ownerId, viewId);
                if (!popout?.popout) return;
                popout.closed = true;
                popout.control?.cancel(new Error('Browser popout closed'));
                this.owners.get(entry.ownerId)?.delete(viewId);
            },
            controlFocused: () => {
                if (!entry.closed && entry.sourceKind === 'url') this.options.send(entry.ownerId, BROWSER_CONTROL_FOCUSED_CHANNEL, {});
            },
        });
        if (entry.closed) {
            await view.close();
            throw new BrowserHostError('not-found', 'Browser tab closed during startup.');
        }
        entry.view = view;
        if (entry.sourceKind === 'url' && view.setPageZoom) {
            try { await view.setPageZoom(this.options.getPageZoom()); }
            catch (error) { await view.close(); entry.view = undefined; throw error; }
        }
        return view;
    }

    async adopt(ownerId: number, viewId: unknown, guestId: unknown): Promise<BrowserOperationResult> {
        const entry = this.entry(ownerId, viewId);
        if (!entry || entry.closed || typeof guestId !== 'number' || !Number.isSafeInteger(guestId)) { return { ok: false, reason: 'not-found' }; }
        try {
            const view = await entry.ready;
            if (entry.closed || !view.adopt) { return { ok: false, reason: 'not-found' }; }
            await view.adopt(guestId);
            return { ok: true };
        } catch (error) { return this.failure(error, 'not-found'); }
    }

    async importCookies(ownerId: number, viewId: unknown, domain: unknown, input: unknown, relatedEngine?: unknown): Promise<BrowserOperationResult> {
        const entry = this.entry(ownerId, viewId);
        // Null explicitly requests the profile without a page. Unknown view ids never fall back.
        if (viewId !== null && (!entry || entry.closed)) return { ok: false, reason: 'not-found' };
        if (entry && entry.sourceKind !== 'url') return { ok: false, reason: 'unsupported' };
        if (relatedEngine !== undefined && !isBrowserEngine(relatedEngine)) return { ok: false, reason: 'bad-engine' };
        let engine: BrowserEngine;
        try { engine = entry?.engine ?? (isBrowserEngine(relatedEngine) ? relatedEngine : this.options.getDefault()); }
        catch { return { ok: false, reason: 'bad-engine' }; }
        if (this.disposed || this.clearing.has(engine)) return { ok: false, reason: 'busy' };
        let cookies;
        try { cookies = parseBrowserCookies(domain, input); }
        catch (error) { return this.failure(error, 'invalid'); }
        const operation = (async (): Promise<BrowserOperationResult> => {
            try {
                if (entry) {
                    const view = await entry.ready;
                    if (entry.closed || this.disposed) return { ok: false, reason: 'not-found' };
                    if (!view.importCookies) return { ok: false, reason: 'unsupported' };
                    await view.importCookies(cookies);
                } else {
                    const host = this.options.hosts[engine];
                    const availability = await host.availability();
                    if (!availability.available) return { ok: false, reason: availability.reason ?? 'startup-failed', message: availability.message };
                    if (this.disposed) return { ok: false, reason: 'busy' };
                    if (!host.importCookies) return { ok: false, reason: 'unsupported' };
                    await host.importCookies(cookies);
                }
                return { ok: true };
            } catch {
                // Engine errors can contain cookie values. Never return them to the renderer or logs.
                return { ok: false, reason: 'invalid', message: 'Cookie import failed. Some cookies may have been added. Check the fields and retry.' };
            }
        })();
        const pending = this.imports.get(engine) ?? new Set<Promise<BrowserOperationResult>>();
        this.imports.set(engine, pending);
        pending.add(operation);
        try { return await operation; } finally { pending.delete(operation); }
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

    /** Internal main-process control path; unlike UI commands, results and errors reach the caller. */
    async withControlPage<T>(
        ownerId: number, viewId: unknown, sessionKey: unknown,
        operation: (page: BrowserControlPage, signal: AbortSignal, view: BrowserHostedView) => Promise<T>, signal?: AbortSignal,
    ): Promise<T> {
        const entry = this.entry(ownerId, viewId);
        if (!entry || entry.closed || this.disposed) throw new BrowserHostError('not-found', 'Browser tab not found');
        if (!isValidBrowserSessionKey(sessionKey) || entry.sessionKey !== sessionKey) {
            throw new BrowserHostError('bad-session', 'Browser tab belongs to another workspace');
        }
        if (!entry.control) throw new BrowserHostError('unsupported', 'Browser control supports URL tabs only');
        return entry.control.run(async (page, commandSignal) => {
            const view = await entry.ready;
            commandSignal.throwIfAborted();
            if (!view.cdp) throw new BrowserHostError('unsupported', 'Browser control is unavailable for this view');
            await view.waitForControlReady?.(commandSignal);
            while (view.snapshot().loading) await delay(25, undefined, { signal: commandSignal });
            return operation(page, commandSignal, view);
        }, signal);
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
        entry.control?.cancel(new BrowserHostError('not-found', 'Browser tab closed'));
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
        this.controlScopes.delete(ownerId);
        const entries = this.owners.get(ownerId);
        this.owners.delete(ownerId);
        const results = await Promise.allSettled([...entries?.values() ?? []].map(entry => this.closeEntry(entry)));
        throwRejected(results);
    }

    /** A full renderer reload destroys all guests; persisted tab descriptors may reopen fresh views. */
    async reloadOwner(ownerId: number): Promise<void> {
        await this.closeOwner(ownerId);
    }

    async clear(engine: unknown): Promise<BrowserOperationResult> {
        if (this.disposed) { return { ok: false, reason: 'busy', message: 'The desktop browser is shutting down.' }; }
        if (!isBrowserEngine(engine)) { return { ok: false, reason: 'bad-engine' }; }
        if (this.clearing.has(engine)) { return { ok: false, reason: 'busy' }; }
        this.clearing.add(engine);
        this.options.changed();
        try {
            await Promise.all([...this.imports.get(engine) ?? []]);
            const entries = [...this.owners.values()].flatMap(entries => [...entries.values()]).filter(entry => entry.engine === engine && entry.sourceKind === 'url');
            const results = await Promise.allSettled(entries.map(entry => this.close(entry.ownerId, entry.viewId, true)));
            throwRejected(results);
            await this.options.hosts[engine].clearData();
            await this.options.history.clearEngine(engine);
            return { ok: true };
        } catch (error) { return this.failure(error, 'cleanup-failed'); }
        finally { this.clearing.delete(engine); this.options.changed(); }
    }

    async dispose(): Promise<void> {
        this.disposed = true;
        const closed = await Promise.allSettled([...this.owners.keys()].map(id => this.closeOwner(id)));
        const disposed = await Promise.allSettled([...Object.values(this.options.hosts), this.options.fileHost].map(host => host.dispose()));
        const history = await Promise.allSettled([this.options.history.flush()]);
        throwRejected([...closed, ...disposed, ...history]);
    }

    private failure(error: unknown, reason: BrowserFailureReason): { ok: false; reason: BrowserFailureReason; message: string } {
        return { ok: false, reason: error instanceof BrowserHostError ? error.reason : reason, message: error instanceof Error ? error.message : String(error) };
    }
}
