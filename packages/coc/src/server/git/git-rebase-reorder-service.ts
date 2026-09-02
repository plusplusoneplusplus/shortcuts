/**
 * Commit reordering is the one git operation CoC delegates to an AI session:
 * it needs `GIT_SEQUENCE_EDITOR` scripting plus judgement about whether a
 * conflict is trivial enough to auto-resolve. The work is enqueued as an
 * autopilot chat task and the resulting `GitOpJob` is settled from queue events.
 *
 * This service owns the prompt, the queue subscription and its cleanup, and the
 * terminal-state policy — including the outcomes the queue reports as something
 * other than completed/failed (cancelled, removed) and the case where no
 * terminal event ever arrives.
 */

import type { GitOpStatus } from '@plusplusoneplusplus/forge';
import { conflict, missingFields } from '../errors';
import type { GitOperationRunner } from './git-operation-runner';

/** The queue surface this service needs. Mirrors the optional members of `QueueExecutorBridge`. */
export interface RebaseReorderQueueBridge {
    enqueue?(input: any): Promise<string>;
    getTask?(taskId: string): { id: string; status: string } | undefined;
    on?(event: 'queueChange', listener: (event: Record<string, unknown>) => void): void;
    off?(event: 'queueChange', listener: (event: Record<string, unknown>) => void): void;
}

export interface GitRebaseReorderServiceDeps {
    runner: GitOperationRunner;
    bridge?: RebaseReorderQueueBridge;
    /**
     * Fail the job if the queue never reports a terminal outcome within this
     * many milliseconds. Disabled when unset.
     */
    timeoutMs?: number;
}

export interface RebaseReorderTarget {
    id: string;
    rootPath: string;
}

const BROADCAST_REASON = 'rebase-reorder';

/** Queue statuses that end a task, mapped onto the git-op status to persist. */
const TERMINAL_STATUS: Record<string, Exclude<GitOpStatus, 'running'>> = {
    completed: 'success',
    failed: 'failed',
    cancelled: 'interrupted',
};

export class GitRebaseReorderService {
    constructor(private readonly deps: GitRebaseReorderServiceDeps) {}

    /**
     * Enqueue the reorder task and create the tracking job.
     * Returns both IDs so the client can follow either the queue task or the git op.
     */
    async start(ws: RebaseReorderTarget, commits: unknown): Promise<{ taskId: string; jobId: string }> {
        if (!Array.isArray(commits) || commits.length === 0) throw missingFields(['commits']);
        const bridge = this.deps.bridge;
        if (!bridge?.enqueue) throw conflict('Queue bridge is not available for rebase-reorder');

        const runner = this.deps.runner;
        await runner.ensureNotRunning(ws.id, 'rebase-reorder', 'A rebase-reorder operation is already running');

        const hashes = commits as string[];
        const jobId = runner.createJobId('rebase-reorder');
        await runner.createJob({
            id: jobId,
            workspaceId: ws.id,
            op: 'rebase-reorder',
            status: 'running',
            startedAt: new Date().toISOString(),
        });

        let taskId: string;
        try {
            taskId = await bridge.enqueue({
                type: 'chat',
                priority: 'normal',
                displayName: `Reorder ${hashes.length} commit${hashes.length !== 1 ? 's' : ''}`,
                payload: {
                    kind: 'chat',
                    mode: 'autopilot',
                    prompt: buildRebaseReorderPrompt(ws.rootPath, hashes),
                    workingDirectory: ws.rootPath,
                    workspaceId: ws.id,
                },
                config: { retryOnFailure: false },
            });
        } catch (err) {
            // Never leave the job stuck as `running` when the task never made it into the queue.
            await runner.settle(ws.id, jobId, {
                status: 'failed',
                error: err instanceof Error ? err.message : 'Failed to enqueue rebase-reorder task',
                broadcastReason: BROADCAST_REASON,
            });
            throw err;
        }

        this.track(ws.id, jobId, taskId, bridge);
        return { taskId, jobId };
    }

    /**
     * Settle the job when the queue task ends. Subscribes, then re-checks the
     * task's current status so a task that finished before the listener attached
     * is not missed.
     */
    private track(workspaceId: string, jobId: string, taskId: string, bridge: RebaseReorderQueueBridge): void {
        let settled = false;
        let timer: NodeJS.Timeout | undefined;

        const finish = (status: Exclude<GitOpStatus, 'running'>, error?: string): void => {
            if (settled) return;
            settled = true;
            if (timer) clearTimeout(timer);
            bridge.off?.('queueChange', onQueueChange);
            void this.deps.runner.settle(workspaceId, jobId, {
                status,
                error,
                invalidateCache: true,
                broadcastReason: BROADCAST_REASON,
            }).catch(() => { /* status reporting is best-effort; the op itself already ran */ });
        };

        const onQueueChange = (event: Record<string, unknown>): void => {
            const eventTaskId = (event.taskId ?? (event.task as any)?.id) as string | undefined;
            if (eventTaskId !== taskId) return;
            if (event.type === 'removed') {
                finish('interrupted', 'Rebase-reorder task was removed from the queue');
                return;
            }
            if (event.type !== 'updated') return;
            const status = (event.task as any)?.status as string | undefined;
            const terminal = status ? TERMINAL_STATUS[status] : undefined;
            if (!terminal) return;
            finish(terminal, status === 'cancelled' ? 'Rebase-reorder task was cancelled' : undefined);
        };

        bridge.on?.('queueChange', onQueueChange);

        const current = bridge.getTask?.(taskId);
        const alreadyTerminal = current?.status ? TERMINAL_STATUS[current.status] : undefined;
        if (alreadyTerminal) {
            finish(alreadyTerminal, current?.status === 'cancelled' ? 'Rebase-reorder task was cancelled' : undefined);
            return;
        }

        if (this.deps.timeoutMs !== undefined) {
            timer = setTimeout(
                () => finish('failed', 'Rebase-reorder task did not report a result in time'),
                this.deps.timeoutMs,
            );
            // Never hold the process open just to watch a job.
            timer.unref?.();
        }
    }
}

/**
 * Instructions for the autopilot session that performs the reorder.
 * Platform-specific because the sequence-editor helper differs on Windows.
 */
export function buildRebaseReorderPrompt(repoRoot: string, commits: string[]): string {
    const firstCommit = commits[0];
    const pickLines = commits.map(h => `pick ${h}`).join('\n');
    const isWindows = process.platform === 'win32';

    return `You are performing a git commit reorder operation in the repository at: ${repoRoot}

## Objective
Reorder the following commits into this exact sequence (oldest first):
${commits.map((h, i) => `  ${i + 1}. ${h}`).join('\n')}

## Step-by-step Instructions

### 1. Find the base commit
Run: \`git rev-parse ${firstCommit}~1\`
This gives the parent commit to use as the rebase base. Save this value as BASE_COMMIT.

### 2. Prepare the rebase sequence file
Create a temporary directory (e.g. under the OS temp folder) and write a file named \`todo\` containing:
\`\`\`
${pickLines}
\`\`\`

### 3. Create the sequence editor helper script
${isWindows ? `On Windows, create a batch script \`seq-editor.cmd\`:
\`\`\`
@copy /Y "C:\\path\\to\\todo" %1 >nul
\`\`\`
Replace \`C:\\path\\to\\todo\` with the actual absolute path to the todo file.` : `On Unix/Mac, create a shell script \`seq-editor.sh\`:
\`\`\`
#!/bin/sh
cp "/path/to/todo" "$1"
\`\`\`
Replace \`/path/to/todo\` with the actual absolute path to the todo file.
Make it executable: \`chmod +x seq-editor.sh\``}

### 4. Run the interactive rebase
Execute from the repo root (${repoRoot}):
${isWindows ? `\`set GIT_SEQUENCE_EDITOR=C:\\path\\to\\seq-editor.cmd && git -C "${repoRoot}" rebase -i BASE_COMMIT\`` : `\`GIT_SEQUENCE_EDITOR=/path/to/seq-editor.sh git -C "${repoRoot}" rebase -i BASE_COMMIT\``}
Replace BASE_COMMIT with the value from Step 1.

### 5. Check for conflicts
After the rebase command completes, run:
\`git -C "${repoRoot}" status\`

Look for output containing "both modified" or "conflict" to detect merge conflicts.

### 6. Handle conflicts
If conflicts are detected:
- Run \`git -C "${repoRoot}" diff\` to inspect the conflict markers.
- **TRIVIAL conflict** (whitespace-only differences, or non-overlapping hunks where both sides add distinct lines):
  Resolve it automatically: remove conflict markers, keeping both sides' content, then run:
  \`git -C "${repoRoot}" add .\`
  \`git -C "${repoRoot}" rebase --continue\`
  (If prompted for a commit message, accept the default.)
- **NON-TRIVIAL conflict** (meaningful code changes in the same lines conflict):
  Abort immediately: \`git -C "${repoRoot}" rebase --abort\`
  Then verify the repo is clean: \`git -C "${repoRoot}" status\`
  Report what conflicted and why the rebase was aborted.

### 7. Clean up
Remove the temporary directory you created in Step 2.

### 8. Report the result
State clearly one of:
- ✅ Reorder completed successfully — all ${commits.length} commits reordered.
- ✅ Trivial conflict resolved — reorder completed after auto-resolution.
- ❌ Non-trivial conflict detected — rebase aborted, repository restored to original state. (Describe the conflict.)

## Important constraints
- Work in: ${repoRoot}
- Always end with the repository in a clean state (no REBASE_HEAD, no staged conflict markers).
- If \`git rebase --abort\` was run, confirm with \`git status\` that the working tree is clean.
- Do NOT push any changes — only local commit reordering.`;
}
