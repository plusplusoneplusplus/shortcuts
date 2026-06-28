/**
 * Production CI Failure-Log Fetcher (AC-02)
 *
 * Builds the optional {@link CiLogFetcher} injected into {@link CiFailureEvaluator}.
 * For each failing check it extracts the GitHub Actions workflow run id from the
 * check's `detailsUrl`, runs `gh run view <run-id> --log-failed` inside the PR's
 * local repo working tree, concatenates the per-run output, and truncates the
 * combined text to the last ~200 lines so the injected fix prompt stays small.
 *
 * Everything impure is isolated behind two injectables: a workspace-root
 * resolver (defaults to the process store) and a command runner (defaults to
 * `child_process.execFile`). The run-id extraction and truncation are pure
 * helpers, so the whole fetcher is unit-testable without a real `gh` or repo.
 *
 * Fault tolerance is a contract, not an option: any failure (missing repo root,
 * no resolvable run ids, `gh` not installed, non-zero exit, timeout) resolves to
 * `undefined` so the evaluator falls back to an excerpt-less prompt and the fix
 * still fires.
 *
 * Pure Node.js with built-ins only. Cross-platform.
 */

import { execFile } from 'child_process';
import type { ProcessStore } from '@plusplusoneplusplus/forge';
import { getLogger, LogCategory } from '@plusplusoneplusplus/forge';
import type { CiLogFetcher, CiCheckSnapshot } from './ci-failure-evaluator';

/** Keep the injected excerpt small — the tail of CI logs holds the failure. */
export const DEFAULT_MAX_LOG_LINES = 200;

/** Per-run `gh` invocation guards (a single workflow log can be large). */
const GH_LOG_TIMEOUT_MS = 30_000;
const GH_LOG_MAX_BUFFER = 50 * 1024 * 1024;

/** Minimal result shape of a command run (matches `execFileAsync`). */
export interface CommandResult {
    stdout: string;
    stderr: string;
}

/** Injectable command runner so tests need no real `gh`/subprocess. */
export interface CiLogCommandRunner {
    (file: string, args: readonly string[], options: { cwd: string }): Promise<CommandResult>;
}

export interface CreateCiLogFetcherOptions {
    /** Process store, used to resolve a workspace's local root path. */
    store: ProcessStore;
    /** Max lines kept in the combined excerpt. Defaults to {@link DEFAULT_MAX_LOG_LINES}. */
    maxLines?: number;
    /** Command runner override (defaults to `child_process.execFile`). */
    runCommand?: CiLogCommandRunner;
    /** Workspace-root resolver override (defaults to the process store). */
    resolveRepoRoot?: (workspaceId: string) => Promise<string | undefined>;
}

/**
 * Extract the GitHub Actions workflow run id from a check `detailsUrl`. Handles
 * the canonical job URL (`.../actions/runs/<run-id>/job/<job-id>`) and the
 * run-only URL (`.../actions/runs/<run-id>`). Returns `undefined` for the legacy
 * `/runs/<check-run-id>` form (not a workflow run id `gh run view` accepts) and
 * for any non-matching/blank URL.
 */
export function extractGithubRunId(detailsUrl?: string): string | undefined {
    if (!detailsUrl || typeof detailsUrl !== 'string') return undefined;
    const match = detailsUrl.match(/\/actions\/runs\/(\d+)/);
    return match ? match[1] : undefined;
}

/**
 * Resolve the de-duplicated, order-preserving set of workflow run ids referenced
 * by the failing checks. Multiple failing jobs typically belong to one run, so
 * `gh run view --log-failed` is fetched once per unique run.
 */
export function collectFailingRunIds(failingChecks: readonly CiCheckSnapshot[]): string[] {
    const seen = new Set<string>();
    const runIds: string[] = [];
    for (const check of failingChecks) {
        const runId = extractGithubRunId(check.detailsUrl);
        if (runId && !seen.has(runId)) {
            seen.add(runId);
            runIds.push(runId);
        }
    }
    return runIds;
}

/**
 * Keep only the last `maxLines` lines of `text`. When truncated, prepend a
 * one-line marker noting how many lines were dropped. Trailing whitespace is
 * trimmed first so a final newline does not count as a blank tail line.
 */
export function truncateToLastLines(text: string, maxLines = DEFAULT_MAX_LOG_LINES): string {
    const trimmed = text.replace(/\s+$/, '');
    if (!trimmed) return '';
    const limit = Math.max(1, Math.floor(maxLines));
    const lines = trimmed.split('\n');
    if (lines.length <= limit) return trimmed;
    const kept = lines.slice(lines.length - limit);
    const omitted = lines.length - limit;
    return [`… [truncated: showing last ${limit} of ${lines.length} lines; ${omitted} omitted] …`, ...kept].join('\n');
}

/** Default command runner: `child_process.execFile` promisified with guards. */
function defaultRunCommand(): CiLogCommandRunner {
    return (file, args, options) =>
        new Promise<CommandResult>((resolve, reject) => {
            execFile(
                file,
                args as string[],
                { cwd: options.cwd, timeout: GH_LOG_TIMEOUT_MS, maxBuffer: GH_LOG_MAX_BUFFER, windowsHide: true, encoding: 'utf-8' },
                (error, stdout, stderr) => {
                    if (error) reject(error);
                    else resolve({ stdout: stdout as string, stderr: stderr as string });
                },
            );
        });
}

/**
 * Create a {@link CiLogFetcher} bound to a process store. The returned fetcher
 * resolves the workspace's local root, runs `gh run view --log-failed` per
 * failing workflow run, and returns a truncated combined excerpt (or
 * `undefined` when no logs could be collected).
 */
export function createCiLogFetcher(options: CreateCiLogFetcherOptions): CiLogFetcher {
    const maxLines = options.maxLines ?? DEFAULT_MAX_LOG_LINES;
    const runCommand = options.runCommand ?? defaultRunCommand();
    const resolveRepoRoot =
        options.resolveRepoRoot ??
        (async (workspaceId: string) => {
            try {
                const workspaces = await options.store.getWorkspaces();
                return workspaces.find(w => w.id === workspaceId)?.rootPath;
            } catch {
                return undefined;
            }
        });

    return async ({ workspaceId, failingChecks }): Promise<string | undefined> => {
        const runIds = collectFailingRunIds(failingChecks);
        if (runIds.length === 0) return undefined;

        const repoRoot = await resolveRepoRoot(workspaceId);
        if (!repoRoot) return undefined;

        const sections: string[] = [];
        for (const runId of runIds) {
            try {
                const { stdout } = await runCommand('gh', ['run', 'view', runId, '--log-failed'], { cwd: repoRoot });
                const body = (stdout ?? '').trim();
                if (body) {
                    sections.push(`===== gh run view ${runId} --log-failed =====\n${body}`);
                }
            } catch (err) {
                // Best-effort per run: a missing `gh`, non-zero exit, or timeout
                // for one run must not drop the others or block the fix.
                getLogger().debug(
                    LogCategory.AI,
                    `[CiLogFetcher] gh run view ${runId} failed: ${err instanceof Error ? err.message : String(err)}`,
                );
            }
        }

        if (sections.length === 0) return undefined;
        return truncateToLastLines(sections.join('\n\n'), maxLines);
    };
}
