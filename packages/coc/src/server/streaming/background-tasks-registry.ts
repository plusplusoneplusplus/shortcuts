/**
 * BackgroundTasksRegistry — the latest background-task snapshot per process.
 *
 * `onBackgroundTasksChanged` fires only on change (register/settle), and the
 * resulting `background-tasks` process event is a bare EventEmitter fan-out to
 * whoever is listening at that instant. A client that opens the chat later —
 * or reloads the page — therefore never learns that the turn is parked waiting
 * on a long-running background shell.
 *
 * This registry keeps the last snapshot in memory so `handleProcessStream` can
 * replay it on connect, the same way it already replays conversation turns and
 * pending ask-user questions.
 *
 * In-memory on purpose: a background task cannot outlive the server process
 * (the SDK subprocess dies with it), so a persisted snapshot could only ever be
 * wrong after a restart — the process record would still say `running` with
 * nothing actually draining. In-memory state has exactly the right lifetime.
 */

import type { BackgroundTasksInfo } from '@plusplusoneplusplus/forge';

export class BackgroundTasksRegistry {
    /** processId → latest snapshot with at least one active task. */
    private readonly snapshots = new Map<string, BackgroundTasksInfo>();

    /**
     * Store the latest snapshot for a process. A snapshot with nothing active
     * deletes the entry instead of being stored, so "no entry" and "nothing
     * active" are the same state and the map self-drains as turns settle.
     */
    record(processId: string, info: BackgroundTasksInfo): void {
        if (!info || info.backgroundTotalActive <= 0) {
            this.snapshots.delete(processId);
            return;
        }
        this.snapshots.set(processId, info);
    }

    /** Latest snapshot for a process, or undefined when nothing is active. */
    get(processId: string): BackgroundTasksInfo | undefined {
        return this.snapshots.get(processId);
    }

    /** Drop a process's entry. Idempotent leak guard for turn teardown. */
    clear(processId: string): void {
        this.snapshots.delete(processId);
    }

    /** Drop every entry. Test/shutdown helper. */
    dispose(): void {
        this.snapshots.clear();
    }
}

/** Process-wide singleton shared by the executors and the SSE stream handler. */
export const backgroundTasksRegistry = new BackgroundTasksRegistry();
