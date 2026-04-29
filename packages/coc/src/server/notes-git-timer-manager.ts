/**
 * NotesGitTimerManager — owns one `NotesAutoCommitTimer` per workspace.
 *
 * Manages the lifecycle of in-process auto-commit timers: start, stop,
 * update interval, and bulk-restore on server startup.
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import type { ProcessStore } from '@plusplusoneplusplus/forge';
import { NotesAutoCommitTimer } from './notes-git-autocommit';
import { getRepoDataPath } from './paths';
import { readRepoPreferences } from './preferences-handler';

/** Default auto-commit interval: 30 minutes. */
export const DEFAULT_AUTOCOMMIT_INTERVAL_MS = 30 * 60 * 1_000;

/**
 * Owns one `NotesAutoCommitTimer` per workspace.
 *
 * Lifecycle:
 *   1. `startForWorkspace(wsId, notesDir, intervalMs)` — start/replace timer.
 *   2. `stopForWorkspace(wsId)` — stop and remove timer.
 *   3. `updateInterval(wsId, notesDir, intervalMs)` — replace with new interval.
 *   4. `startAll(store, dataDir)` — restore timers on server startup.
 *   5. `dispose()` — stop all timers (call on server shutdown).
 */
export class NotesGitTimerManager {
    private timers = new Map<string, NotesAutoCommitTimer>();

    startForWorkspace(wsId: string, notesDir: string, intervalMs: number): void {
        this.stopForWorkspace(wsId);
        const timer = new NotesAutoCommitTimer(notesDir, intervalMs);
        timer.start();
        this.timers.set(wsId, timer);
    }

    stopForWorkspace(wsId: string): void {
        const timer = this.timers.get(wsId);
        if (timer) {
            timer.stop();
            this.timers.delete(wsId);
        }
    }

    updateInterval(wsId: string, notesDir: string, intervalMs: number): void {
        this.startForWorkspace(wsId, notesDir, intervalMs);
    }

    getTimer(wsId: string): NotesAutoCommitTimer | undefined {
        return this.timers.get(wsId);
    }

    /**
     * Read per-repo preferences for every known workspace and start timers for
     * those with `notesGit.autoCommit.enabled = true`. Called once on server startup.
     */
    async startAll(store: ProcessStore, dataDir: string): Promise<void> {
        const workspaces = await store.getWorkspaces();
        for (const ws of workspaces) {
            const prefs = readRepoPreferences(dataDir, ws.id);
            if (prefs.notesGit?.autoCommit?.enabled) {
                const intervalMs = prefs.notesGit.autoCommit.intervalMs ?? DEFAULT_AUTOCOMMIT_INTERVAL_MS;
                const notesDir = getRepoDataPath(dataDir, ws.id, 'notes');
                this.startForWorkspace(ws.id, notesDir, intervalMs);
            }
        }
    }

    /** Stop all running timers. Call during server shutdown. */
    dispose(): void {
        for (const timer of this.timers.values()) {
            timer.stop();
        }
        this.timers.clear();
    }
}
