/**
 * Server-side auto-pull, end to end over real git repositories.
 *
 * Every other auto-pull suite stubs something: the manager stubs the tick, the
 * tick stubs git, the route stubs the manager. This one wires the production
 * composition root (`createAutoPullManager`) to two real clones of a real
 * remote and asserts the behaviour the feature actually promises — that a
 * commit pushed by someone else lands in the working copy with no browser
 * involved, that a dirty tree is skipped instead of pulled, and that a restart
 * resumes the countdown instead of restarting it.
 *
 * These are the mechanics behind AC-05's manual browser demo; only the
 * rendering of the dropdown is left for a human.
 *
 * Timers are captured rather than run, so a 1-minute interval doesn't cost the
 * suite a minute. Everything below the timer — the dirty pre-check, the
 * `GitOperationRunner` job, the `git pull --rebase`, and the persisted run
 * state — is the real thing.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createAutoPullManager } from '../../src/server/git/auto-pull-service';
import { readAutoPullState, writeAutoPullState, type AutoPullOutcome } from '../../src/server/git/auto-pull-state';
import { writeRepoPreferences } from '../../src/server/preferences/repository';
import type { AutoPullManager, AutoPullTimerApi } from '../../src/server/git/auto-pull-manager';
import { safeRmSync } from '../helpers/safe-rm';

const WORKSPACE_ID = 'ws-auto-pull-e2e';
const INTERVAL_MINUTES = 1;
const INTERVAL_MS = INTERVAL_MINUTES * 60_000;

function git(cwd: string, ...args: string[]): string {
    return execFileSync('git', args, { cwd, encoding: 'utf-8' }).trim();
}

/** A captured `setTimeout` that the test fires by hand. */
interface Scheduled { handler: () => void; ms: number }

describe('server-side auto-pull over a real repository', { timeout: 120_000 }, () => {
    let tmpDir: string;
    let dataDir: string;
    let workRoot: string;
    let pusherRoot: string;
    let manager: AutoPullManager | undefined;
    let scheduled: Scheduled[];
    let timerApi: AutoPullTimerApi;

    const processStore = {
        getWorkspaces: async () => [{ id: WORKSPACE_ID, rootPath: workRoot }],
    };

    /** Wait for the tick to persist a terminal outcome. `start()` settles async. */
    async function waitForOutcome(expected: AutoPullOutcome, since?: string): Promise<void> {
        const deadline = Date.now() + 60_000;
        while (Date.now() < deadline) {
            const state = readAutoPullState(dataDir, WORKSPACE_ID);
            if (state && state.outcome === expected && state.lastRunAt !== since) return;
            await new Promise(resolve => setTimeout(resolve, 50));
        }
        const actual = readAutoPullState(dataDir, WORKSPACE_ID);
        throw new Error(`timed out waiting for outcome "${expected}"; last state: ${JSON.stringify(actual)}`);
    }

    /** Fire the most recently armed timer and drop it from the queue. */
    function fireLatestTimer(): void {
        const next = scheduled.pop();
        if (!next) throw new Error('no timer was armed');
        next.handler();
    }

    beforeEach(() => {
        tmpDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'auto-pull-e2e-')));
        dataDir = path.join(tmpDir, 'data');
        fs.mkdirSync(dataDir, { recursive: true });

        // A bare remote, a clone that pushes, and the clone auto-pull watches.
        pusherRoot = path.join(tmpDir, 'pusher');
        const remoteRoot = path.join(tmpDir, 'remote.git');
        fs.mkdirSync(pusherRoot, { recursive: true });
        git(pusherRoot, 'init', '--quiet');
        git(pusherRoot, 'config', 'user.email', 'ralph@example.com');
        git(pusherRoot, 'config', 'user.name', 'Ralph');
        fs.writeFileSync(path.join(pusherRoot, 'tracked.txt'), 'first\n');
        git(pusherRoot, 'add', '.');
        git(pusherRoot, 'commit', '--quiet', '-m', 'initial');
        git(tmpDir, 'init', '--bare', '--quiet', remoteRoot);
        git(pusherRoot, 'remote', 'add', 'origin', remoteRoot);
        git(pusherRoot, 'push', '--quiet', '-u', 'origin', 'HEAD');

        workRoot = path.join(tmpDir, 'work');
        git(tmpDir, 'clone', '--quiet', remoteRoot, workRoot);
        git(workRoot, 'config', 'user.email', 'ralph@example.com');
        git(workRoot, 'config', 'user.name', 'Ralph');

        scheduled = [];
        timerApi = {
            setTimeout: (handler, ms) => {
                const entry: Scheduled = { handler, ms };
                scheduled.push(entry);
                return entry;
            },
            clearTimeout: (timer) => {
                const index = scheduled.indexOf(timer as Scheduled);
                if (index >= 0) scheduled.splice(index, 1);
            },
        };
    });

    afterEach(() => {
        manager?.dispose();
        manager = undefined;
        safeRmSync(tmpDir);
    });

    /** Push a new commit from the other clone — the change auto-pull should find. */
    function pushUpstreamCommit(subject: string): void {
        fs.appendFileSync(path.join(pusherRoot, 'tracked.txt'), `${subject}\n`);
        git(pusherRoot, 'commit', '--quiet', '-am', subject);
        git(pusherRoot, 'push', '--quiet', 'origin', 'HEAD');
    }

    function enableAutoPull(): void {
        writeRepoPreferences(dataDir, WORKSPACE_ID, {
            autoPull: { enabled: true, intervalMinutes: INTERVAL_MINUTES },
        });
    }

    async function startManager(): Promise<void> {
        manager = createAutoPullManager({ dataDir, processStore, timerApi });
        await manager.startAll();
    }

    it('pulls an upstream commit into the working copy with no client involved', async () => {
        enableAutoPull();
        await startManager();
        expect(manager!.isArmed(WORKSPACE_ID)).toBe(true);
        expect(scheduled[0].ms).toBe(INTERVAL_MS);

        pushUpstreamCommit('landed-while-nobody-watched');
        expect(git(workRoot, 'log', '-1', '--format=%s')).toBe('initial');

        fireLatestTimer();
        await waitForOutcome('success');

        expect(git(workRoot, 'log', '-1', '--format=%s')).toBe('landed-while-nobody-watched');

        const status = manager!.getStatus(WORKSPACE_ID);
        expect(status.enabled).toBe(true);
        expect(status.intervalMinutes).toBe(INTERVAL_MINUTES);
        expect(status.outcome).toBe('success');
        expect(Date.parse(status.lastRunAt!)).not.toBeNaN();
        // The tick re-armed itself a full interval out.
        expect(Date.parse(status.nextRunAt!)).toBeGreaterThan(Date.now());
    });

    it('skips a dirty working tree and leaves the local commit untouched', async () => {
        enableAutoPull();
        await startManager();

        pushUpstreamCommit('should-not-land');
        fs.appendFileSync(path.join(workRoot, 'tracked.txt'), 'local edit\n');

        fireLatestTimer();
        await waitForOutcome('skipped-dirty');

        expect(git(workRoot, 'log', '-1', '--format=%s')).toBe('initial');
        const status = manager!.getStatus(WORKSPACE_ID);
        expect(status.outcome).toBe('skipped-dirty');
        expect(status.message).toContain('uncommitted changes');
        // Still scheduled — a skip retries on the next tick.
        expect(manager!.isArmed(WORKSPACE_ID)).toBe(true);
    });

    it('pulls when the only local changes are untracked', async () => {
        enableAutoPull();
        await startManager();

        pushUpstreamCommit('lands-despite-untracked-file');
        fs.writeFileSync(path.join(workRoot, 'scratch.log'), 'not tracked\n');

        fireLatestTimer();
        await waitForOutcome('success');

        expect(git(workRoot, 'log', '-1', '--format=%s')).toBe('lands-despite-untracked-file');
    });

    it('resumes the countdown after a restart instead of waiting a fresh interval', async () => {
        enableAutoPull();
        // 45s into a 60s interval, as if the server had just been restarted.
        writeAutoPullState(dataDir, WORKSPACE_ID, {
            lastRunAt: new Date(Date.now() - 45_000).toISOString(),
            outcome: 'success',
        });

        await startManager();

        expect(scheduled).toHaveLength(1);
        expect(scheduled[0].ms).toBeGreaterThan(0);
        expect(scheduled[0].ms).toBeLessThanOrEqual(16_000);
    });

    it('arms nothing for a repo whose auto-pull preference is off', async () => {
        writeRepoPreferences(dataDir, WORKSPACE_ID, {
            autoPull: { enabled: false, intervalMinutes: INTERVAL_MINUTES },
        });
        await startManager();

        expect(manager!.isArmed(WORKSPACE_ID)).toBe(false);
        expect(scheduled).toHaveLength(0);
        expect(manager!.getStatus(WORKSPACE_ID).enabled).toBe(false);
    });

    it('re-arms live when the preference is toggled on, then clears when toggled off', async () => {
        await startManager();
        expect(scheduled).toHaveLength(0);

        enableAutoPull();
        await manager!.configureWorkspace(WORKSPACE_ID);
        expect(manager!.isArmed(WORKSPACE_ID)).toBe(true);
        expect(scheduled).toHaveLength(1);

        writeRepoPreferences(dataDir, WORKSPACE_ID, {
            autoPull: { enabled: false, intervalMinutes: INTERVAL_MINUTES },
        });
        await manager!.configureWorkspace(WORKSPACE_ID);
        expect(manager!.isArmed(WORKSPACE_ID)).toBe(false);
        expect(scheduled).toHaveLength(0);
    });
});
