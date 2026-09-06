/**
 * Baseline-SHA capture for Ralph session creation.
 *
 * Records the workspace checkout's current HEAD when a non-worktree Ralph
 * session is created, so later automation (PR submit) can compute the exact
 * `baselineSha..HEAD` commit range the session produced. Strictly best-effort:
 * any failure (no directory known, not a git repo, git missing) resolves to
 * `undefined` and the session record simply omits the field. The one exception
 * is a missing or stale native addon, which is a broken install rather than a
 * repository that has nothing to say.
 */

import { loadNativeGit, NativeAddonLoadError } from '@plusplusoneplusplus/coc-native';
import { execGitAsync, resolveWorkspaceExecutionContext } from '@plusplusoneplusplus/forge';
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

/**
 * The current HEAD commit in `cwd`; `undefined` on any failure but a broken
 * addon.
 *
 * `gitValidateRef` resolves the ref through the object database rather than
 * spawning `rev-parse`, and answers `null` for exactly the cases that command
 * exited non-zero on: a repository with no commits yet, and a path that is not
 * a repository. The `FULL_SHA_RE` check stays because the caller's contract is
 * a 40-character SHA and nothing else.
 *
 * A checkout inside a WSL distro keeps `rev-parse HEAD`: the addon runs git on
 * the host and cannot open the UNC spelling that reaches here.
 */
export async function gitHeadSha(cwd: string): Promise<string | undefined> {
    try {
        const sha = resolveWorkspaceExecutionContext(cwd).kind === 'wsl'
            ? (await execGitAsync(['rev-parse', 'HEAD'], cwd, { timeout: 10_000 })).trim()
            : (await loadNativeGit().gitValidateRef(cwd, 'HEAD')) ?? '';
        return FULL_SHA_RE.test(sha) ? sha : undefined;
    } catch (err: unknown) {
        if (err instanceof NativeAddonLoadError) {
            throw err;
        }
        return undefined;
    }
}
