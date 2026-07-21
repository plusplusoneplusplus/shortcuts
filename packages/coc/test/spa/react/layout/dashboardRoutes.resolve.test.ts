/**
 * @vitest-environment jsdom
 *
 * Characterization tests for the dashboard route registry:
 *   - `resolveDashboardRoute` turns one hash into an ordered list of typed
 *     effects (state dispatches + canonical navigations).
 *   - `applyRouteEffects` performs those effects (dispatch / queueDispatch /
 *     replace vs replaceState).
 *
 * These lock the exact route → effect contract that used to live inside the
 * router's imperative `handleHash`, so future route changes cannot silently
 * drift the dispatch order, legacy redirects, or stale-selection clearing.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import {
    resolveDashboardRoute,
    applyRouteEffects,
    type RouteContext,
    type RouteEffect,
    type RouteResolution,
} from '../../../../src/server/spa/client/react/layout/dashboardRoutes';

function makeCtx(overrides: Partial<RouteContext> = {}): RouteContext {
    return {
        queueState: { repoQueueMap: {}, repoHistoryMap: {} } as RouteContext['queueState'],
        selectedRepoId: null,
        repoRouteState: {},
        repoTabState: {},
        getUiLayoutMode: () => 'dev-workflow',
        isSchedulesInSlide: () => false,
        ...overrides,
    };
}

const appActions = (r: RouteResolution) => r.effects.filter((e): e is Extract<RouteEffect, { kind: 'app' }> => e.kind === 'app').map((e) => e.action);
const queueActions = (r: RouteResolution) => r.effects.filter((e): e is Extract<RouteEffect, { kind: 'queue' }> => e.kind === 'queue').map((e) => e.action);
const navigations = (r: RouteResolution) => r.effects.filter((e): e is Extract<RouteEffect, { kind: 'navigate' }> => e.kind === 'navigate');

// ── Top-level tab activation ──────────────────────────────────────────────────

describe('resolveDashboardRoute — top-level activation', () => {
    it('empty hash selects the repos tab and stops', () => {
        const r = resolveDashboardRoute('#', makeCtx());
        expect(r.effects).toEqual([{ kind: 'app', action: { type: 'SET_ACTIVE_TAB', tab: 'repos' } }]);
    });

    it('bare #repos (no id) only activates the repos tab', () => {
        const r = resolveDashboardRoute('#repos', makeCtx());
        expect(r.effects).toEqual([{ kind: 'app', action: { type: 'SET_ACTIVE_TAB', tab: 'repos' } }]);
    });

    it('unknown route produces no effects', () => {
        const r = resolveDashboardRoute('#totally-unknown', makeCtx());
        expect(r.effects).toEqual([]);
    });
});

// ── Repo sub-routes ───────────────────────────────────────────────────────────

describe('resolveDashboardRoute — repo sub-routes', () => {
    it('#repos/ws1/git clears git selection and records the suffix (full effect list)', () => {
        const r = resolveDashboardRoute('#repos/ws1/git', makeCtx());
        expect(r.effects).toEqual([
            { kind: 'app', action: { type: 'SET_ACTIVE_TAB', tab: 'repos' } },
            { kind: 'app', action: { type: 'SET_SELECTED_REPO', id: 'ws1' } },
            { kind: 'app', action: { type: 'RECORD_REPO_ROUTE_SUFFIX', repoId: 'ws1', suffix: '/git' } },
            { kind: 'app', action: { type: 'SET_REPO_SUB_TAB', tab: 'git' } },
            { kind: 'app', action: { type: 'SET_SELECTED_WORKFLOW', name: null } },
            { kind: 'app', action: { type: 'SET_WORKFLOW_RUN_PROCESS', processId: null } },
            { kind: 'app', action: { type: 'SET_GIT_COMMIT_HASH', hash: null } },
            { kind: 'app', action: { type: 'CLEAR_GIT_FILE_PATH' } },
        ]);
    });

    it('#repos/ws1/git/{commit}/{file} selects commit + file', () => {
        const r = resolveDashboardRoute('#repos/ws1/git/abc123/src.ts', makeCtx());
        expect(appActions({ effects: r.effects })).toEqual(
            expect.arrayContaining([
                { type: 'SET_GIT_COMMIT_HASH', hash: 'abc123' },
                { type: 'SET_GIT_FILE_PATH', filePath: 'src.ts' },
            ]),
        );
    });

    it('bare #repos/ws1 expands to the remembered suffix and canonicalizes (replaceState)', () => {
        const ctx = makeCtx({ repoRouteState: { ws1: '/git' } });
        const r = resolveDashboardRoute('#repos/ws1', ctx);
        expect(navigations(r)).toEqual([{ kind: 'navigate', hash: '#repos/ws1/git', mode: 'replaceState' }]);
        // and it continues parsing the expansion (selects the repo + git tab)
        expect(appActions(r)).toEqual(
            expect.arrayContaining([
                { type: 'SET_SELECTED_REPO', id: 'ws1' },
                { type: 'SET_REPO_SUB_TAB', tab: 'git' },
            ]),
        );
    });

    it('bare #repos/ws1 falls back to the default chat tab when nothing is remembered', () => {
        const ctx = makeCtx({ repoTabState: { ws1: 'tasks' } });
        const r = resolveDashboardRoute('#repos/ws1', ctx);
        expect(navigations(r)[0]).toEqual({ kind: 'navigate', hash: '#repos/ws1/tasks', mode: 'replaceState' });
    });

    it('notes route decodes per-segment so an encoded slash survives', () => {
        const r = resolveDashboardRoute('#repos/ws1/notes/a%2Fb/c', makeCtx());
        expect(appActions({ effects: r.effects })).toEqual(
            expect.arrayContaining([{ type: 'SET_SELECTED_NOTE_PATH', notePath: 'a/b/c' }]),
        );
    });

    it('chats route with a task id selects that queue task', () => {
        const r = resolveDashboardRoute('#repos/ws1/chats/task-9', makeCtx());
        expect(queueActions(r)).toEqual([{ type: 'SELECT_QUEUE_TASK', id: 'task-9', repoId: 'ws1' }]);
    });

    it('chats route without an id clears the queue selection', () => {
        const r = resolveDashboardRoute('#repos/ws1/chats', makeCtx());
        expect(queueActions(r)).toEqual([{ type: 'SELECT_QUEUE_TASK', id: null, repoId: 'ws1' }]);
    });

    it('a ralph sub-segment is NOT treated as a task id', () => {
        const r = resolveDashboardRoute('#repos/ws1/chats/ralph/sess1', makeCtx());
        expect(queueActions(r)).toEqual([{ type: 'SELECT_QUEUE_TASK', id: null, repoId: 'ws1' }]);
    });

    it('schedules route selects the schedule id', () => {
        const r = resolveDashboardRoute('#repos/ws1/schedules/sched-1', makeCtx());
        expect(appActions({ effects: r.effects })).toEqual(
            expect.arrayContaining([{ type: 'SET_SELECTED_SCHEDULE', id: 'sched-1' }]),
        );
    });

    it('schedules-in-slide flag mounts the chat surface instead of the schedules sub-tab', () => {
        const ctx = makeCtx({ isSchedulesInSlide: () => true, getUiLayoutMode: () => 'classic' });
        const r = resolveDashboardRoute('#repos/ws1/schedules/sched-1', ctx);
        expect(appActions({ effects: r.effects })).toEqual(
            expect.arrayContaining([{ type: 'SET_REPO_SUB_TAB', tab: 'activity' }]),
        );
    });

    it('work-item session deep-link populates the work-item deep link', () => {
        const r = resolveDashboardRoute('#repos/ws1/work-items/it1/session/t1', makeCtx());
        expect(appActions({ effects: r.effects })).toEqual(
            expect.arrayContaining([
                { type: 'SET_WORK_ITEM_DEEP_LINK', workItemId: 'it1', sessionTaskId: 't1', commitHash: null, commitFilePath: null },
            ]),
        );
    });

    it('workflows/:name/run/:processId selects the workflow and run process', () => {
        const r = resolveDashboardRoute('#repos/ws1/workflows/wf/run/proc7', makeCtx());
        expect(appActions({ effects: r.effects })).toEqual(
            expect.arrayContaining([
                { type: 'SET_SELECTED_WORKFLOW', name: 'wf' },
                { type: 'SET_WORKFLOW_RUN_PROCESS', processId: 'proc7' },
            ]),
        );
    });
});

// ── Legacy redirects (canonicalization) ───────────────────────────────────────

describe('resolveDashboardRoute — legacy redirects', () => {
    it('#repos/ws1/templates/foo redirects to /workflows/foo via location.replace', () => {
        const r = resolveDashboardRoute('#repos/ws1/templates/foo', makeCtx());
        expect(r.effects).toEqual([
            { kind: 'app', action: { type: 'SET_ACTIVE_TAB', tab: 'repos' } },
            { kind: 'app', action: { type: 'SET_SELECTED_REPO', id: 'ws1' } },
            { kind: 'app', action: { type: 'SET_REPO_SUB_TAB', tab: 'workflows' } },
            { kind: 'navigate', hash: '#repos/ws1/workflows/foo', mode: 'replace' },
        ]);
    });

    it('#repos/ws1/copilot/mcp redirects to /settings/mcp', () => {
        const r = resolveDashboardRoute('#repos/ws1/copilot/mcp', makeCtx());
        expect(navigations(r)).toEqual([{ kind: 'navigate', hash: '#repos/ws1/settings/mcp', mode: 'replace' }]);
        expect(appActions({ effects: r.effects })).toEqual(
            expect.arrayContaining([
                { type: 'SET_REPO_SUB_TAB', tab: 'settings' },
                { type: 'SET_SETTINGS_SECTION', section: 'mcp' },
            ]),
        );
    });

    it('#repos/ws1/info redirects to /settings/info', () => {
        const r = resolveDashboardRoute('#repos/ws1/info', makeCtx());
        expect(navigations(r)).toEqual([{ kind: 'navigate', hash: '#repos/ws1/settings/info', mode: 'replace' }]);
    });

    it('#repos/ws1/settings/display redirects to the admin settings tab', () => {
        const r = resolveDashboardRoute('#repos/ws1/settings/display', makeCtx());
        expect(navigations(r)).toEqual([{ kind: 'navigate', hash: '#admin/settings', mode: 'replace' }]);
        expect(appActions({ effects: r.effects })).toEqual(
            expect.arrayContaining([{ type: 'SET_ADMIN_SUB_TAB', tab: 'settings' }]),
        );
    });

    it('#skills/bundled redirects to #skills/gallery', () => {
        const r = resolveDashboardRoute('#skills/bundled', makeCtx());
        expect(navigations(r)).toEqual([{ kind: 'navigate', hash: '#skills/gallery', mode: 'replace' }]);
    });
});

// ── Process deep-links ────────────────────────────────────────────────────────

describe('resolveDashboardRoute — process deep-links', () => {
    it('resolves a running task to its repo and canonicalizes the chat URL', () => {
        const ctx = makeCtx({
            queueState: {
                repoQueueMap: { ws2: { running: [{ id: 'proc1' }], queued: [], stats: {} } },
                repoHistoryMap: {},
            } as RouteContext['queueState'],
        });
        const r = resolveDashboardRoute('#processes/proc1', ctx);
        expect(r.effects).toEqual([
            { kind: 'app', action: { type: 'SET_ACTIVE_TAB', tab: 'repos' } },
            { kind: 'app', action: { type: 'SET_SELECTED_REPO', id: 'ws2' } },
            { kind: 'app', action: { type: 'SET_REPO_SUB_TAB', tab: 'chats' } },
            { kind: 'queue', action: { type: 'SELECT_QUEUE_TASK', id: 'proc1', repoId: 'ws2' } },
            { kind: 'navigate', hash: '#repos/ws2/chats/proc1', mode: 'replaceState' },
        ]);
    });

    it('legacy #session/{id} is treated as a process deep-link', () => {
        const r = resolveDashboardRoute('#session/proc9', makeCtx({ selectedRepoId: null }));
        // No matching repo (empty queue) and no fallback → only activates repos.
        expect(r.effects).toEqual([{ kind: 'app', action: { type: 'SET_ACTIVE_TAB', tab: 'repos' } }]);
    });
});

// ── Wiki + admin top-level routes ─────────────────────────────────────────────

describe('resolveDashboardRoute — wiki + admin', () => {
    it('#wiki/w1/component/c1 selects the wiki with its browse component', () => {
        const r = resolveDashboardRoute('#wiki/w1/component/c1', makeCtx());
        expect(appActions({ effects: r.effects })).toEqual([
            { type: 'SET_ACTIVE_TAB', tab: 'wiki' },
            { type: 'SELECT_WIKI_WITH_TAB', wikiId: 'w1', tab: 'browse', adminTab: null, componentId: 'c1' },
        ]);
    });

    it('#admin/database resolves the database sub-tab but ignores the ?page query on initial resolve', () => {
        // The router strips ?query before parsing, so page/sort/order default here;
        // the live table reads them from location.hash directly.
        const r = resolveDashboardRoute('#admin/database/processes?page=2&sort=id&order=desc', makeCtx());
        expect(appActions({ effects: r.effects })).toEqual([
            { type: 'SET_ACTIVE_TAB', tab: 'admin' },
            { type: 'SET_ADMIN_SUB_TAB', tab: 'database' },
            { type: 'SET_ADMIN_DB_DEEP_LINK', table: 'processes', page: 1, sort: null, order: null },
        ]);
    });
});

// ── applyRouteEffects ─────────────────────────────────────────────────────────

describe('applyRouteEffects', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('dispatches app and queue effects in order', () => {
        const dispatch = vi.fn();
        const queueDispatch = vi.fn();
        const calls: string[] = [];
        dispatch.mockImplementation((a: any) => calls.push('app:' + a.type));
        queueDispatch.mockImplementation((a: any) => calls.push('queue:' + a.type));

        applyRouteEffects(
            [
                { kind: 'app', action: { type: 'SET_ACTIVE_TAB', tab: 'repos' } },
                { kind: 'queue', action: { type: 'SELECT_QUEUE_TASK', id: 't', repoId: 'r' } },
                { kind: 'app', action: { type: 'SET_SELECTED_REPO', id: 'r' } },
            ],
            { dispatch, queueDispatch },
        );

        expect(calls).toEqual(['app:SET_ACTIVE_TAB', 'queue:SELECT_QUEUE_TASK', 'app:SET_SELECTED_REPO']);
    });

    it('a replace navigation always calls location.replace', () => {
        // jsdom's location.replace is non-configurable, so swap in a fake location.
        const original = window.location;
        const replace = vi.fn();
        Object.defineProperty(window, 'location', {
            configurable: true,
            value: { ...original, replace, hash: original.hash },
        });
        try {
            applyRouteEffects([{ kind: 'navigate', hash: '#repos/ws/workflows', mode: 'replace' }], {
                dispatch: vi.fn(),
                queueDispatch: vi.fn(),
            });
            expect(replace).toHaveBeenCalledWith('#repos/ws/workflows');
        } finally {
            Object.defineProperty(window, 'location', { configurable: true, value: original });
        }
    });

    it('a replaceState navigation runs only when the hash actually changes', () => {
        const stateSpy = vi.spyOn(window.history, 'replaceState');

        window.location.hash = '#repos/ws/git';
        applyRouteEffects([{ kind: 'navigate', hash: '#repos/ws/git', mode: 'replaceState' }], {
            dispatch: vi.fn(),
            queueDispatch: vi.fn(),
        });
        expect(stateSpy).not.toHaveBeenCalled();

        applyRouteEffects([{ kind: 'navigate', hash: '#repos/ws/tasks', mode: 'replaceState' }], {
            dispatch: vi.fn(),
            queueDispatch: vi.fn(),
        });
        expect(stateSpy).toHaveBeenCalledWith(null, '', '#repos/ws/tasks');
    });
});
