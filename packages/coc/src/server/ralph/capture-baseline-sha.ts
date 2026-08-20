/**
 * Baseline-SHA capture for Ralph session creation.
 *
 * Records the workspace checkout's current HEAD when a non-worktree Ralph
 * session is created, so later automation (PR submit) can compute the exact
 * `baselineSha..HEAD` commit range the session produced. Strictly best-effort:
 * any failure (no directory known, not a git repo, git missing) resolves to
 * `undefined` and the session record simply omits the field.
 */

import { execFile } from 'child_process';
import type { ProcessStore } from '@plusplusoneplusplus/forge';

const FULL_SHA_RE = /^[0-9a-f]{40}$/i;

export interface CaptureBaselineShaInput {
    /** Explicit execution directory, when the launch surface knows one. */
    workingDirectory?: string;
    /** Fallback: resolve the workspace's registered checkout root. */
    store?: ProcessStore;
    workspaceId?: string;
}

/**
 * Resolve the directory to capture from (explicit working directory first,
 * then the workspace's registered root), and return its current HEAD SHA.
 * Returns `undefined` when no directory can be resolved or git fails.
 */
export async function captureRalphBaselineSha(
    input: CaptureBaselineShaInput,
): Promise<string | undefined> {
    let cwd = input.workingDirectory;
    if (!cwd && input.store && input.workspaceId) {
        try {
            const workspaces = await input.store.getWorkspaces();
            cwd = workspaces.find(w => w.id === input.workspaceId)?.rootPath;
        } catch {
            cwd = undefined;
        }
    }
    if (!cwd) return undefined;
    return gitHeadSha(cwd);
}

/** `git rev-parse HEAD` in `cwd`; `undefined` on any failure. */
export function gitHeadSha(cwd: string): Promise<string | undefined> {
    return new Promise((resolve) => {
        execFile(
            'git',
            ['-C', cwd, 'rev-parse', 'HEAD'],
            { timeout: 10_000, windowsHide: true },
            (err, stdout) => {
                if (err) return resolve(undefined);
                const sha = stdout.trim();
                resolve(FULL_SHA_RE.test(sha) ? sha : undefined);
            },
        );
    });
}
