/**
 * `BranchService`'s write half against real repositories.
 *
 * Create, delete, rename, checkout, merge, rebase, cherry-pick, stash, push,
 * pull and fetch all shell out from Rust now. There is no `execAsync` left to
 * mock and no command string worth asserting on — what a test can still say is
 * what the repository looks like afterwards, so every case here drives a real
 * temporary repo and reads the result back with `git`.
 *
 * The addon module is wrapped rather than replaced: calls are recorded on the
 * way through to the real runner, which is what lets the timeout and
 * environment contract be asserted without giving up real behaviour.
 */

import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const recorded = vi.hoisted(() => ({
    calls: [] as Array<{ args: string[]; repoRoot: string; options?: { timeout?: number; env?: Record<string, string> } }>,
}));

vi.mock('@plusplusoneplusplus/coc-native', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@plusplusoneplusplus/coc-native')>();
    return {
        ...actual,
        loadNativeGit: () => {
            const addon = actual.loadNativeGit();
            return new Proxy(addon, {
                get(target, property, receiver) {
                    if (property !== 'execGit') return Reflect.get(target, property, receiver);
                    return (args: string[], repoRoot: string, options?: { timeout?: number; env?: Record<string, string> }) => {
                        recorded.calls.push({ args, repoRoot, options });
                        return target.execGit(args, repoRoot, options);
                    };
                },
            });
        },
    };
});

import { BranchService } from '../../src/git/branch-service';
import { setLogger, nullLogger } from '../../src/logger';

const roots: string[] = [];

function git(repo: string, ...args: string[]): string {
    return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf-8' });
}

function scratch(prefix: string): string {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `forge-${prefix}-`)));
    roots.push(root);
    return root;
}

function identify(repo: string): void {
    git(repo, 'config', 'user.email', 'ralph@example.com');
    git(repo, 'config', 'user.name', 'Ralph');
    git(repo, 'config', 'commit.gpgsign', 'false');
}

/** A repository with one commit on `main`. */
function makeRepo(prefix = 'write'): string {
    const repo = scratch(prefix);
    git(repo, 'init', '--initial-branch=main');
    identify(repo);
    fs.writeFileSync(path.join(repo, 'README.md'), 'hello\n');
    git(repo, 'add', '.');
    git(repo, 'commit', '-m', 'initial commit');
    return repo;
}

/** Add a commit touching one file, and return its hash. */
function commit(repo: string, file: string, contents: string, subject: string): string {
    fs.writeFileSync(path.join(repo, file), contents);
    git(repo, 'add', '.');
    git(repo, 'commit', '-m', subject);
    return git(repo, 'rev-parse', 'HEAD').trim();
}

/** A bare `origin` and a clone of it, so push, pull and fetch are real. */
function makeClone(prefix = 'clone'): { origin: string; work: string } {
    const seed = makeRepo(`${prefix}-seed`);
    const origin = path.join(scratch(`${prefix}-origin`), 'origin.git');
    execFileSync('git', ['clone', '--bare', seed, origin], { encoding: 'utf-8' });
    const work = path.join(scratch(`${prefix}-work`), 'work');
    execFileSync('git', ['clone', origin, work], { encoding: 'utf-8' });
    identify(work);
    return { origin, work };
}

/** Two branches that changed the same line, so merging them conflicts. */
function makeConflict(repo: string): void {
    commit(repo, 'shared.txt', 'base\n', 'base');
    git(repo, 'checkout', '-q', '-b', 'side');
    commit(repo, 'shared.txt', 'side\n', 'side');
    git(repo, 'checkout', '-q', 'main');
    commit(repo, 'shared.txt', 'main\n', 'main');
}

function branchNames(repo: string): string[] {
    return git(repo, 'branch', '--format=%(refname:short)').trim().split('\n').filter(Boolean);
}

/** The recorded calls for one sub-command, in order. */
function callsFor(subcommand: string): typeof recorded.calls {
    return recorded.calls.filter(call => call.args[0] === subcommand);
}

afterAll(() => {
    for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
});

beforeEach(() => {
    setLogger(nullLogger);
    recorded.calls.length = 0;
});

const service = new BranchService();

// ── the runner contract ───────────────────────────────────────────────────

describe('the git commands this service runs', () => {
    it('never blocks on a credential prompt', async () => {
        const repo = makeRepo();
        await service.createBranch(repo, 'feature', false);
        await service.hasUncommittedChanges(repo);

        expect(recorded.calls.length).toBeGreaterThan(0);
        for (const call of recorded.calls) {
            expect(call.options?.env).toMatchObject({ GIT_TERMINAL_PROMPT: '0' });
        }
    });

    it('inherits the rest of the environment rather than replacing it', async () => {
        const repo = makeRepo();
        await service.createBranch(repo, 'feature', false);

        // Only the overrides cross the boundary; PATH, HOME and SSH_AUTH_SOCK
        // are the process's own, which is what a credential helper needs.
        expect(Object.keys(recorded.calls[0].options?.env ?? {})).toEqual(['GIT_TERMINAL_PROMPT']);
    });

    it('gives merge, rebase and the network the ten-minute timeout', async () => {
        const { work } = makeClone();
        await service.mergeBranch(work, 'main');
        await service.fetch(work);
        await service.pull(work);
        await service.push(work);

        for (const subcommand of ['merge', 'fetch', 'pull', 'push']) {
            const calls = callsFor(subcommand);
            expect(calls.length, subcommand).toBeGreaterThan(0);
            expect(calls[0].options?.timeout, subcommand).toBe(600_000);
        }
    });

    it('leaves everything else on the default timeout', async () => {
        const repo = makeRepo();
        await service.createBranch(repo, 'feature', false);

        expect(callsFor('branch')[0].options?.timeout).toBe(30_000);
    });

    it('passes arguments without a shell, so nothing needs quoting', async () => {
        const repo = makeRepo();
        // Git rejects a space in a ref name, so the shell metacharacters carry
        // this one; the stash-message case below covers spaces and quotes.
        const awkward = 'feature/$(touch-pwned)&|;';

        expect(await service.createBranch(repo, awkward, false)).toEqual({ success: true });
        expect(branchNames(repo)).toContain(awkward);
        expect(fs.existsSync(path.join(repo, 'touch-pwned'))).toBe(false);
    });
});

// ── branch management ─────────────────────────────────────────────────────

describe('createBranch', () => {
    it('creates a branch without leaving it checked out', async () => {
        const repo = makeRepo();

        expect(await service.createBranch(repo, 'feature', false)).toEqual({ success: true });
        expect(branchNames(repo)).toContain('feature');
        expect(git(repo, 'rev-parse', '--abbrev-ref', 'HEAD').trim()).toBe('main');
    });

    it('checks the new branch out by default', async () => {
        const repo = makeRepo();

        expect(await service.createBranch(repo, 'feature')).toEqual({ success: true });
        expect(git(repo, 'rev-parse', '--abbrev-ref', 'HEAD').trim()).toBe('feature');
    });

    it('reports the failure text for a name that already exists', async () => {
        const repo = makeRepo();
        await service.createBranch(repo, 'feature', false);

        const result = await service.createBranch(repo, 'feature', false);

        expect(result.success).toBe(false);
        expect(result.error).toMatch(/^git branch feature failed: /);
        expect(result.error).toMatch(/already exists/);
    });
});

describe('switchBranch', () => {
    it('checks out an existing branch', async () => {
        const repo = makeRepo();
        git(repo, 'branch', 'feature');

        expect(await service.switchBranch(repo, 'feature')).toEqual({ success: true });
        expect(git(repo, 'rev-parse', '--abbrev-ref', 'HEAD').trim()).toBe('feature');
    });

    it('creates and checks out with { create: true }', async () => {
        const repo = makeRepo();

        expect(await service.switchBranch(repo, 'fresh', { create: true })).toEqual({ success: true });
        expect(git(repo, 'rev-parse', '--abbrev-ref', 'HEAD').trim()).toBe('fresh');
        expect(callsFor('checkout')[0].args).toEqual(['checkout', '-b', 'fresh']);
    });

    it('discards a conflicting local edit with { force: true }', async () => {
        const repo = makeRepo();
        commit(repo, 'shared.txt', 'base\n', 'base');
        git(repo, 'checkout', '-q', '-b', 'feature');
        commit(repo, 'shared.txt', 'feature\n', 'feature');
        git(repo, 'checkout', '-q', 'main');
        fs.writeFileSync(path.join(repo, 'shared.txt'), 'uncommitted\n');

        expect((await service.switchBranch(repo, 'feature')).success).toBe(false);
        expect(await service.switchBranch(repo, 'feature', { force: true })).toEqual({ success: true });
        expect(git(repo, 'rev-parse', '--abbrev-ref', 'HEAD').trim()).toBe('feature');
    });

    it('reports the failure text for a branch that does not exist', async () => {
        const repo = makeRepo();

        const result = await service.switchBranch(repo, 'nonexistent');

        expect(result.success).toBe(false);
        expect(result.error).toMatch(/^git checkout nonexistent failed: /);
    });
});

describe('deleteBranch', () => {
    it('deletes a merged branch', async () => {
        const repo = makeRepo();
        git(repo, 'branch', 'feature');

        expect(await service.deleteBranch(repo, 'feature')).toEqual({ success: true });
        expect(branchNames(repo)).not.toContain('feature');
    });

    it('refuses an unmerged branch without force, and takes it with force', async () => {
        const repo = makeRepo();
        git(repo, 'checkout', '-q', '-b', 'feature');
        commit(repo, 'only-here.txt', 'x\n', 'unmerged work');
        git(repo, 'checkout', '-q', 'main');

        const refused = await service.deleteBranch(repo, 'feature');
        expect(refused.success).toBe(false);
        expect(refused.error).toMatch(/not fully merged/);

        expect(await service.deleteBranch(repo, 'feature', true)).toEqual({ success: true });
        expect(branchNames(repo)).not.toContain('feature');
    });
});

describe('renameBranch', () => {
    it('renames a branch', async () => {
        const repo = makeRepo();
        git(repo, 'branch', 'old-name');

        expect(await service.renameBranch(repo, 'old-name', 'new-name')).toEqual({ success: true });
        expect(branchNames(repo)).toContain('new-name');
        expect(branchNames(repo)).not.toContain('old-name');
    });

    it('reports the failure text for a source that does not exist', async () => {
        const repo = makeRepo();

        const result = await service.renameBranch(repo, 'missing', 'new-name');

        expect(result.success).toBe(false);
        expect(result.error).toMatch(/^git branch -m missing new-name failed: /);
    });
});

// ── merge, rebase and their conflicts ─────────────────────────────────────

describe('mergeBranch', () => {
    it('fast-forwards a branch that is behind', async () => {
        const repo = makeRepo();
        git(repo, 'checkout', '-q', '-b', 'feature');
        const head = commit(repo, 'feature.txt', 'x\n', 'feature work');
        git(repo, 'checkout', '-q', 'main');

        expect(await service.mergeBranch(repo, 'feature')).toEqual({ success: true });
        expect(git(repo, 'rev-parse', 'HEAD').trim()).toBe(head);
    });

    it('leaves a conflicted merge in progress, and mergeAbort clears it', async () => {
        const repo = makeRepo();
        makeConflict(repo);

        expect((await service.mergeBranch(repo, 'side')).success).toBe(false);
        expect(await service.getRepoState(repo)).toEqual({
            operation: 'merge',
            conflictFiles: ['shared.txt'],
        });

        expect(await service.mergeAbort(repo)).toEqual({ success: true });
        expect(await service.getRepoState(repo)).toEqual({ operation: 'none', conflictFiles: [] });
    });

    it('mergeContinue commits a merge whose conflicts were resolved', async () => {
        const repo = makeRepo();
        makeConflict(repo);
        await service.mergeBranch(repo, 'side');
        fs.writeFileSync(path.join(repo, 'shared.txt'), 'resolved\n');
        git(repo, 'add', 'shared.txt');

        expect(await service.mergeContinue(repo)).toEqual({ success: true });
        expect(await service.getRepoState(repo)).toEqual({ operation: 'none', conflictFiles: [] });
        expect(git(repo, 'rev-list', '--count', '--merges', 'HEAD').trim()).toBe('1');
    });

    it('mergeContinue supplies the editor, so the merge commit needs no terminal', async () => {
        const repo = makeRepo();
        makeConflict(repo);
        await service.mergeBranch(repo, 'side');
        fs.writeFileSync(path.join(repo, 'shared.txt'), 'resolved\n');
        git(repo, 'add', 'shared.txt');
        await service.mergeContinue(repo);

        expect(callsFor('merge').at(-1)?.options?.env).toMatchObject({ GIT_EDITOR: 'true' });
    });
});

describe('rebaseContinue and rebaseAbort', () => {
    it('abort clears a conflicted rebase', async () => {
        const repo = makeRepo();
        makeConflict(repo);
        const before = git(repo, 'rev-parse', 'HEAD').trim();
        try {
            execFileSync('git', ['-C', repo, 'rebase', 'side'], { encoding: 'utf-8', stdio: 'ignore' });
        } catch {
            // The conflict is the point.
        }
        expect((await service.getRepoState(repo)).operation).toBe('rebase');

        expect(await service.rebaseAbort(repo)).toEqual({ success: true });
        expect(git(repo, 'rev-parse', 'HEAD').trim()).toBe(before);
    }, 30_000);

    it('continue finishes a rebase whose conflicts were resolved', async () => {
        const repo = makeRepo();
        makeConflict(repo);
        try {
            execFileSync('git', ['-C', repo, 'rebase', 'side'], { encoding: 'utf-8', stdio: 'ignore' });
        } catch {
            // The conflict is the point.
        }
        expect((await service.getRepoState(repo)).operation).toBe('rebase');
        fs.writeFileSync(path.join(repo, 'shared.txt'), 'resolved\n');
        git(repo, 'add', 'shared.txt');

        expect(await service.rebaseContinue(repo)).toEqual({ success: true });
        expect((await service.getRepoState(repo)).operation).toBe('none');
    }, 30_000);
});

describe('rebaseAutosquash', () => {
    it('folds a fixup into the commit it names, without an interactive editor', async () => {
        const { work } = makeClone();
        const target = commit(work, 'a.txt', 'one\n', 'add a');
        fs.writeFileSync(path.join(work, 'a.txt'), 'two\n');
        git(work, 'add', '.');
        git(work, 'commit', '--fixup', target);

        expect(await service.rebaseAutosquash(work)).toEqual({ success: true });
        expect(git(work, 'log', '--format=%s').trim().split('\n')).toEqual(['add a', 'initial commit']);
    }, 30_000);

    it('reports the failure text when there is no upstream to rebase onto', async () => {
        const repo = makeRepo();

        const result = await service.rebaseAutosquash(repo);

        expect(result.success).toBe(false);
        expect(result.error).toMatch(/^git rebase -i --autosquash @\{upstream\} failed: /);
    });
});

// ── the network operations ────────────────────────────────────────────────

describe('push, pull and fetch', () => {
    it('pushes the current branch to its upstream', async () => {
        const { origin, work } = makeClone();
        const head = commit(work, 'pushed.txt', 'x\n', 'to push');

        expect(await service.push(work)).toEqual({ success: true });
        expect(git(origin, 'rev-parse', 'main').trim()).toBe(head);
    });

    it('sets the upstream for a branch that has none', async () => {
        const { origin, work } = makeClone();
        git(work, 'checkout', '-q', '-b', 'feature');
        const head = commit(work, 'feature.txt', 'x\n', 'feature work');

        expect(await service.push(work, true)).toEqual({ success: true });
        expect(git(origin, 'rev-parse', 'feature').trim()).toBe(head);
        expect(git(work, 'rev-parse', '--abbrev-ref', 'feature@{upstream}').trim()).toBe('origin/feature');
    });

    it('pushUpTo leaves newer commits local', async () => {
        const { origin, work } = makeClone();
        const first = commit(work, 'one.txt', '1\n', 'first');
        commit(work, 'two.txt', '2\n', 'second');

        expect(await service.pushUpTo(work, first)).toEqual({ success: true });
        expect(git(origin, 'rev-parse', 'main').trim()).toBe(first);
    });

    it('pushUpTo refuses a detached HEAD', async () => {
        const { work } = makeClone();
        const head = git(work, 'rev-parse', 'HEAD').trim();
        git(work, 'checkout', '-q', '--detach', 'HEAD');

        expect(await service.pushUpTo(work, head)).toEqual({
            success: false,
            error: 'Cannot determine current branch (detached HEAD?)',
        });
    });

    it('fetches without moving the working branch', async () => {
        const { origin, work } = makeClone();
        const other = path.join(scratch('fetch-other'), 'other');
        execFileSync('git', ['clone', origin, other], { encoding: 'utf-8' });
        identify(other);
        const head = commit(other, 'remote.txt', 'x\n', 'landed elsewhere');
        execFileSync('git', ['-C', other, 'push'], { encoding: 'utf-8' });

        expect(await service.fetch(work)).toEqual({ success: true });
        expect(git(work, 'rev-parse', 'origin/main').trim()).toBe(head);
        expect(git(work, 'rev-parse', 'HEAD').trim()).not.toBe(head);
    });

    it('pulls the new commits into the working branch', async () => {
        const { origin, work } = makeClone();
        const other = path.join(scratch('pull-other'), 'other');
        execFileSync('git', ['clone', origin, other], { encoding: 'utf-8' });
        identify(other);
        const head = commit(other, 'remote.txt', 'x\n', 'landed elsewhere');
        execFileSync('git', ['-C', other, 'push'], { encoding: 'utf-8' });

        expect(await service.pull(work)).toEqual({ success: true });
        expect(git(work, 'rev-parse', 'HEAD').trim()).toBe(head);
    });

    it('pulls with --rebase when asked', async () => {
        const { work } = makeClone();

        expect(await service.pull(work, true)).toEqual({ success: true });
        expect(callsFor('pull')[0].args).toEqual(['pull', '--rebase']);
    });

    it('scopes fetchCurrentBranch to the configured upstream ref', async () => {
        const { work } = makeClone();

        expect(await service.fetchCurrentBranch(work)).toEqual({ success: true });
        expect(callsFor('fetch').at(-1)?.args).toEqual([
            'fetch', '--no-tags', '--', 'origin', 'refs/heads/main',
        ]);
    });

    it('scopes pullCurrentBranch to the configured upstream ref', async () => {
        const { work } = makeClone();

        expect(await service.pullCurrentBranch(work, true)).toEqual({ success: true });
        expect(callsFor('pull').at(-1)?.args).toEqual([
            'pull', '--rebase', '--no-tags', '--', 'origin', 'refs/heads/main',
        ]);
    });

    it('refuses to fetch or pull a branch with no upstream', async () => {
        const { work } = makeClone();
        git(work, 'checkout', '-q', '-b', 'orphan');

        expect(await service.fetchCurrentBranch(work)).toEqual({
            success: false,
            error: 'Current branch "orphan" has no upstream configured',
        });
        expect(await service.pullCurrentBranch(work)).toEqual({
            success: false,
            error: 'Current branch "orphan" has no upstream configured',
        });
    });

    it('refuses to fetch a detached HEAD', async () => {
        const { work } = makeClone();
        git(work, 'checkout', '-q', '--detach', 'HEAD');

        expect(await service.fetchCurrentBranch(work)).toEqual({
            success: false,
            error: 'Cannot fetch or pull while HEAD is detached',
        });
    });
});

// ── stash ─────────────────────────────────────────────────────────────────

describe('stashChanges and popStash', () => {
    it('stashes a dirty tree and pops it back', async () => {
        const repo = makeRepo();
        fs.writeFileSync(path.join(repo, 'README.md'), 'edited\n');

        expect(await service.stashChanges(repo)).toEqual({ success: true });
        expect(fs.readFileSync(path.join(repo, 'README.md'), 'utf-8')).toBe('hello\n');

        expect(await service.popStash(repo)).toEqual({ success: true });
        expect(fs.readFileSync(path.join(repo, 'README.md'), 'utf-8')).toBe('edited\n');
    });

    it('keeps a message holding quotes and spaces intact', async () => {
        const repo = makeRepo();
        fs.writeFileSync(path.join(repo, 'README.md'), 'edited\n');
        const message = 'work in "progress" — and $HOME';

        expect(await service.stashChanges(repo, message)).toEqual({ success: true });
        expect(git(repo, 'stash', 'list', '--format=%gs')).toContain(message);
    });

    it('reports the failure text when there is no stash to pop', async () => {
        const repo = makeRepo();

        const result = await service.popStash(repo);

        expect(result.success).toBe(false);
        expect(result.error).toMatch(/^git stash pop failed: /);
    });
});

// ── cherry-pick ───────────────────────────────────────────────────────────

describe('cherryPick', () => {
    it('applies one commit onto the current HEAD', async () => {
        const repo = makeRepo();
        git(repo, 'checkout', '-q', '-b', 'side');
        const hash = commit(repo, 'side.txt', 'x\n', 'side work');
        git(repo, 'checkout', '-q', 'main');

        expect(await service.cherryPick(repo, hash)).toEqual({
            success: true,
            conflicts: false,
            message: 'Cherry-pick applied successfully',
        });
        expect(git(repo, 'log', '-1', '--format=%s').trim()).toBe('side work');
    });

    it('reports a conflict rather than a plain failure', async () => {
        const repo = makeRepo();
        makeConflict(repo);
        const sideHash = git(repo, 'rev-parse', 'side').trim();

        const result = await service.cherryPick(repo, sideHash);

        expect(result.success).toBe(false);
        expect(result.conflicts).toBe(true);
    });

    it('applies several commits onto another branch and comes back', async () => {
        const repo = makeRepo();
        git(repo, 'branch', 'target');
        git(repo, 'checkout', '-q', '-b', 'source');
        const first = commit(repo, 'one.txt', '1\n', 'first');
        const second = commit(repo, 'two.txt', '2\n', 'second');
        git(repo, 'checkout', '-q', 'main');

        const result = await service.cherryPick(repo, first, {
            hashes: [first, second],
            targetBranch: 'target',
        });

        expect(result.success).toBe(true);
        expect(result.appliedHashes).toEqual([first, second]);
        expect(git(repo, 'rev-parse', '--abbrev-ref', 'HEAD').trim()).toBe('main');
        expect(git(repo, 'log', 'target', '--format=%s').trim().split('\n')).toEqual([
            'second', 'first', 'initial commit',
        ]);
    });

    it('rolls the target branch back when a later commit conflicts', async () => {
        const repo = makeRepo();
        commit(repo, 'shared.txt', 'base\n', 'base');
        git(repo, 'branch', 'target');
        git(repo, 'checkout', '-q', '-b', 'source');
        const clean = commit(repo, 'one.txt', '1\n', 'clean');
        const clashing = commit(repo, 'shared.txt', 'source\n', 'clashing');
        git(repo, 'checkout', '-q', 'target');
        commit(repo, 'shared.txt', 'target\n', 'target moved');
        const targetHead = git(repo, 'rev-parse', 'target').trim();
        git(repo, 'checkout', '-q', 'main');

        const result = await service.cherryPick(repo, clean, {
            hashes: [clean, clashing],
            targetBranch: 'target',
        });

        expect(result.success).toBe(false);
        expect(result.conflicts).toBe(true);
        expect(git(repo, 'rev-parse', 'target').trim()).toBe(targetHead);
        expect(git(repo, 'rev-parse', '--abbrev-ref', 'HEAD').trim()).toBe('main');
        expect((await service.getRepoState(repo)).operation).toBe('none');
    });

    it('refuses an atomic cherry-pick onto a dirty tree', async () => {
        const repo = makeRepo();
        git(repo, 'branch', 'target');
        const hash = commit(repo, 'one.txt', '1\n', 'first');
        fs.writeFileSync(path.join(repo, 'README.md'), 'dirty\n');

        const result = await service.cherryPick(repo, hash, { hashes: [hash], targetBranch: 'target' });

        expect(result).toMatchObject({ success: false, dirty: true, conflicts: false });
    });
});

// ── patch export and apply ────────────────────────────────────────────────

describe('exportCommitPatch and applyCommitPatch', () => {
    it('carries one commit from one repository to another', async () => {
        const source = makeRepo('patch-source');
        const target = makeRepo('patch-target');
        const hash = commit(source, 'carried.txt', 'carried\n', 'carry me');

        const exported = await service.exportCommitPatch(source, hash);
        expect(exported).toMatchObject({
            success: true,
            commitHash: hash,
            subject: 'carry me',
            authorName: 'Ralph',
            authorEmail: 'ralph@example.com',
        });

        const applied = await service.applyCommitPatch(target, exported.patch!);
        expect(applied).toMatchObject({ success: true, conflicts: false, appliedCount: 1 });
        expect(git(target, 'log', '-1', '--format=%s').trim()).toBe('carry me');
        expect(fs.readFileSync(path.join(target, 'carried.txt'), 'utf-8')).toBe('carried\n');
    });

    it('ends the patch body in exactly one newline', async () => {
        const source = makeRepo('patch-newline');
        const hash = commit(source, 'a.txt', 'a\n', 'one');

        const exported = await service.exportCommitPatch(source, hash);

        expect(exported.patch!.endsWith('\n')).toBe(true);
        expect(exported.patch!.endsWith('\n\n')).toBe(false);
    });

    it('rejects a hash that is not a hash before running anything', async () => {
        const repo = makeRepo();

        expect(await service.exportCommitPatch(repo, 'not-a-hash')).toEqual({
            success: false,
            error: 'Invalid commit hash',
        });
        expect(recorded.calls).toHaveLength(0);
    });

    it('carries several commits as one mailbox, in order', async () => {
        const source = makeRepo('patches-source');
        const target = makeRepo('patches-target');
        const first = commit(source, 'one.txt', '1\n', 'first');
        const second = commit(source, 'two.txt', '2\n', 'second');

        const exported = await service.exportCommitPatches(source, [first, second]);
        expect(exported.success).toBe(true);
        expect(exported.commits).toHaveLength(2);

        const applied = await service.applyCommitPatch(target, exported.patch!);
        expect(applied).toMatchObject({ success: true, appliedCount: 2 });
        expect(git(target, 'log', '--format=%s').trim().split('\n')).toEqual([
            'second', 'first', 'initial commit',
        ]);
    });

    it('rejects an empty list of commits', async () => {
        const repo = makeRepo();

        expect(await service.exportCommitPatches(repo, [])).toEqual({
            success: false,
            error: 'No commits to export',
        });
    });

    it('refuses a dirty target unless told to stash', async () => {
        const source = makeRepo('dirty-source');
        const target = makeRepo('dirty-target');
        const hash = commit(source, 'carried.txt', 'carried\n', 'carry me');
        const exported = await service.exportCommitPatch(source, hash);
        fs.writeFileSync(path.join(target, 'README.md'), 'dirty\n');

        expect(await service.applyCommitPatch(target, exported.patch!)).toMatchObject({
            success: false,
            dirty: true,
            stashed: false,
        });

        const stashed = await service.applyCommitPatch(target, exported.patch!, {
            stashAndContinue: true,
            stashMessage: 'set "aside"',
        });
        expect(stashed).toMatchObject({ success: true, stashed: true });
        expect(git(target, 'stash', 'list', '--format=%gs')).toContain('set "aside"');
    });

    it('reports a conflicting patch as a conflict, with the am state', async () => {
        const source = makeRepo('conflict-source');
        const target = makeRepo('conflict-target');
        fs.writeFileSync(path.join(target, 'shared.txt'), 'target\n');
        git(target, 'add', '.');
        git(target, 'commit', '-m', 'target version');
        commit(source, 'shared.txt', 'source base\n', 'source base');
        const hash = commit(source, 'shared.txt', 'source change\n', 'source change');
        const exported = await service.exportCommitPatch(source, hash);

        const applied = await service.applyCommitPatch(target, exported.patch!);

        expect(applied.success).toBe(false);
        expect(applied.conflicts).toBe(true);
        expect(applied.gitState).toMatchObject({ operation: 'cherry-pick', gitOperation: 'am' });
        git(target, 'am', '--abort');
    });

    it('refuses to apply while another operation is in progress', async () => {
        const source = makeRepo('busy-source');
        const target = makeRepo('busy-target');
        const hash = commit(source, 'carried.txt', 'x\n', 'carry me');
        const exported = await service.exportCommitPatch(source, hash);
        makeConflict(target);
        await service.mergeBranch(target, 'side');

        const applied = await service.applyCommitPatch(target, exported.patch!);

        expect(applied.success).toBe(false);
        expect(applied.message).toBe('Repository already has a merge operation in progress');
    });

    it('rejects an empty patch body', async () => {
        const repo = makeRepo();

        expect(await service.applyCommitPatch(repo, '   ')).toEqual({
            success: false,
            conflicts: false,
            message: 'Patch body must not be empty',
        });
    });
});

// ── commit message editing ────────────────────────────────────────────────

describe('amendCommitMessage', () => {
    it('replaces the HEAD message and returns the new hash', async () => {
        const repo = makeRepo();
        const before = git(repo, 'rev-parse', 'HEAD').trim();

        const result = await service.amendCommitMessage(repo, 'new title', 'and a body');

        expect(result.success).toBe(true);
        expect(result.hash).toMatch(/^[0-9a-f]{40}$/);
        expect(result.hash).not.toBe(before);
        expect(git(repo, 'log', '-1', '--format=%B').trim()).toBe('new title\n\nand a body');
    });

    it('keeps a title holding quotes and backslashes intact', async () => {
        const repo = makeRepo();
        const title = 'fix: handle "quoted" C:\\paths';

        expect((await service.amendCommitMessage(repo, title)).success).toBe(true);
        expect(git(repo, 'log', '-1', '--format=%s').trim()).toBe(title);
    });

    it('rejects an empty title without running git', async () => {
        const repo = makeRepo();

        expect(await service.amendCommitMessage(repo, '  ')).toEqual({
            success: false,
            error: 'Commit title must not be empty',
        });
        expect(recorded.calls).toHaveLength(0);
    });
});

describe('rewordCommit', () => {
    it('rewrites the title of a commit below HEAD', async () => {
        const repo = makeRepo();
        const target = commit(repo, 'one.txt', '1\n', 'wrong title');
        commit(repo, 'two.txt', '2\n', 'later work');

        expect(await service.rewordCommit(repo, target, 'right title')).toEqual({ success: true });
        expect(git(repo, 'log', '--format=%s').trim().split('\n')).toEqual([
            'later work', 'right title', 'initial commit',
        ]);
    }, 30_000);

    it('rejects an empty hash or title without running git', async () => {
        const repo = makeRepo();

        expect(await service.rewordCommit(repo, '', 'title')).toEqual({
            success: false,
            error: 'Commit hash must not be empty',
        });
        expect(await service.rewordCommit(repo, 'HEAD', ' ')).toEqual({
            success: false,
            error: 'Commit title must not be empty',
        });
        expect(recorded.calls).toHaveLength(0);
    });
});

describe('dropCommit', () => {
    it('removes a commit below HEAD from history', async () => {
        const repo = makeRepo();
        const doomed = commit(repo, 'one.txt', '1\n', 'drop me');
        commit(repo, 'two.txt', '2\n', 'keep me');

        expect(await service.dropCommit(repo, doomed)).toEqual({ success: true });
        expect(git(repo, 'log', '--format=%s').trim().split('\n')).toEqual([
            'keep me', 'initial commit',
        ]);
    }, 30_000);

    it('drives the todo list without supplying a message editor', async () => {
        const repo = makeRepo();
        const doomed = commit(repo, 'one.txt', '1\n', 'drop me');
        commit(repo, 'two.txt', '2\n', 'keep me');

        await service.dropCommit(repo, doomed);

        const rebase = callsFor('rebase').find(call => call.args[1] === '-i');
        expect(rebase?.options?.env).toHaveProperty('GIT_SEQUENCE_EDITOR');
        expect(rebase?.options?.env).not.toHaveProperty('GIT_EDITOR');
    }, 30_000);

    it('aborts the rebase it started when the drop fails', async () => {
        const repo = makeRepo();
        commit(repo, 'shared.txt', 'base\n', 'base');
        const doomed = commit(repo, 'shared.txt', 'middle\n', 'drop me');
        commit(repo, 'shared.txt', 'top\n', 'keep me');

        const result = await service.dropCommit(repo, doomed);

        expect(result.success).toBe(false);
        expect((await service.getRepoState(repo)).operation).toBe('none');
    }, 30_000);

    it('rejects an empty hash without running git', async () => {
        const repo = makeRepo();

        expect(await service.dropCommit(repo, '  ')).toEqual({
            success: false,
            error: 'Commit hash must not be empty',
        });
        expect(recorded.calls).toHaveLength(0);
    });
});

// ── repository state ──────────────────────────────────────────────────────

describe('hasUncommittedChanges', () => {
    it('is false for a clean tree and true once a file is edited', async () => {
        const repo = makeRepo();

        expect(await service.hasUncommittedChanges(repo)).toBe(false);
        fs.writeFileSync(path.join(repo, 'README.md'), 'edited\n');
        expect(await service.hasUncommittedChanges(repo)).toBe(true);
    });

    it('counts an untracked file', async () => {
        const repo = makeRepo();
        fs.writeFileSync(path.join(repo, 'new.txt'), 'new\n');

        expect(await service.hasUncommittedChanges(repo)).toBe(true);
    });
});

describe('getRepoState', () => {
    it('reports none for a clean repository', async () => {
        const repo = makeRepo();

        expect(await service.getRepoState(repo)).toEqual({ operation: 'none', conflictFiles: [] });
    });

    it('reports a cherry-pick and the files that conflict', async () => {
        const repo = makeRepo();
        makeConflict(repo);
        await service.cherryPick(repo, git(repo, 'rev-parse', 'side').trim(), {
            hashes: [git(repo, 'rev-parse', 'side').trim(), git(repo, 'rev-parse', 'side').trim()],
        });
        try {
            execFileSync('git', ['-C', repo, 'cherry-pick', 'side'], { encoding: 'utf-8', stdio: 'ignore' });
        } catch {
            // The conflict is the point.
        }

        expect(await service.getRepoState(repo)).toEqual({
            operation: 'cherry-pick',
            conflictFiles: ['shared.txt'],
        });
    });

    it('follows a worktree to the git directory that actually holds the state', async () => {
        const repo = makeRepo();
        const linked = path.join(scratch('worktree'), 'linked');
        git(repo, 'worktree', 'add', '-b', 'linked', linked);

        expect(await service.getRepoState(linked)).toEqual({ operation: 'none', conflictFiles: [] });
    });

    it('reports none rather than throwing outside a repository', async () => {
        const notARepo = scratch('not-a-repo');

        expect(await service.getRepoState(notARepo)).toEqual({ operation: 'none', conflictFiles: [] });
    });
});
