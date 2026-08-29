/**
 * createAutoPullManager — composition-root wiring tests.
 *
 * The manager and the tick have their own unit tests with injected deps; this
 * file covers the binding those tests stub out — that the manager really reads
 * workspaces from the process store and `autoPull` from the on-disk per-repo
 * preferences, so a wrong path or a renamed preference key fails here rather
 * than silently arming nothing in production.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createAutoPullManager } from '../../src/server/git/auto-pull-service';
import { writeRepoPreferences } from '../../src/server/preferences/repository';
import type { AutoPullManager } from '../../src/server/git/auto-pull-manager';

describe('createAutoPullManager', () => {
    let tmpDir: string;
    let manager: AutoPullManager | undefined;

    const workspaces = [
        { id: 'repo-on', rootPath: '/tmp/repo-on' },
        { id: 'repo-off', rootPath: '/tmp/repo-off' },
        { id: 'repo-unset', rootPath: '/tmp/repo-unset' },
    ];
    const processStore = { getWorkspaces: async () => workspaces };

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-auto-pull-service-'));
    });

    afterEach(() => {
        manager?.dispose();
        manager = undefined;
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('arms a timer only for repos whose on-disk autoPull preference is enabled', async () => {
        writeRepoPreferences(tmpDir, 'repo-on', { autoPull: { enabled: true, intervalMinutes: 30 } });
        writeRepoPreferences(tmpDir, 'repo-off', { autoPull: { enabled: false, intervalMinutes: 30 } });

        manager = createAutoPullManager({ dataDir: tmpDir, processStore });
        await manager.startAll();

        expect(manager.isArmed('repo-on')).toBe(true);
        expect(manager.isArmed('repo-off')).toBe(false);
        expect(manager.isArmed('repo-unset')).toBe(false);
        expect(manager.armedCount).toBe(1);
    });

    it('reports the preference-backed status for a repo', async () => {
        writeRepoPreferences(tmpDir, 'repo-on', { autoPull: { enabled: true, intervalMinutes: 45 } });

        manager = createAutoPullManager({ dataDir: tmpDir, processStore });
        await manager.startAll();

        const status = manager.getStatus('repo-on');
        expect(status.enabled).toBe(true);
        expect(status.intervalMinutes).toBe(45);
        expect(status.nextRunAt).toBeTruthy();
        expect(manager.getStatus('repo-unset')).toEqual({ enabled: false });
    });

    it('re-arms a single repo when its preference changes, and clears it when disabled', async () => {
        manager = createAutoPullManager({ dataDir: tmpDir, processStore });
        await manager.startAll();
        expect(manager.armedCount).toBe(0);

        writeRepoPreferences(tmpDir, 'repo-on', { autoPull: { enabled: true, intervalMinutes: 10 } });
        await manager.configureWorkspace('repo-on');
        expect(manager.isArmed('repo-on')).toBe(true);
        expect(manager.armedCount).toBe(1);

        writeRepoPreferences(tmpDir, 'repo-on', { autoPull: { enabled: false, intervalMinutes: 10 } });
        await manager.configureWorkspace('repo-on');
        expect(manager.isArmed('repo-on')).toBe(false);
        expect(manager.armedCount).toBe(0);
    });

    it('dispose clears every armed timer', async () => {
        writeRepoPreferences(tmpDir, 'repo-on', { autoPull: { enabled: true, intervalMinutes: 30 } });
        writeRepoPreferences(tmpDir, 'repo-off', { autoPull: { enabled: true, intervalMinutes: 30 } });

        manager = createAutoPullManager({ dataDir: tmpDir, processStore });
        await manager.startAll();
        expect(manager.armedCount).toBe(2);

        manager.dispose();
        expect(manager.armedCount).toBe(0);
    });
});
