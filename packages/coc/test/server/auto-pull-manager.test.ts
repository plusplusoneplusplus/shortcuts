/**
 * AutoPullManager — timer arming, restart anchoring, live re-arm, dispose.
 *
 * Timers are driven through an injected fake API, so nothing here waits on a
 * real clock: `fire()` invokes the handler the manager armed.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    AutoPullManager,
    type AutoPullPreference,
    type AutoPullTimerApi,
    type AutoPullWorkspace,
} from '../../src/server/git/auto-pull-manager';
import {
    writeAutoPullState,
    OVERDUE_FIRST_TICK_DELAY_MS,
    OVERDUE_STAGGER_STEP_MS,
} from '../../src/server/git/auto-pull-state';

const MINUTE_MS = 60_000;

interface FakeTimer {
    id: number;
    handler: () => void;
    ms: number;
    cleared: boolean;
    fired: boolean;
    unrefCalls: number;
}

/** Records every armed timer so tests can assert delays and fire handlers. */
class FakeTimerApi implements AutoPullTimerApi {
    readonly armed: FakeTimer[] = [];
    private nextId = 1;

    setTimeout(handler: () => void, ms: number): unknown {
        const timer: FakeTimer = { id: this.nextId++, handler, ms, cleared: false, fired: false, unrefCalls: 0 };
        this.armed.push(timer);
        // Node's handles expose `unref`; the manager must call it on real ones.
        return Object.assign(timer, { unref: () => { timer.unrefCalls++; } });
    }

    clearTimeout(timer: unknown): void {
        (timer as FakeTimer).cleared = true;
    }

    /** Timers still pending (armed, not cleared, not yet fired), oldest first. */
    get pending(): FakeTimer[] {
        return this.armed.filter(t => !t.cleared && !t.fired);
    }

    /** Fire the nth pending timer, the way the event loop would. */
    fire(index = 0): void {
        const timer = this.pending[index];
        timer.fired = true;
        timer.handler();
    }
}

describe('AutoPullManager', () => {
    let dataDir: string;
    let timerApi: FakeTimerApi;
    let nowMs: number;
    let prefs: Map<string, AutoPullPreference | undefined>;
    let workspaces: AutoPullWorkspace[];
    let runTick: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'auto-pull-manager-'));
        timerApi = new FakeTimerApi();
        nowMs = Date.parse('2026-08-29T12:00:00.000Z');
        prefs = new Map();
        workspaces = [];
        runTick = vi.fn(async () => undefined);
    });

    afterEach(() => {
        fs.rmSync(dataDir, { recursive: true, force: true });
    });

    function makeManager(overrides: Partial<ConstructorParameters<typeof AutoPullManager>[0]> = {}) {
        return new AutoPullManager({
            dataDir,
            listWorkspaces: async () => workspaces,
            readAutoPullPreference: id => prefs.get(id),
            runTick: runTick as unknown as (ws: AutoPullWorkspace) => Promise<unknown>,
            timerApi,
            now: () => nowMs,
            logError: () => { /* silence */ },
            ...overrides,
        });
    }

    function addWorkspace(id: string, pref?: AutoPullPreference): AutoPullWorkspace {
        const ws = { id, rootPath: `/repos/${id}` };
        workspaces.push(ws);
        prefs.set(id, pref);
        return ws;
    }

    // ---- AC-01: arming -----------------------------------------------------

    it('arms a timer only for workspaces with auto-pull enabled', async () => {
        addWorkspace('on', { enabled: true, intervalMinutes: 30 });
        addWorkspace('off', { enabled: false, intervalMinutes: 30 });
        addWorkspace('none');

        const manager = makeManager();
        await manager.startAll();

        expect(manager.armedCount).toBe(1);
        expect(manager.isArmed('on')).toBe(true);
        expect(manager.isArmed('off')).toBe(false);
        expect(manager.isArmed('none')).toBe(false);
        expect(timerApi.pending).toHaveLength(1);
        expect(timerApi.pending[0].ms).toBe(30 * MINUTE_MS);
    });

    it.each([
        ['zero', 0],
        ['negative', -5],
        ['non-integer', 2.5],
        ['absent', undefined],
        ['non-numeric', '30'],
    ])('arms no timer for an %s intervalMinutes', async (_label, intervalMinutes) => {
        addWorkspace('ws', { enabled: true, intervalMinutes });

        const manager = makeManager();
        await manager.startAll();

        expect(manager.armedCount).toBe(0);
        expect(timerApi.pending).toHaveLength(0);
    });

    it('unrefs armed handles so auto-pull alone cannot keep the process alive', async () => {
        addWorkspace('ws', { enabled: true, intervalMinutes: 10 });
        // No injected timer api here: the default path is the one that has to
        // unref, and it is what the server actually runs with.
        const unref = vi.fn();
        const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout')
            .mockImplementation(() => ({ unref }) as unknown as ReturnType<typeof setTimeout>);

        const manager = new AutoPullManager({
            dataDir,
            listWorkspaces: async () => workspaces,
            readAutoPullPreference: id => prefs.get(id),
            runTick: async () => undefined,
            now: () => nowMs,
            logError: () => { /* silence */ },
        });
        try {
            await manager.startAll();
            expect(setTimeoutSpy).toHaveBeenCalledTimes(1);
            expect(setTimeoutSpy.mock.calls[0][1]).toBe(10 * MINUTE_MS);
            expect(unref).toHaveBeenCalledTimes(1);
        } finally {
            setTimeoutSpy.mockRestore();
        }
    });

    // ---- AC-01: dispose ----------------------------------------------------

    it('dispose clears every armed timer', async () => {
        addWorkspace('a', { enabled: true, intervalMinutes: 10 });
        addWorkspace('b', { enabled: true, intervalMinutes: 20 });

        const manager = makeManager();
        await manager.startAll();
        expect(manager.armedCount).toBe(2);

        manager.dispose();

        expect(manager.armedCount).toBe(0);
        expect(timerApi.pending).toHaveLength(0);
        expect(timerApi.armed.every(t => t.cleared)).toBe(true);
    });

    it('a tick already in flight when dispose runs does not re-arm', async () => {
        addWorkspace('ws', { enabled: true, intervalMinutes: 10 });
        let release: () => void = () => { /* set below */ };
        runTick.mockImplementation(() => new Promise<void>(resolve => { release = resolve; }));

        const manager = makeManager();
        await manager.startAll();
        timerApi.fire();
        manager.dispose();
        release();
        await Promise.resolve();
        await Promise.resolve();

        expect(manager.armedCount).toBe(0);
        expect(timerApi.pending).toHaveLength(0);
    });

    // ---- AC-03: restart anchoring -----------------------------------------

    it('schedules a near-immediate tick when the last run is older than the interval', async () => {
        addWorkspace('ws', { enabled: true, intervalMinutes: 8 * 60 });
        writeAutoPullState(dataDir, 'ws', {
            lastRunAt: new Date(nowMs - 9 * 60 * MINUTE_MS).toISOString(),
            outcome: 'success',
        });

        const manager = makeManager();
        await manager.startAll();

        expect(timerApi.pending[0].ms).toBe(OVERDUE_FIRST_TICK_DELAY_MS);
    });

    it('schedules the remainder of the interval when the last run is recent', async () => {
        addWorkspace('ws', { enabled: true, intervalMinutes: 8 * 60 });
        writeAutoPullState(dataDir, 'ws', {
            lastRunAt: new Date(nowMs - 60 * MINUTE_MS).toISOString(),
            outcome: 'success',
        });

        const manager = makeManager();
        await manager.startAll();

        expect(timerApi.pending[0].ms).toBe(7 * 60 * MINUTE_MS);
    });

    it('staggers overdue repos but not repos waiting out an interval', async () => {
        for (const id of ['overdue-a', 'fresh', 'overdue-b']) {
            addWorkspace(id, { enabled: true, intervalMinutes: 60 });
        }
        const overdueAt = new Date(nowMs - 120 * MINUTE_MS).toISOString();
        writeAutoPullState(dataDir, 'overdue-a', { lastRunAt: overdueAt, outcome: 'success' });
        writeAutoPullState(dataDir, 'overdue-b', { lastRunAt: overdueAt, outcome: 'success' });
        writeAutoPullState(dataDir, 'fresh', {
            lastRunAt: new Date(nowMs - 10 * MINUTE_MS).toISOString(),
            outcome: 'success',
        });

        const manager = makeManager();
        await manager.startAll();

        const delays = timerApi.pending.map(t => t.ms);
        expect(delays).toEqual([
            OVERDUE_FIRST_TICK_DELAY_MS,
            50 * MINUTE_MS,
            OVERDUE_FIRST_TICK_DELAY_MS + OVERDUE_STAGGER_STEP_MS,
        ]);
    });

    it('treats a corrupt state file as never-run and waits a full interval', async () => {
        addWorkspace('ws', { enabled: true, intervalMinutes: 15 });
        fs.mkdirSync(path.join(dataDir, 'repos', 'ws'), { recursive: true });
        fs.writeFileSync(path.join(dataDir, 'repos', 'ws', 'auto-pull-state.json'), '{ not json', 'utf-8');

        const manager = makeManager();
        await manager.startAll();

        expect(timerApi.pending[0].ms).toBe(15 * MINUTE_MS);
    });

    // ---- ticking and re-arming --------------------------------------------

    it('runs the tick and re-arms a full interval out', async () => {
        const ws = addWorkspace('ws', { enabled: true, intervalMinutes: 10 });

        const manager = makeManager();
        await manager.startAll();
        timerApi.fire();
        await Promise.resolve();
        await Promise.resolve();

        expect(runTick).toHaveBeenCalledWith(ws);
        expect(timerApi.pending).toHaveLength(1);
        expect(timerApi.pending[0].ms).toBe(10 * MINUTE_MS);
        expect(manager.armedCount).toBe(1);
    });

    it('keeps the timer armed when a tick rejects', async () => {
        addWorkspace('ws', { enabled: true, intervalMinutes: 10 });
        runTick.mockRejectedValue(new Error('boom'));

        const manager = makeManager();
        await manager.startAll();
        timerApi.fire();
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();

        expect(manager.isArmed('ws')).toBe(true);
        expect(timerApi.pending).toHaveLength(1);

        // ...and the next tick still fires.
        timerApi.fire();
        expect(runTick).toHaveBeenCalledTimes(2);
    });

    it('does not re-arm after a tick if auto-pull was turned off meanwhile', async () => {
        addWorkspace('ws', { enabled: true, intervalMinutes: 10 });
        runTick.mockImplementation(async () => {
            prefs.set('ws', { enabled: false, intervalMinutes: 10 });
        });

        const manager = makeManager();
        await manager.startAll();
        timerApi.fire();
        await Promise.resolve();
        await Promise.resolve();

        expect(manager.armedCount).toBe(0);
    });

    // ---- AC-04: live re-arm ------------------------------------------------

    it('re-arms with the new period and leaves no second timer behind', async () => {
        addWorkspace('ws', { enabled: true, intervalMinutes: 10 });

        const manager = makeManager();
        await manager.startAll();
        prefs.set('ws', { enabled: true, intervalMinutes: 45 });
        await manager.configureWorkspace('ws');

        expect(manager.armedCount).toBe(1);
        expect(timerApi.pending).toHaveLength(1);
        expect(timerApi.pending[0].ms).toBe(45 * MINUTE_MS);
    });

    it('clears the timer when auto-pull is toggled off', async () => {
        addWorkspace('ws', { enabled: true, intervalMinutes: 10 });

        const manager = makeManager();
        await manager.startAll();
        prefs.set('ws', { enabled: false, intervalMinutes: 10 });
        await manager.configureWorkspace('ws');

        expect(manager.isArmed('ws')).toBe(false);
        expect(timerApi.pending).toHaveLength(0);
    });

    it('leaves the countdown alone when the interval is unchanged', async () => {
        addWorkspace('ws', { enabled: true, intervalMinutes: 10 });

        const manager = makeManager();
        await manager.startAll();
        const armedFirst = timerApi.pending[0];
        nowMs += 5 * MINUTE_MS;
        await manager.configureWorkspace('ws');

        expect(timerApi.pending).toEqual([armedFirst]);
    });

    it('arms a timer for a workspace whose auto-pull was just enabled', async () => {
        addWorkspace('ws', { enabled: false, intervalMinutes: 10 });

        const manager = makeManager();
        await manager.startAll();
        expect(manager.armedCount).toBe(0);

        prefs.set('ws', { enabled: true, intervalMinutes: 10 });
        await manager.configureWorkspace('ws');

        expect(manager.isArmed('ws')).toBe(true);
    });

    it('clears the timer for a workspace that no longer exists', async () => {
        addWorkspace('ws', { enabled: true, intervalMinutes: 10 });

        const manager = makeManager();
        await manager.startAll();
        workspaces.length = 0;
        await manager.configureWorkspace('ws');

        expect(manager.armedCount).toBe(0);
    });

    // ---- AC-05: status read ------------------------------------------------

    it('reports interval, next run, and the last persisted outcome', async () => {
        addWorkspace('ws', { enabled: true, intervalMinutes: 20 });
        writeAutoPullState(dataDir, 'ws', {
            lastRunAt: new Date(nowMs - 5 * MINUTE_MS).toISOString(),
            outcome: 'skipped-dirty',
            message: 'Skipped: uncommitted changes in the working tree.',
        });

        const manager = makeManager();
        await manager.startAll();

        expect(manager.getStatus('ws')).toEqual({
            enabled: true,
            intervalMinutes: 20,
            nextRunAt: new Date(nowMs + 15 * MINUTE_MS).toISOString(),
            lastRunAt: new Date(nowMs - 5 * MINUTE_MS).toISOString(),
            outcome: 'skipped-dirty',
            message: 'Skipped: uncommitted changes in the working tree.',
        });
    });

    it('reports disabled with no next run when auto-pull is off', async () => {
        addWorkspace('ws', { enabled: false, intervalMinutes: 20 });

        const manager = makeManager();
        await manager.startAll();

        expect(manager.getStatus('ws')).toEqual({ enabled: false, intervalMinutes: 20 });
    });

    // ---- resilience --------------------------------------------------------

    it('survives a workspace listing that throws', async () => {
        const manager = makeManager({ listWorkspaces: async () => { throw new Error('store down'); } });
        await expect(manager.startAll()).resolves.toBeUndefined();
        expect(manager.armedCount).toBe(0);
    });

    it('survives a preferences read that throws', async () => {
        addWorkspace('ws', { enabled: true, intervalMinutes: 10 });
        const manager = makeManager({
            readAutoPullPreference: () => { throw new Error('unreadable'); },
        });

        await expect(manager.startAll()).resolves.toBeUndefined();
        expect(manager.armedCount).toBe(0);
    });
});
