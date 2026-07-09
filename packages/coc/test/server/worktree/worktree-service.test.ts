/**
 * GitWorktreeService — creates/removes per-run Git worktrees for isolated
 * execution. Exercises real Git against throwaway repos (via an injected
 * runner that shells `git -C <root>` directly, keeping tests hermetic — no
 * global safe.directory mutation, no WSL translation).
 *
 * Covers AC-02 Definition of Done:
 *  - create from current HEAD without changing the source branch/dirty state
 *  - create from a valid branch/ref/SHA; invalid ref fails before any creation
 *  - non-Git folders / Git failures produce clear errors
 *  - dirty-source warning
 *  - no network + no source-branch-switch (asserted on the exact git argv)
 *  - repo-scoped path layout + workspace scoping
 *  - removal preserves the branch, refuses on a dirty worktree, is idempotent
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    GitWorktreeService,
    buildWorktreeBranch,
    slugifyBranchComponent,
    type GitRunner,
} from '../../../src/server/worktree/worktree-service';

const FIXED_NOW = '2026-07-08T12:00:00.000Z';

/** Hermetic git runner: real git, no safe.directory global writes. */
const gitRunner: GitRunner = (args, repoRoot) =>
    execFileSync('git', ['-C', repoRoot, ...args], { encoding: 'utf-8' }).replace(/\r?\n$/, '');

function git(repoRoot: string, ...args: string[]): string {
    return gitRunner(args, repoRoot);
}

/**
 * Normalize an absolute path for cross-platform comparison against git output.
 * `git worktree list --porcelain` prints POSIX separators and the canonical
 * (long) name, while Windows temp dirs can surface 8.3 short names (RUNNER~1)
 * and OS-native backslashes — realpath + forward slashes reconcile both, and
 * Windows paths compare case-insensitively.
 */
function normalizePath(p: string): string {
    const real = fs.realpathSync.native(p).replace(/\\/g, '/');
    return process.platform === 'win32' ? real.toLowerCase() : real;
}

/** Absolute worktree paths registered in a repo's `worktree list` output. */
function listedWorktreePaths(repoRoot: string): string[] {
    return git(repoRoot, 'worktree', 'list', '--porcelain')
        .split(/\r?\n/)
        .filter(line => line.startsWith('worktree '))
        .map(line => normalizePath(line.slice('worktree '.length)));
}

function initRepo(dir: string): void {
    git(dir, 'init', '-q');
    git(dir, 'config', 'user.email', 'test@test.com');
    git(dir, 'config', 'user.name', 'Test');
    git(dir, 'config', 'commit.gpgsign', 'false');
}

function commitFile(dir: string, name: string, contents: string, message: string): string {
    fs.writeFileSync(path.join(dir, name), contents, 'utf-8');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', message);
    return git(dir, 'rev-parse', '--verify', 'HEAD^{commit}');
}

describe('GitWorktreeService', () => {
    let dataDir: string;
    let sourceRepo: string;
    let service: GitWorktreeService;
    let gitCalls: string[][];
    let spyRunner: GitRunner;

    beforeEach(() => {
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-svc-data-'));
        sourceRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-svc-src-'));
        initRepo(sourceRepo);
        commitFile(sourceRepo, 'README.md', 'hello\n', 'init');

        gitCalls = [];
        spyRunner = (args, repoRoot) => {
            gitCalls.push(args);
            return gitRunner(args, repoRoot);
        };
        service = new GitWorktreeService({ dataDir, git: spyRunner, now: () => FIXED_NOW });
    });

    afterEach(() => {
        // Prune any dangling worktree registrations before removing dirs.
        try { git(sourceRepo, 'worktree', 'prune'); } catch { /* ignore */ }
        fs.rmSync(dataDir, { recursive: true, force: true });
        fs.rmSync(sourceRepo, { recursive: true, force: true });
    });

    describe('createWorktree from current HEAD', () => {
        it('creates an isolated checkout on a coc/ branch based on HEAD', async () => {
            const headSha = git(sourceRepo, 'rev-parse', '--verify', 'HEAD^{commit}');
            const { metadata, warning } = await service.createWorktree({
                workspaceId: 'ws-a',
                sourceRepoRoot: sourceRepo,
                runId: 'run-1',
                slug: 'My Work Item!',
            });

            expect(metadata.id).toBe('run-1');
            expect(metadata.workspaceId).toBe('ws-a');
            expect(metadata.baseSha).toBe(headSha);
            expect(metadata.baseRef).toBeUndefined();
            expect(metadata.status).toBe('active');
            expect(metadata.sourceDirty).toBe(false);
            expect(metadata.createdAt).toBe(FIXED_NOW);
            expect(warning).toBeUndefined();

            // Branch shape: coc/<slug>-<8 hex>.
            expect(metadata.branch).toMatch(/^coc\/my-work-item-[0-9a-f]{8}$/);

            // Checkout lives under the repo-scoped data root and has the file.
            expect(metadata.path).toBe(
                path.join(dataDir, 'repos', 'ws-a', 'git-worktrees', 'run-1'),
            );
            expect(fs.existsSync(path.join(metadata.path, 'README.md'))).toBe(true);

            // Registered as a worktree of the source repo.
            expect(listedWorktreePaths(sourceRepo)).toContain(normalizePath(metadata.path));

            // Persisted to the index.
            const stored = await service.getWorktree('ws-a', 'run-1');
            expect(stored?.branch).toBe(metadata.branch);
        });

        it('does not switch the source checkout branch or change its HEAD/dirty state', async () => {
            const branchBefore = git(sourceRepo, 'rev-parse', '--abbrev-ref', 'HEAD');
            const headBefore = git(sourceRepo, 'rev-parse', 'HEAD');

            await service.createWorktree({
                workspaceId: 'ws-a',
                sourceRepoRoot: sourceRepo,
                runId: 'run-1',
            });

            expect(git(sourceRepo, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe(branchBefore);
            expect(git(sourceRepo, 'rev-parse', 'HEAD')).toBe(headBefore);
            expect(git(sourceRepo, 'status', '--porcelain').trim()).toBe('');
        });

        it('never runs a network or branch-switching git command', async () => {
            await service.createWorktree({
                workspaceId: 'ws-a',
                sourceRepoRoot: sourceRepo,
                runId: 'run-1',
            });

            const forbidden = ['fetch', 'pull', 'push', 'rebase', 'merge', 'checkout', 'switch', 'reset', 'clone'];
            const usedSubcommands = gitCalls.map(args => args[0]);
            for (const sub of forbidden) {
                expect(usedSubcommands).not.toContain(sub);
            }
        });
    });

    describe('createWorktree from an explicit baseRef', () => {
        it('resolves a branch name to its commit and records the requested ref', async () => {
            const firstSha = git(sourceRepo, 'rev-parse', '--verify', 'HEAD^{commit}');
            git(sourceRepo, 'branch', 'feature-base');
            commitFile(sourceRepo, 'second.txt', 'two\n', 'second');

            const { metadata } = await service.createWorktree({
                workspaceId: 'ws-a',
                sourceRepoRoot: sourceRepo,
                runId: 'run-2',
                baseRef: 'feature-base',
            });

            expect(metadata.baseRef).toBe('feature-base');
            expect(metadata.baseSha).toBe(firstSha);
            // Worktree was based on the first commit → no second.txt.
            expect(fs.existsSync(path.join(metadata.path, 'second.txt'))).toBe(false);
        });

        it('accepts a raw commit SHA as the base', async () => {
            const firstSha = git(sourceRepo, 'rev-parse', '--verify', 'HEAD^{commit}');
            commitFile(sourceRepo, 'second.txt', 'two\n', 'second');

            const { metadata } = await service.createWorktree({
                workspaceId: 'ws-a',
                sourceRepoRoot: sourceRepo,
                runId: 'run-3',
                baseRef: firstSha,
            });

            expect(metadata.baseSha).toBe(firstSha);
        });

        it('rejects an invalid ref before creating a worktree or branch', async () => {
            await expect(
                service.createWorktree({
                    workspaceId: 'ws-a',
                    sourceRepoRoot: sourceRepo,
                    runId: 'run-bad',
                    baseRef: 'no-such-ref',
                }),
            ).rejects.toThrow(/does not resolve/i);

            // Nothing persisted, no worktree dir, source still has only its main worktree.
            expect(await service.listWorktrees('ws-a')).toEqual([]);
            expect(fs.existsSync(path.join(dataDir, 'repos', 'ws-a', 'git-worktrees', 'run-bad'))).toBe(false);
            const list = git(sourceRepo, 'worktree', 'list', '--porcelain');
            expect(list).not.toContain('run-bad');
        });
    });

    describe('non-Git and failure handling', () => {
        it('rejects a non-Git source folder with a clear error and creates nothing', async () => {
            const plainDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-plain-'));
            try {
                await expect(
                    service.createWorktree({
                        workspaceId: 'ws-a',
                        sourceRepoRoot: plainDir,
                        runId: 'run-x',
                    }),
                ).rejects.toThrow(/Not a Git repository/i);
                expect(await service.listWorktrees('ws-a')).toEqual([]);
            } finally {
                fs.rmSync(plainDir, { recursive: true, force: true });
            }
        });
    });

    describe('dirty source checkout', () => {
        it('warns but still creates the worktree, leaving source changes in place', async () => {
            fs.writeFileSync(path.join(sourceRepo, 'dirty.txt'), 'uncommitted\n', 'utf-8');

            const { metadata, warning } = await service.createWorktree({
                workspaceId: 'ws-a',
                sourceRepoRoot: sourceRepo,
                runId: 'run-dirty',
            });

            expect(metadata.sourceDirty).toBe(true);
            expect(metadata.sourceDirtyWarning).toMatch(/uncommitted changes/i);
            expect(warning).toBe(metadata.sourceDirtyWarning);

            // Worktree created; excluded uncommitted file is not present.
            expect(fs.existsSync(metadata.path)).toBe(true);
            expect(fs.existsSync(path.join(metadata.path, 'dirty.txt'))).toBe(false);

            // Source dirty file untouched.
            expect(fs.existsSync(path.join(sourceRepo, 'dirty.txt'))).toBe(true);
            expect(git(sourceRepo, 'status', '--porcelain')).toContain('dirty.txt');
        });
    });

    describe('workspace path scoping', () => {
        it('keeps records + checkouts separate per workspace', async () => {
            await service.createWorktree({ workspaceId: 'ws-a', sourceRepoRoot: sourceRepo, runId: 'run-a' });
            await service.createWorktree({ workspaceId: 'ws-b', sourceRepoRoot: sourceRepo, runId: 'run-b' });

            expect((await service.listWorktrees('ws-a')).map(r => r.id)).toEqual(['run-a']);
            expect((await service.listWorktrees('ws-b')).map(r => r.id)).toEqual(['run-b']);
            expect(fs.existsSync(path.join(dataDir, 'repos', 'ws-a', 'git-worktrees', 'run-a'))).toBe(true);
            expect(fs.existsSync(path.join(dataDir, 'repos', 'ws-b', 'git-worktrees', 'run-b'))).toBe(true);
        });
    });

    describe('removeWorktree', () => {
        it('removes the checkout, preserves the branch, and marks the record cleaned', async () => {
            const { metadata } = await service.createWorktree({
                workspaceId: 'ws-a',
                sourceRepoRoot: sourceRepo,
                runId: 'run-1',
            });

            const result = await service.removeWorktree('ws-a', 'run-1', sourceRepo);

            expect(result.alreadyCleaned).toBe(false);
            expect(result.metadata.status).toBe('cleaned');
            expect(result.metadata.cleanedAt).toBe(FIXED_NOW);

            // Checkout gone; branch preserved.
            expect(fs.existsSync(metadata.path)).toBe(false);
            const branches = git(sourceRepo, 'branch', '--list', metadata.branch);
            expect(branches).toContain(metadata.branch);

            // Record retained (history) with cleaned status.
            const stored = await service.getWorktree('ws-a', 'run-1');
            expect(stored?.status).toBe('cleaned');
        });

        it('refuses (non-destructively) to remove a worktree with uncommitted changes', async () => {
            const { metadata } = await service.createWorktree({
                workspaceId: 'ws-a',
                sourceRepoRoot: sourceRepo,
                runId: 'run-1',
            });
            fs.writeFileSync(path.join(metadata.path, 'scratch.txt'), 'wip\n', 'utf-8');

            await expect(service.removeWorktree('ws-a', 'run-1', sourceRepo)).rejects.toThrow();

            // Checkout still present, record still active.
            expect(fs.existsSync(metadata.path)).toBe(true);
            const stored = await service.getWorktree('ws-a', 'run-1');
            expect(stored?.status).toBe('active');
        });

        it('is idempotent when the worktree is already cleaned', async () => {
            await service.createWorktree({ workspaceId: 'ws-a', sourceRepoRoot: sourceRepo, runId: 'run-1' });
            await service.removeWorktree('ws-a', 'run-1', sourceRepo);
            const second = await service.removeWorktree('ws-a', 'run-1', sourceRepo);
            expect(second.alreadyCleaned).toBe(true);
        });

        it('throws for an unknown worktree id', async () => {
            await expect(service.removeWorktree('ws-a', 'nope', sourceRepo)).rejects.toThrow(/not found/i);
        });
    });
});

describe('branch-name helpers', () => {
    it('slugifies arbitrary text to a safe branch component', () => {
        expect(slugifyBranchComponent('My Work Item #42!')).toBe('my-work-item-42');
        expect(slugifyBranchComponent('   ')).toBe('run');
        expect(slugifyBranchComponent(undefined)).toBe('run');
        expect(slugifyBranchComponent('a'.repeat(100)).length).toBeLessThanOrEqual(40);
    });

    it('builds a deterministic coc/<slug>-<short-id> branch', () => {
        const a = buildWorktreeBranch('feature', 'run-123');
        const b = buildWorktreeBranch('feature', 'run-123');
        expect(a).toBe(b);
        expect(a).toMatch(/^coc\/feature-[0-9a-f]{8}$/);
        // Different run ids yield different short ids.
        expect(buildWorktreeBranch('feature', 'run-999')).not.toBe(a);
    });
});
