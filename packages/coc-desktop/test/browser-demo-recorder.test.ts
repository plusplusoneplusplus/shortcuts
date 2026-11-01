import { afterEach, describe, expect, it, vi } from 'vitest';
import { BROWSER_DEMO_MAX_DRAFTS, BROWSER_DEMO_STATE_CHANNEL, BrowserDemoRecorders, runBrowserDemoCommand, type BrowserDemoCapture, type BrowserDemoTabSource } from '../src/browser-demo-recorder';
import { BrowserDemoUnavailableError, type BrowserDemoTabSink } from '../src/browser-demo-tab-capture';
import type { BrowserDemoAction } from '../src/browser-demo-capture';

const owner = { workspaceId: 'ws-a', processId: 'chat-1', routingRef: 'ws-a' };
const click: BrowserDemoAction = { kind: 'click', role: 'button', label: 'Save', url: 'https://a.test/' };

interface FakeCapture extends BrowserDemoCapture { sink: BrowserDemoTabSink; enabled: boolean; stopped?: boolean; flushed?: boolean }

function harness(options: { failStart?: (viewId: string) => Error | undefined; pendingTabMs?: number; startWait?: Promise<void> | ((viewId: string) => Promise<void>) } = {}) {
    const tabs = new Map<string, BrowserDemoTabSource & { ownerId: number }>();
    const captures = new Map<string, FakeCapture>();
    const send = vi.fn();
    const viewOf = new WeakMap<object, string>();
    const addTab = (viewId: string, extra: Partial<BrowserDemoTabSource> = {}, ownerId = 1) => {
        const view = { cdp: vi.fn(), snapshot: () => ({ viewId, engine: 'electron' as const, url: `https://${viewId}.test/?token=abc`, title: viewId, canGoBack: false, canGoForward: false, loading: false }) };
        viewOf.set(view, viewId);
        tabs.set(`${ownerId}:${viewId}`, { ownerId, view, sessionKey: owner.routingRef, sourceKind: 'url', ...extra });
        return view;
    };
    const recorders = new BrowserDemoRecorders({
        send,
        pendingTabMs: options.pendingTabMs,
        lookup: (ownerId, viewId) => tabs.get(`${ownerId}:${viewId}`),
        capture: (view, sink) => {
            const viewId = viewOf.get(view)!;
            const capture: FakeCapture = {
                sink, enabled: true,
                start: async () => { await (typeof options.startWait === 'function' ? options.startWait(viewId) : options.startWait); const error = options.failStart?.(viewId); if (error) throw error; },
                setEnabled: enabled => { capture.enabled = enabled; },
                stop: async flush => { capture.stopped = true; capture.flushed = flush; },
            };
            captures.set(viewId, capture);
            return capture;
        },
    });
    const states = () => send.mock.calls.filter(([, channel]) => channel === BROWSER_DEMO_STATE_CHANNEL).map(([ownerId, , state]) => ({ ownerId, ...state }));
    return { recorders, addTab, tabs, captures, send, states, viewOf };
}

afterEach(() => vi.useRealTimers());

describe('BrowserDemoRecorders start and ownership', () => {
    it('reports the pending-child bound instead of silently omitting excess tabs', async () => {
        const h = harness();
        h.addTab('root');
        const { id } = await h.recorders.start(1, owner, 'root');
        for (let index = 0; index < 16; index++) expect(h.recorders.reserveChild(1, 'root')).toBeTruthy();
        expect(h.recorders.reserveChild(1, 'root')).toBeUndefined();
        expect(h.recorders.draft(1, id).steps.at(-1)).toMatchObject({ type: 'gap', reason: 'tab-limit' });
        await h.recorders.release(1, id);
    });
    it('reserves a starting owner and revokes a late handshake when its window closes', async () => {
        let finish!: () => void;
        const startWait = new Promise<void>(resolve => { finish = resolve; });
        const h = harness({ startWait });
        h.addTab('t1');
        const starting = h.recorders.start(1, owner, 't1');
        expect(h.recorders.capturing(owner.workspaceId, owner.processId)).toBe(true);
        await expect(h.recorders.start(1, owner, 't1')).rejects.toMatchObject({ reason: 'busy' });
        await h.recorders.closeOwner(1);
        h.tabs.clear();
        finish();
        await expect(starting).rejects.toMatchObject({ reason: 'not-found' });
        expect(h.recorders.unsent()).toEqual([]);
        expect(h.captures.get('t1')!.stopped).toBe(true);
    });
    it('refuses unknown, foreign, file, busy and engine-less tabs without registering a draft', async () => {
        const h = harness();
        h.addTab('foreign', { sessionKey: 'ws-b' });
        h.addTab('file', { sourceKind: 'file' });
        h.addTab('busy', { busy: 'An AI browser turn is using this tab.' });
        h.addTab('engine', { view: { snapshot: () => ({ viewId: 'engine', engine: 'webview2', url: 'https://x.test/', title: '', canGoBack: false, canGoForward: false, loading: false }) } });
        const reason = async (viewId: string, ownerValue: unknown = owner) => {
            const result = await runBrowserDemoCommand(h.recorders, 1, { action: 'start', owner: ownerValue, viewId });
            return result.ok ? 'ok' : result.reason;
        };
        expect(await reason('missing')).toBe('not-found');
        expect(await reason('foreign')).toBe('not-found');
        expect(await reason('file')).toBe('file-preview');
        expect(await reason('busy')).toBe('busy');
        expect(await reason('engine')).toBe('engine-unsupported');
        expect(await reason('missing', { workspaceId: 'w' })).toBe('invalid');
        expect(h.recorders.unsent()).toEqual([]);
    });

    it('reports an unavailable recorder handshake as unavailable and keeps nothing', async () => {
        const h = harness({ failStart: () => new BrowserDemoUnavailableError('handshake-failed', 'no answer') });
        h.addTab('t1');
        expect(await runBrowserDemoCommand(h.recorders, 1, { action: 'start', owner, viewId: 't1' })).toEqual({ ok: false, reason: 'handshake-failed', message: 'no answer' });
        expect(h.recorders.unsent()).toEqual([]);
        expect(h.recorders.capturing(owner.workspaceId, owner.processId)).toBe(false);
    });

    it('reports WebView2 recording unavailable even when its CDP transport works', async () => {
        const h = harness();
        h.addTab('wv2', { view: { cdp: vi.fn(), snapshot: () => ({
            viewId: 'wv2', engine: 'webview2', url: 'https://fixture.test/', title: 'Fixture',
            canGoBack: false, canGoForward: false, loading: false,
        }) } });
        expect(await runBrowserDemoCommand(h.recorders, 1, { action: 'start', owner, viewId: 'wv2' }))
            .toMatchObject({ ok: false, reason: 'engine-unsupported', message: expect.stringContaining('popup opener lineage') });
        expect(h.recorders.unsent()).toEqual([]);
    });

    it('allows one draft per concrete owner, separate drafts for other chats, and a bounded total', async () => {
        const h = harness();
        for (let index = 0; index <= BROWSER_DEMO_MAX_DRAFTS; index++) h.addTab(`t${index}`);
        h.addTab('again');
        const first = await h.recorders.start(1, owner, 't0');
        await expect(h.recorders.start(1, owner, 'again')).rejects.toMatchObject({ reason: 'busy' });
        await expect(h.recorders.start(1, { ...owner, processId: 'chat-x' }, 't0')).rejects.toMatchObject({ reason: 'busy' });
        for (let index = 1; index < BROWSER_DEMO_MAX_DRAFTS; index++) await h.recorders.start(1, { ...owner, processId: `chat-${index + 1}` }, `t${index}`);
        await expect(h.recorders.start(1, { ...owner, processId: 'chat-over' }, `t${BROWSER_DEMO_MAX_DRAFTS}`)).rejects.toMatchObject({ reason: 'limit' });
        expect(first).toMatchObject({ status: 'recording', stepCount: 1, tabCount: 1, viewIds: ['t0'] });
    });

    it('keeps each window to its own drafts', async () => {
        const h = harness();
        h.addTab('t1');
        const { id } = await h.recorders.start(1, owner, 't1');
        expect(await runBrowserDemoCommand(h.recorders, 2, { action: 'pause', id })).toMatchObject({ ok: false, reason: 'not-found' });
        expect(await runBrowserDemoCommand(h.recorders, 2, { action: 'draft', id })).toMatchObject({ ok: false, reason: 'not-found' });
        expect(await runBrowserDemoCommand(h.recorders, 2, { action: 'discard', id })).toMatchObject({ ok: false, reason: 'not-found' });
        expect(await runBrowserDemoCommand(h.recorders, 2, { action: 'list' })).toEqual({ ok: true, drafts: [] });
        expect(h.recorders.unsent(1)).toHaveLength(1);
        expect(h.states().every(state => state.ownerId === 1)).toBe(true);
    });
});

describe('BrowserDemoRecorders capture lifecycle', () => {
    it('starts an explicitly added paused tab with capture disabled', async () => {
        const h = harness();
        h.addTab('t1');
        h.addTab('t2');
        const { id } = await h.recorders.start(1, owner, 't1');
        h.recorders.pause(1, id);
        await h.recorders.addTab(1, id, 't2');
        expect(h.captures.get('t2')!.enabled).toBe(false);
        await h.recorders.release(1, id);
    });

    it.each(['explicit', 'descendant'] as const)('cannot republish a discarded demo after a late %s tab handshake', async kind => {
        let finish!: () => void;
        const wait = new Promise<void>(resolve => { finish = resolve; });
        const h = harness({ startWait: viewId => viewId === 't2' ? wait : Promise.resolve() });
        h.addTab('t1');
        h.addTab('t2');
        const { id } = await h.recorders.start(1, owner, 't1');
        if (kind === 'descendant') h.recorders.reserveChild(1, 't1', 't2');
        const starting = kind === 'explicit' ? h.recorders.addTab(1, id, 't2') : h.recorders.tabReady(1, 't2');
        await h.recorders.release(1, id);
        finish();
        if (kind === 'explicit') await expect(starting).rejects.toMatchObject({ reason: 'not-found' });
        else await starting;
        expect(h.states().at(-1)).toMatchObject({ ended: 'discarded' });
        expect(h.recorders.unsent()).toEqual([]);
        expect(h.captures.get('t2')!.stopped).toBe(true);
    });

    it('rejects mutations while Stop drains its captures', async () => {
        const h = harness();
        h.addTab('t1');
        h.addTab('t2');
        const { id } = await h.recorders.start(1, owner, 't1');
        let finish!: () => void;
        h.captures.get('t1')!.stop = () => new Promise<void>(resolve => { finish = resolve; });
        const stopping = h.recorders.stop(1, id);
        expect(() => h.recorders.pause(1, id)).toThrow('finishing');
        await expect(h.recorders.resume(1, id)).rejects.toMatchObject({ reason: 'busy' });
        await expect(h.recorders.addTab(1, id, 't2')).rejects.toMatchObject({ reason: 'busy' });
        expect(h.recorders.reserveChild(1, 't1')).toBeUndefined();
        await Promise.resolve();
        finish();
        await stopping;
    });

    it('accepts final flushed actions before stopping and reports failed flushes honestly', async () => {
        const h = harness();
        h.addTab('t1');
        h.addTab('t2');
        const { id } = await h.recorders.start(1, owner, 't1');
        await h.recorders.addTab(1, id, 't2');
        h.captures.get('t1')!.stop = async flush => {
            if (flush) h.captures.get('t1')!.sink.actions([click]);
        };
        h.captures.get('t2')!.stop = async () => { throw new Error('Capture transport gone'); };
        const draft = await h.recorders.stop(1, id);
        expect(draft.steps).toContainEqual(expect.objectContaining({ type: 'action', action: click }));
        expect(draft.steps).toContainEqual(expect.objectContaining({ type: 'gap', viewId: 't2', reason: 'capture-failed' }));
        h.captures.get('t1')!.sink.actions([click]);
        expect(h.recorders.draft(1, id).steps).toHaveLength(draft.steps.length);
    });

    it('records actions, sends only counts and ids in live state, and returns the redacted draft on stop', async () => {
        const h = harness();
        h.addTab('t1');
        const { id } = await h.recorders.start(1, owner, 't1');
        h.captures.get('t1')!.sink.actions([click, { ...click, kind: 'type', label: 'Password', sensitive: true }]);
        const live = h.states().at(-1)!;
        expect(live).toMatchObject({ stepCount: 3, tabCount: 1, viewIds: ['t1'] });
        expect(JSON.stringify(h.send.mock.calls)).not.toMatch(/Save|Password|token/);
        const draft = await h.recorders.stop(1, id);
        expect(h.captures.get('t1')).toMatchObject({ stopped: true, flushed: true });
        expect(draft.status).toBe('stopped');
        expect(draft.tabs[0].url).toBe('https://t1.test/?token=…');
        expect(draft.steps.map(step => step.type)).toEqual(['tab-opened', 'action', 'action']);
        expect(h.recorders.capturing(owner.workspaceId, owner.processId)).toBe(false);
    });

    it('blocks AI control for the chat and its tabs only while capturing, including pause', async () => {
        const h = harness();
        h.addTab('t1');
        const { id } = await h.recorders.start(1, owner, 't1');
        expect(h.recorders.capturing('ws-a', 'chat-1')).toBe(true);
        expect(h.recorders.capturing('ws-a', 'chat-2')).toBe(false);
        expect(h.recorders.capturing('ws-b', 'chat-1')).toBe(false);
        expect(h.recorders.recordingTab(1, 't1')).toBe(true);
        expect(h.recorders.recordingTab(2, 't1')).toBe(false);
        h.recorders.pause(1, id, 'scope');
        expect(h.states().at(-1)).toMatchObject({ status: 'paused', pauseReason: 'scope' });
        expect(h.captures.get('t1')!.enabled).toBe(false);
        expect(h.recorders.capturing('ws-a', 'chat-1')).toBe(true);
        await h.recorders.resume(1, id);
        expect(h.captures.get('t1')!.enabled).toBe(true);
        await h.recorders.stop(1, id);
        expect(h.recorders.recordingTab(1, 't1')).toBe(false);
    });

    it('drops late actions from a stopped capture', async () => {
        const h = harness();
        h.addTab('t1');
        const { id } = await h.recorders.start(1, owner, 't1');
        const sink = h.captures.get('t1')!.sink;
        await h.recorders.stop(1, id);
        sink.actions([click]);
        sink.gap('capture-failed');
        expect(h.recorders.draft(1, id).steps).toHaveLength(1);
    });

    it('reopens a stopped draft so new steps append, and frees it on discard or send', async () => {
        const h = harness();
        h.addTab('t1');
        const { id } = await h.recorders.start(1, owner, 't1');
        await h.recorders.stop(1, id);
        const first = h.captures.get('t1');
        await h.recorders.resume(1, id);
        expect(h.captures.get('t1')).not.toBe(first);
        h.captures.get('t1')!.sink.actions([click]);
        expect(h.recorders.draft(1, id)).toMatchObject({ status: 'recording' });
        expect(h.recorders.draft(1, id).steps.map(step => step.type)).toEqual(['tab-opened', 'action']);
        expect(await runBrowserDemoCommand(h.recorders, 1, { action: 'sent', id })).toEqual({ ok: true });
        expect(h.states().at(-1)).toMatchObject({ id, ended: 'sent' });
        expect(h.captures.get('t1')).toMatchObject({ stopped: true, flushed: false });
        expect(h.recorders.unsent()).toEqual([]);
        expect(await runBrowserDemoCommand(h.recorders, 1, { action: 'draft', id })).toMatchObject({ ok: false, reason: 'not-found' });
    });

    it('auto-stops to review when the last captured tab closes and records crashes as gaps', async () => {
        const h = harness();
        h.addTab('t1');
        h.addTab('t2');
        const { id } = await h.recorders.start(1, owner, 't1');
        await h.recorders.addTab(1, id, 't2');
        h.recorders.crashed(1, 't2');
        await h.recorders.tabClosed(1, 't1');
        expect(h.recorders.draft(1, id).status).toBe('recording');
        await h.recorders.tabClosed(1, 't2');
        const draft = h.recorders.draft(1, id);
        expect(draft.status).toBe('stopped');
        expect(draft.incomplete).toBe(true);
        expect(draft.steps.map(step => step.type === 'gap' ? `gap:${step.reason}` : step.type)).toEqual(['tab-opened', 'tab-opened', 'gap:tab-crashed', 'tab-closed', 'tab-closed']);
        expect(draft.tabs[1]).toMatchObject({ addedByUser: true });
    });

    it.each(['root', 'child', 'popup'] as const)('drains final %s actions before revoking membership', async kind => {
        const h = harness();
        h.addTab('root');
        const { id } = await h.recorders.start(1, owner, 'root');
        const viewId = kind === 'root' ? 'root' : kind;
        if (kind === 'child') {
            h.recorders.reserveChild(1, 'root', viewId);
            h.addTab(viewId);
            await h.recorders.tabReady(1, viewId);
        } else if (kind === 'popup') {
            await h.recorders.popupOpened(1, 'root', viewId, h.addTab(viewId));
        }
        const capture = h.captures.get(viewId)!;
        capture.stop = vi.fn(async flush => { if (flush) capture.sink.actions([click]); });
        await h.recorders.tabClosed(1, viewId);
        const draft = h.recorders.draft(1, id);
        expect(draft.steps.filter(step => step.viewId === viewId).map(step => step.type))
            .toEqual(['tab-opened', 'action', 'tab-closed']);
        expect(draft.incomplete).toBe(false);
        expect(capture.stop).toHaveBeenCalledExactlyOnceWith(true);
        capture.sink.actions([click]);
        expect(h.recorders.draft(1, id).steps).toHaveLength(draft.steps.length);
        await h.recorders.release(1, id);
    });

    it('reports a lost closure transport instead of silently omitting final actions', async () => {
        const h = harness();
        h.addTab('root');
        const { id } = await h.recorders.start(1, owner, 'root');
        h.captures.get('root')!.stop = async () => { throw new Error('Transport gone'); };
        await h.recorders.tabClosed(1, 'root');
        const draft = h.recorders.draft(1, id);
        expect(draft.status).toBe('stopped');
        expect(draft.incomplete).toBe(true);
        expect(draft.steps.map(step => step.type === 'gap' ? step.reason : step.type))
            .toEqual(['tab-opened', 'capture-failed', 'tab-closed']);
    });

    it.each(['close-first', 'stop-first'] as const)('shares a pending close drain with duplicate closure and concurrent Stop (%s)', async order => {
        const h = harness();
        h.addTab('root');
        const { id } = await h.recorders.start(1, owner, 'root');
        let finish!: () => void;
        const wait = new Promise<void>(resolve => { finish = resolve; });
        const capture = h.captures.get('root')!;
        capture.stop = vi.fn(async flush => {
            await wait;
            if (flush) capture.sink.actions([click]);
        });
        const first = order === 'close-first' ? h.recorders.tabClosed(1, 'root') : h.recorders.stop(1, id);
        const second = order === 'close-first' ? h.recorders.stop(1, id) : h.recorders.tabClosed(1, 'root');
        const duplicate = h.recorders.tabClosed(1, 'root');
        expect(h.recorders.draft(1, id).tabs[0].closed).toBeUndefined();
        finish();
        await Promise.all([first, duplicate, second]);
        expect(capture.stop).toHaveBeenCalledExactlyOnceWith(true);
        expect(h.recorders.draft(1, id).steps.map(step => step.type)).toEqual(['tab-opened', 'action', 'tab-closed']);
        expect(h.recorders.draft(1, id).status).toBe('stopped');
    });

    it('cannot publish late close actions after the draft is discarded', async () => {
        const h = harness();
        h.addTab('root');
        const { id } = await h.recorders.start(1, owner, 'root');
        let finish!: () => void;
        const wait = new Promise<void>(resolve => { finish = resolve; });
        const capture = h.captures.get('root')!;
        capture.stop = async flush => {
            if (!flush) return;
            await wait;
            capture.sink.actions([click]);
            capture.sink.gap('capture-failed');
        };
        const closing = h.recorders.tabClosed(1, 'root');
        await h.recorders.release(1, id);
        const sent = h.send.mock.calls.length;
        finish();
        await closing;
        expect(h.send).toHaveBeenCalledTimes(sent);
        expect(h.states().at(-1)).toMatchObject({ ended: 'discarded' });
        expect(h.recorders.unsent()).toEqual([]);
    });

    it('releases only the closing window drafts', async () => {
        const h = harness();
        h.addTab('t1', {}, 1);
        h.addTab('t1', {}, 2);
        await h.recorders.start(1, owner, 't1');
        await h.recorders.start(2, owner, 't1');
        await h.recorders.closeOwner(1);
        expect(h.recorders.unsent().map(state => state.viewIds)).toEqual([['t1']]);
        expect(h.recorders.unsent(2)).toHaveLength(1);
        expect(h.states().find(state => state.ownerId === 1 && state.ended)).toMatchObject({ ended: 'discarded' });
    });
});

describe('BrowserDemoRecorders tab lineage', () => {
    it.each([false, true])('retains an authorized descendant after its opener closes (other tab: %s)', async otherTab => {
        const h = harness();
        h.addTab('root');
        const { id } = await h.recorders.start(1, owner, 'root');
        if (otherTab) {
            h.addTab('other');
            await h.recorders.addTab(1, id, 'other');
        }
        const child = h.recorders.reserveChild(1, 'root')!;
        await h.recorders.tabClosed(1, 'root');
        expect(h.recorders.draft(1, id).status).toBe('recording');
        expect(h.recorders.reserveChild(1, 'root')).toBeUndefined();
        h.addTab(child);
        await h.recorders.tabReady(1, child);
        const draft = h.recorders.draft(1, id);
        expect(draft.tabs.find(tab => tab.viewId === child)).toMatchObject({ openerViewId: 'root' });
        expect(draft.incomplete).toBe(false);
        h.captures.get(child)!.sink.actions([click]);
        expect(h.recorders.draft(1, id).steps.at(-1)).toMatchObject({ type: 'action', viewId: child });
        await h.recorders.tabClosed(1, child);
        if (otherTab) await h.recorders.tabClosed(1, 'other');
        expect(h.recorders.draft(1, id).status).toBe('stopped');
    });

    it('keeps an orphaned pending descendant paused when it is adopted', async () => {
        const h = harness();
        h.addTab('root');
        const { id } = await h.recorders.start(1, owner, 'root');
        const child = h.recorders.reserveChild(1, 'root')!;
        h.recorders.pause(1, id);
        await h.recorders.tabClosed(1, 'root');
        h.addTab(child);
        await h.recorders.tabReady(1, child);
        expect(h.recorders.draft(1, id).status).toBe('paused');
        expect(h.captures.get(child)!.enabled).toBe(false);
        await h.recorders.release(1, id);
    });

    it('stops with an explicit gap when the last pending descendant expires after opener closure', async () => {
        vi.useFakeTimers();
        const h = harness({ pendingTabMs: 1_000 });
        h.addTab('root');
        const { id } = await h.recorders.start(1, owner, 'root');
        const child = h.recorders.reserveChild(1, 'root')!;
        await h.recorders.tabClosed(1, 'root');
        expect(h.recorders.draft(1, id).status).toBe('recording');
        await vi.advanceTimersByTimeAsync(1_000);
        const draft = h.recorders.draft(1, id);
        expect(draft.status).toBe('stopped');
        expect(draft.steps.at(-1)).toMatchObject({ type: 'gap', reason: 'tab-not-opened', viewId: 'root' });
        expect(draft.incomplete).toBe(true);
        h.addTab(child);
        await h.recorders.tabReady(1, child);
        expect(h.recorders.draft(1, id).tabs).toHaveLength(1);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('discloses explicit Stop cancellation of authorized pending descendants', async () => {
        const h = harness();
        h.addTab('root');
        const { id } = await h.recorders.start(1, owner, 'root');
        const child = h.recorders.reserveChild(1, 'root')!;
        const draft = await h.recorders.stop(1, id);
        expect(draft.incomplete).toBe(true);
        expect(draft.steps.at(-1)).toMatchObject({ type: 'gap', reason: 'tab-not-opened', viewId: 'root' });
        h.addTab(child);
        await h.recorders.tabReady(1, child);
        expect(h.recorders.draft(1, id).tabs).toHaveLength(1);
    });

    it.each(['foreign-session', 'file', 'busy', 'closed-before-ready'] as const)('discloses failed orphan adoption and stops (%s)', async reason => {
        const h = harness();
        h.addTab('root');
        const { id } = await h.recorders.start(1, owner, 'root');
        const child = h.recorders.reserveChild(1, 'root')!;
        await h.recorders.tabClosed(1, 'root');
        if (reason === 'closed-before-ready') await h.recorders.tabClosed(1, child);
        else {
            h.addTab(child, reason === 'foreign-session' ? { sessionKey: 'ws-b' }
                : reason === 'file' ? { sourceKind: 'file' } : { busy: 'AI input pending' });
            await h.recorders.tabReady(1, child);
        }
        const draft = h.recorders.draft(1, id);
        expect(draft.status).toBe('stopped');
        expect(draft.incomplete).toBe(true);
        expect(draft.steps.at(-1)).toMatchObject({ type: 'gap', reason: 'tab-not-opened', viewId: 'root' });
        expect(h.captures.has(child)).toBe(false);
    });

    it('retains a pending child across foreign-window readiness and releases it on owner teardown', async () => {
        vi.useFakeTimers();
        const h = harness();
        h.addTab('root');
        const { id } = await h.recorders.start(1, owner, 'root');
        const child = h.recorders.reserveChild(1, 'root')!;
        await h.recorders.tabClosed(1, 'root');
        h.addTab(child, {}, 2);
        await h.recorders.tabReady(2, child);
        expect(h.recorders.draft(1, id).status).toBe('recording');
        expect(h.recorders.draft(1, id).tabs).toHaveLength(1);
        expect(vi.getTimerCount()).toBe(1);
        await h.recorders.closeOwner(1);
        expect(h.recorders.unsent()).toEqual([]);
        expect(vi.getTimerCount()).toBe(0);
        h.addTab(child);
        await h.recorders.tabReady(1, child);
        expect(h.recorders.unsent()).toEqual([]);
    });

    it('follows reserved child tabs recursively, never tabs opened by unrecorded tabs', async () => {
        const h = harness();
        h.addTab('root');
        const { id } = await h.recorders.start(1, owner, 'root');
        expect(h.recorders.reserveChild(1, 'stranger')).toBeUndefined();
        const child = h.recorders.reserveChild(1, 'root')!;
        expect(child).toMatch(/^browser-/);
        h.addTab(child);
        await h.recorders.tabReady(1, child);
        const grandchild = h.recorders.reserveChild(1, child, 'browser-fixed')!;
        expect(grandchild).toBe('browser-fixed');
        h.addTab(grandchild);
        await h.recorders.tabReady(1, grandchild);
        h.addTab('unrelated');
        await h.recorders.tabReady(1, 'unrelated');
        const draft = h.recorders.draft(1, id);
        expect(draft.tabs.map(tab => [tab.viewId, tab.openerViewId])).toEqual([['root', undefined], [child, 'root'], [grandchild, child]]);
        h.recorders.switched(1, child);
        h.recorders.switched(1, 'unrelated');
        expect(h.recorders.draft(1, id).steps.filter(step => step.type === 'switch').map(step => step.viewId)).toEqual([child]);
    });

    it('captures popups of captured tabs and keeps a paused recording paused in new tabs', async () => {
        const h = harness();
        h.addTab('root');
        const { id } = await h.recorders.start(1, owner, 'root');
        h.recorders.pause(1, id);
        const popup = h.addTab('popup', {}, 99).valueOf() as never;
        await h.recorders.popupOpened(1, 'root', 'popup', popup);
        await h.recorders.popupOpened(1, 'stranger', 'popup-2', popup);
        const draft = h.recorders.draft(1, id);
        expect(draft.tabs.map(tab => [tab.viewId, tab.openerViewId])).toEqual([['root', undefined], ['popup', 'root']]);
        expect(h.captures.get('popup')!.enabled).toBe(false);
    });

    it('marks a child that never opens, or opens for another owner, as a gap', async () => {
        vi.useFakeTimers();
        const h = harness({ pendingTabMs: 1_000 });
        h.addTab('root');
        const { id } = await h.recorders.start(1, owner, 'root');
        h.recorders.reserveChild(1, 'root');
        vi.advanceTimersByTime(1_000);
        const hijacked = h.recorders.reserveChild(1, 'root')!;
        h.addTab(hijacked, { sessionKey: 'ws-b' });
        await h.recorders.tabReady(1, hijacked);
        const gaps = h.recorders.draft(1, id).steps.filter(step => step.type === 'gap');
        expect(gaps).toEqual([expect.objectContaining({ reason: 'tab-not-opened', viewId: 'root' })]);
        expect(h.recorders.draft(1, id).tabs).toHaveLength(1);
        expect(h.recorders.draft(1, id).incomplete).toBe(true);
    });

    it('keeps a child whose capture fails as an honest gap instead of dropping it silently', async () => {
        const h = harness({ failStart: viewId => viewId === 'root' ? undefined : new Error('world failed') });
        h.addTab('root');
        const { id } = await h.recorders.start(1, owner, 'root');
        const child = h.recorders.reserveChild(1, 'root')!;
        h.addTab(child);
        await h.recorders.tabReady(1, child);
        const draft = h.recorders.draft(1, id);
        expect(draft.tabs).toHaveLength(2);
        expect(draft.steps.at(-1)).toMatchObject({ type: 'gap', reason: 'capture-failed', viewId: child });
    });

    it('refuses explicit adds of tabs from another chat or another recording', async () => {
        const h = harness();
        h.addTab('a');
        h.addTab('b');
        h.addTab('foreign', { sessionKey: 'ws-b' });
        const first = await h.recorders.start(1, owner, 'a');
        const second = await h.recorders.start(1, { ...owner, processId: 'chat-2' }, 'b');
        expect(await runBrowserDemoCommand(h.recorders, 1, { action: 'add-tab', id: first.id, viewId: 'foreign' })).toMatchObject({ ok: false, reason: 'not-found' });
        expect(await runBrowserDemoCommand(h.recorders, 1, { action: 'add-tab', id: first.id, viewId: 'b' })).toMatchObject({ ok: false, reason: 'busy' });
        expect(await runBrowserDemoCommand(h.recorders, 1, { action: 'remove-tab', id: second.id, viewId: 'b' })).toMatchObject({ ok: true });
        expect(h.recorders.draft(1, second.id).status).toBe('stopped');
    });

    it('rejects unknown commands as values', async () => {
        const h = harness();
        expect(await runBrowserDemoCommand(h.recorders, 1, { action: 'replay' })).toMatchObject({ ok: false, reason: 'invalid' });
        expect(await runBrowserDemoCommand(h.recorders, 1, null)).toMatchObject({ ok: false, reason: 'invalid' });
    });
});
