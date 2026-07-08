/**
 * GitWorktreeService — creates and removes per-run Git worktrees for isolated
 * autonomous execution (Work Item / Ralph launches).
 *
 * When requested, a worktree is created on the *target* server (the one that
 * owns the workspace checkout) under the repo-scoped data root:
 *
 *   <dataDir>/repos/<workspaceId>/git-worktrees/<runId>/
 *
 * on a dedicated branch `coc/<slug>-<short-id>` based on committed Git objects
 * only. The source checkout is never mutated: no fetch/pull/rebase/push and no
 * branch switch. Uncommitted changes in the source checkout are excluded and a
 * warning is surfaced.
 *
 * All Git invocations go through `execGit` (argument arrays, no shell). Removal
 * uses plain `git worktree remove` (never `--force`), so a dirty worktree keeps
 * its checkout and its record intact.
 */

import * as fs from 'fs';
import * as crypto from 'crypto';
import { execGit } from '@plusplusoneplusplus/forge';
import type { WorktreeMetadata } from '@plusplusoneplusplus/coc-client';
import { WorktreeMetadataStore } from './worktree-metadata-store';

export type { WorktreeMetadata };

/** Runs a Git command against a repo root and returns trimmed stdout. */
export type GitRunner = (args: string[], repoRoot: string) => string;

export interface GitWorktreeServiceOptions {
    /** CoC data root (e.g. `~/.coc`). */
    dataDir: string;
    /** Injectable Git runner (defaults to forge `execGit`); for testing. */
    git?: GitRunner;
    /** Injectable clock (ISO string); for deterministic tests. */
    now?: () => string;
}

export interface CreateWorktreeInput {
    /** Workspace whose checkout is the worktree base. */
    workspaceId: string;
    /** Absolute path to the source checkout on this (target) server. */
    sourceRepoRoot: string;
    /** Stable id for this run (session or task id) — used for dir + record key. */
    runId: string;
    /** Requested base ref/branch/SHA; empty/undefined means current `HEAD`. */
    baseRef?: string;
    /** Human-readable slug seed for the branch name (e.g. work item title). */
    slug?: string;
    /** Linked queued process id, when known at creation time. */
    processId?: string;
    /** Linked Ralph session id, when known at creation time. */
    ralphSessionId?: string;
}

export interface CreateWorktreeResult {
    /** The persisted worktree metadata record. */
    metadata: WorktreeMetadata;
    /** Human-facing warning (e.g. dirty source checkout), if any. */
    warning?: string;
}

export interface RemoveWorktreeResult {
    /** The updated metadata record (status `cleaned` on success). */
    metadata: WorktreeMetadata;
    /** True when the checkout was already cleaned (idempotent no-op). */
    alreadyCleaned: boolean;
}

/** Max branch-slug length so branch names stay reasonable. */
const MAX_SLUG_LENGTH = 40;

/**
 * Turn arbitrary text into a safe Git branch path component: lowercase,
 * non-alphanumerics collapsed to `-`, trimmed, length-capped. Falls back to
 * `run` when nothing usable remains.
 */
export function slugifyBranchComponent(input: string | undefined): string {
    const s = (input ?? '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, MAX_SLUG_LENGTH)
        .replace(/-+$/g, '');
    return s.length > 0 ? s : 'run';
}

/** Deterministic short id derived from the run id (stable across retries). */
function shortId(runId: string): string {
    return crypto.createHash('sha1').update(runId).digest('hex').slice(0, 8);
}

/** Build the dedicated branch name `coc/<slug>-<short-id>`. */
export function buildWorktreeBranch(slug: string | undefined, runId: string): string {
    return `coc/${slugifyBranchComponent(slug)}-${shortId(runId)}`;
}

export class GitWorktreeService {
    private readonly store: WorktreeMetadataStore;
    private readonly git: GitRunner;
    private readonly now: () => string;

    constructor(private readonly options: GitWorktreeServiceOptions) {
        this.store = new WorktreeMetadataStore({ dataDir: options.dataDir });
        this.git = options.git ?? ((args, repoRoot) => execGit(args, repoRoot));
        this.now = options.now ?? (() => new Date().toISOString());
    }

    /** Expose the metadata store for listing/inspection (AC-05/06). */
    getStore(): WorktreeMetadataStore {
        return this.store;
    }

    /**
     * Create an isolated worktree for a run.
     *
     * Fails (throwing a clear Error) *before* creating anything when the source
     * folder is not a Git repository or when `baseRef` does not resolve, so the
     * caller can abort the launch without having queued any execution.
     */
    async createWorktree(input: CreateWorktreeInput): Promise<CreateWorktreeResult> {
        const { workspaceId, sourceRepoRoot, runId } = input;

        this.assertGitRepo(sourceRepoRoot);

        // Resolve the base commit up front — an invalid ref must fail before we
        // create the worktree branch or directory.
        const baseSha = this.resolveBaseSha(sourceRepoRoot, input.baseRef);

        // Detect (but do not touch) uncommitted source changes — warn only.
        const sourceDirty = this.isSourceDirty(sourceRepoRoot);
        const sourceDirtyWarning = sourceDirty
            ? 'The source checkout has uncommitted changes; they are not included in the worktree.'
            : undefined;

        const branch = buildWorktreeBranch(input.slug, runId);
        const worktreePath = this.store.getWorktreePath(workspaceId, runId);

        // Ensure the parent `git-worktrees/` dir exists; git creates the leaf.
        await fs.promises.mkdir(this.store.getWorktreesDir(workspaceId), { recursive: true });

        // Create the worktree + branch from committed objects only. `git worktree
        // add` leaves the source checkout's HEAD and dirty state untouched, and
        // does no network I/O.
        this.git(['worktree', 'add', '-b', branch, worktreePath, baseSha], sourceRepoRoot);

        const metadata: WorktreeMetadata = {
            id: runId,
            workspaceId,
            path: worktreePath,
            branch,
            baseRef: input.baseRef && input.baseRef.trim().length > 0 ? input.baseRef.trim() : undefined,
            baseSha,
            createdAt: this.now(),
            sourceDirty,
            sourceDirtyWarning,
            processId: input.processId,
            ralphSessionId: input.ralphSessionId,
            status: 'active',
        };

        await this.store.upsert(metadata);

        return { metadata, warning: sourceDirtyWarning };
    }

    /**
     * Remove a CoC-created worktree checkout via `git worktree remove` (never
     * `--force`). The generated branch is preserved. On a dirty worktree or any
     * Git refusal the underlying error propagates and the record stays active.
     */
    async removeWorktree(
        workspaceId: string,
        id: string,
        sourceRepoRoot: string,
    ): Promise<RemoveWorktreeResult> {
        const record = await this.store.get(workspaceId, id);
        if (!record) {
            throw new Error(`Worktree "${id}" not found for workspace "${workspaceId}"`);
        }
        if (record.status === 'cleaned') {
            return { metadata: record, alreadyCleaned: true };
        }

        // No --force: git refuses (and errors) on a dirty worktree, which is the
        // intended non-destructive behavior.
        this.git(['worktree', 'remove', record.path], sourceRepoRoot);

        const updated = await this.store.markCleaned(workspaceId, id, this.now());
        return { metadata: updated ?? { ...record, status: 'cleaned', cleanedAt: this.now() }, alreadyCleaned: false };
    }

    /** List worktree records for a workspace (newest first). */
    listWorktrees(workspaceId: string): Promise<WorktreeMetadata[]> {
        return this.store.list(workspaceId);
    }

    /** Get a single worktree record, or `null`. */
    getWorktree(workspaceId: string, id: string): Promise<WorktreeMetadata | null> {
        return this.store.get(workspaceId, id);
    }

    private assertGitRepo(sourceRepoRoot: string): void {
        let inside: string;
        try {
            inside = this.git(['rev-parse', '--is-inside-work-tree'], sourceRepoRoot).trim();
        } catch {
            throw new Error(`Not a Git repository: ${sourceRepoRoot}`);
        }
        if (inside !== 'true') {
            throw new Error(`Not a Git repository: ${sourceRepoRoot}`);
        }
    }

    private resolveBaseSha(sourceRepoRoot: string, baseRef?: string): string {
        const ref = baseRef && baseRef.trim().length > 0 ? baseRef.trim() : 'HEAD';
        try {
            const sha = this.git(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], sourceRepoRoot).trim();
            if (!sha) {
                throw new Error('empty');
            }
            return sha;
        } catch {
            throw new Error(`Base ref "${ref}" does not resolve to a commit in this repository`);
        }
    }

    private isSourceDirty(sourceRepoRoot: string): boolean {
        const out = this.git(['status', '--porcelain'], sourceRepoRoot);
        return out.trim().length > 0;
    }
}
