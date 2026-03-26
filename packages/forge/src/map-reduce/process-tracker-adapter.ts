/**
 * Process Tracker Adapter for Map-Reduce Execution
 *
 * Wraps an optional ProcessTracker with null-safe convenience methods,
 * eliminating repetitive `if (tracker && processId)` guards from the executor.
 */

import type { ProcessTracker, ExecutionStats, SessionMetadata } from './types';

export class ProcessTrackerAdapter {
    constructor(private tracker?: ProcessTracker) {}

    registerGroup(description: string): string | undefined {
        return this.tracker?.registerGroup(description);
    }

    registerProcess(description: string, parentGroupId?: string): string | undefined {
        return this.tracker?.registerProcess(description, parentGroupId);
    }

    /** Mark a process as completed with an optional structured result. */
    completeProcess(processId: string | undefined, output: unknown): void {
        if (!this.tracker || !processId) return;

        let structuredResult: string | undefined;
        try {
            structuredResult = JSON.stringify(output);
        } catch {
            // Ignore serialization errors
        }
        this.tracker.updateProcess(processId, 'completed', undefined, undefined, structuredResult);

        // Attach session metadata if the output contains a sessionId (for session resume)
        if (this.tracker.attachSessionMetadata) {
            const outputWithSession = output as { sessionId?: string };
            if (outputWithSession?.sessionId) {
                this.tracker.attachSessionMetadata(processId, {
                    sessionId: outputWithSession.sessionId,
                    backend: 'copilot-sdk',
                });
            }
        }
    }

    /** Mark a process as failed. */
    failProcess(processId: string | undefined, error: string): void {
        if (!this.tracker || !processId) return;
        this.tracker.updateProcess(processId, 'failed', undefined, error);
    }

    /** Complete a process group with a summary and stats. */
    completeGroup(groupId: string | undefined, summary: string, stats: ExecutionStats): void {
        if (!this.tracker || !groupId) return;
        this.tracker.completeGroup(groupId, summary, stats);
    }
}
