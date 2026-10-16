import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import {
    CreatePullRequestError,
    branchBaseName,
    buildAzAutoMergeArgs,
    buildAzCreateArgs,
    buildGhAutoMergeArgs,
    buildGhCreateArgs,
    createPullRequest,
    detectPullRequestProvider,
    parseAzListOutput,
    parseAzPullRequest,
    parseGhCreateOutput,
    parseGhListOutput,
    type PrCliRunner,
} from '../../src/server/git/create-pull-request-service';

import { type PullRequestGit } from '@plusplusoneplusplus/forge';

const GH_URL = 'https://github.com/example/repo.git';
const ADO_URL = 'https://dev.azure.com/org/proj/_git/repo';

describe('detectPullRequestProvider', () => {
    it('maps GitHub remotes (https and ssh) to github', () => {
        expect(detectPullRequestProvider('https://github.com/o/r.git')).toBe('github');
        expect(detectPullRequestProvider('git@github.com:o/r.git')).toBe('github');
        expect(detectPullRequestProvider('https://ghe.example.com/o/r')).toBe('github');
    });

    it('maps dev.azure.com remotes to ado', () => {
        expect(detectPullRequestProvider('https://dev.azure.com/org/proj/_git/repo')).toBe('ado');
        expect(detectPullRequestProvider('https://org@dev.azure.com/org/proj/_git/repo')).toBe('ado');
        expect(detectPullRequestProvider('git@ssh.dev.azure.com:v3/org/proj/repo')).toBe('ado');
    });

    it('maps visualstudio.com remotes to ado', () => {
        expect(detectPullRequestProvider('https://org.visualstudio.com/proj/_git/repo')).toBe('ado');
        expect(detectPullRequestProvider('org@vs-ssh.visualstudio.com:v3/org/proj/repo')).toBe('ado');
    });

    it('rejects unrecognized remotes with a clear error', () => {
        for (const url of ['', '/srv/git/repo.git', 'C:\\repos\\thing', 'not a url']) {
            expect(() => detectPullRequestProvider(url)).toThrow(CreatePullRequestError);
            try {
                detectPullRequestProvider(url);
            } catch (err) {
                expect((err as CreatePullRequestError).code).toBe('unknown-remote');
            }
        }
    });
});

describe('argument building and parsing', () => {
    it('builds gh create/merge args', () => {
        expect(buildGhCreateArgs({ base: 'main', head: 'pr/x', title: 'T', body: 'B', draft: true })).toEqual([
            'pr', 'create', '--base', 'main', '--head', 'pr/x', '--title', 'T', '--body', 'B', '--draft',
        ]);
        expect(buildGhCreateArgs({ base: 'main', head: 'pr/x', title: 'T', body: '', draft: false })).not.toContain('--draft');
        expect(buildGhAutoMergeArgs('u', 'squash')).toEqual(['pr', 'merge', 'u', '--auto', '--squash']);
    });

    it('builds az create/update args with @file text', () => {
        const titleFile = path.join('tmp', 'title.txt');
        const args = buildAzCreateArgs({ base: 'main', head: 'pr/x', titleFile, descriptionFile: 'd.txt', draft: false });
        expect(args.slice(0, 3)).toEqual(['repos', 'pr', 'create']);
        expect(args).toContain(`@${titleFile}`);
        expect(args).toContain('@d.txt');
        expect(args[args.indexOf('--draft') + 1]).toBe('false');
        expect(args[args.indexOf('--target-branch') + 1]).toBe('main');
        const update = buildAzAutoMergeArgs(9, 'squash');
        expect(update[update.indexOf('--id') + 1]).toBe('9');
        expect(update[update.indexOf('--squash') + 1]).toBe('true');
    });

    it('parses create and existing-PR outputs', () => {
        expect(parseGhCreateOutput('Creating...\nhttps://github.com/o/r/pull/12\n')).toEqual({ url: 'https://github.com/o/r/pull/12', id: 12 });
        expect(parseGhCreateOutput('nothing')).toBeUndefined();
        expect(parseGhListOutput('[{"number":5,"url":"https://github.com/o/r/pull/5"}]')).toEqual({ url: 'https://github.com/o/r/pull/5', id: 5 });
        expect(parseGhListOutput('[]')).toBeUndefined();
        expect(parseAzPullRequest({ pullRequestId: 3, repository: { webUrl: `${ADO_URL}/` } })).toEqual({ url: `${ADO_URL}/pullrequest/3`, id: 3 });
        expect(parseAzListOutput(JSON.stringify([{ pullRequestId: 4, repository: { webUrl: ADO_URL } }]))).toEqual({ url: `${ADO_URL}/pullrequest/4`, id: 4 });
        expect(parseAzListOutput('[]')).toBeUndefined();
    });

    it('derives pr/<short-sha>-<slug> branch names', () => {
        expect(branchBaseName('abc1234', 'Fix: the Thing!')).toBe('pr/abc1234-fix-the-thing');
        expect(branchBaseName('abc1234', '!!!')).toBe('pr/abc1234');
    });
});

describe('createPullRequest (typed git operations)', () => {
    let tempDir: string;
    let git: { [K in keyof PullRequestGit]: ReturnType<typeof vi.fn<PullRequestGit[K]>> };
    let run: ReturnType<typeof vi.fn<PrCliRunner>>;
    const submit = (input: Partial<Parameters<typeof createPullRequest>[0]> = {}) =>
        createPullRequest({ repoRoot: '/repo', title: 'T', ...input }, { git, runCommand: run, tempDir });

    beforeEach(async () => {
        tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'coc-pr-test-'));
        git = {
            remoteUrl: vi.fn().mockResolvedValue(GH_URL), defaultBranch: vi.fn().mockResolvedValue('main'),
            commitsInRange: vi.fn().mockResolvedValue(['abcdef0']), resolveCommit: vi.fn().mockResolvedValue('abcdef0'),
            orderCommits: vi.fn().mockResolvedValue(['abcdef0']), refExists: vi.fn().mockResolvedValue(false),
            fetchBranch: vi.fn().mockResolvedValue(''), shortSha: vi.fn().mockResolvedValue('abcdef0'),
            commitSubject: vi.fn().mockResolvedValue('Add thing'), addWorktree: vi.fn().mockImplementation(async (_repo, _branch, filePath) => filePath),
            removeWorktree: vi.fn().mockResolvedValue(''), deleteBranch: vi.fn().mockResolvedValue(''),
            cherryPick: vi.fn().mockResolvedValue(''), skipCherryPick: vi.fn().mockResolvedValue(''),
            abortCherryPick: vi.fn().mockResolvedValue(''), status: vi.fn().mockResolvedValue(''),
            rebase: vi.fn().mockResolvedValue(''), abortRebase: vi.fn().mockResolvedValue(''),
            pushBranch: vi.fn().mockResolvedValue(''), currentBranch: vi.fn().mockResolvedValue('feature/x'),
            headSha: vi.fn().mockResolvedValue('aaa111'), remoteBranchSha: vi.fn().mockResolvedValue(''),
        };
        run = vi.fn(async (command, args) => {
            if (command === 'gh' && args[0] === 'pr' && args[1] === 'list') return { stdout: '[]', stderr: '' };
            if (command === 'gh' && args[0] === 'pr' && args[1] === 'create') return { stdout: 'https://github.com/example/repo/pull/42', stderr: '' };
            if (command === 'az' && args[2] === 'list') return { stdout: '[]', stderr: '' };
            if (command === 'az' && args[2] === 'create') return { stdout: JSON.stringify({ pullRequestId: 7, repository: { webUrl: ADO_URL } }), stderr: '' };
            return { stdout: '', stderr: '' };
        });
    });
    afterEach(async () => { await fsp.rm(tempDir, { recursive: true, force: true }); });

    it('pushes and creates through separate git and provider seams', async () => {
        expect(await submit({ title: 'My PR', body: 'Body' })).toEqual({
            url: 'https://github.com/example/repo/pull/42', id: 42, provider: 'github', branch: 'feature/x',
            base: 'main', existing: false, autoMerge: { requested: false, enabled: false },
        });
        expect(git.pushBranch).toHaveBeenCalledWith('/repo', 'feature/x');
        expect(run).toHaveBeenCalledWith('gh', ['auth', 'status'], { cwd: '/repo' });
        expect(run.mock.calls.every(([command]) => command === 'gh' || command === 'az')).toBe(true);
    });
    it('skips push when the remote SHA matches', async () => {
        git.remoteBranchSha.mockResolvedValue('aaa111');
        await submit();
        expect(git.pushBranch).not.toHaveBeenCalled();
    });
    it('returns an existing PR without creating another', async () => {
        run.mockImplementation(async (_command, args) => ({ stdout: args[1] === 'list'
            ? '[{"number":9,"url":"https://github.com/example/repo/pull/9"}]' : '', stderr: '' }));
        expect(await submit()).toMatchObject({ id: 9, existing: true });
        expect(run.mock.calls.some(([, args]) => args[1] === 'create')).toBe(false);
    });
    it.each([['main', 'on-base-branch'], ['HEAD', 'detached-head'], ['', 'detached-head']])('rejects branch %s with %s', async (branch, code) => {
        git.currentBranch.mockResolvedValue(branch);
        await expect(submit()).rejects.toMatchObject({ code });
        expect(git.pushBranch).not.toHaveBeenCalled();
    });
    it('honors an explicit base without querying defaults', async () => {
        expect(await submit({ base: 'release' })).toMatchObject({ base: 'release' });
        expect(git.defaultBranch).not.toHaveBeenCalled();
    });
    it('creates an ADO PR using argument files and enables auto-complete', async () => {
        git.remoteUrl.mockResolvedValue(ADO_URL);
        const handler = run.getMockImplementation()!;
        let title = '';
        run.mockImplementation(async (command, args, options) => {
            if (command === 'az' && args[2] === 'create') title = fs.readFileSync(args[args.indexOf('--title') + 1].slice(1), 'utf8');
            return handler(command, args, options);
        });
        expect(await submit({ title: 'A & B "quoted"', autoMerge: true, mergeMethod: 'squash' }))
            .toMatchObject({ provider: 'ado', id: 7, autoMerge: { enabled: true } });
        expect(title).toBe('A & B "quoted"');
        expect(run.mock.calls.some(([cmd, args]) => cmd === 'az' && args[2] === 'update')).toBe(true);
    });
    it('keeps a created PR when auto-merge fails', async () => {
        const handler = run.getMockImplementation()!;
        run.mockImplementation(async (cmd, args, options) => {
            if (args[1] === 'merge') throw new Error('auto-merge not allowed');
            return handler(cmd, args, options);
        });
        expect(await submit({ autoMerge: true })).toMatchObject({ id: 42, autoMerge: {
            requested: true, enabled: false, warning: expect.stringContaining('auto-merge not allowed'),
        } });
    });
    it('preserves CLI install/login errors', async () => {
        run.mockRejectedValue(Object.assign(new Error('spawn gh ENOENT'), { code: 'ENOENT' }));
        await expect(submit()).rejects.toMatchObject({ code: 'cli-missing', message: 'The `gh` CLI was not found. Install it (https://cli.github.com) and run `gh auth login`.' });
        git.remoteUrl.mockResolvedValue(ADO_URL);
        run.mockRejectedValue(new Error('Please run az login'));
        await expect(submit()).rejects.toMatchObject({ code: 'not-logged-in', message: 'The `az` CLI is not logged in. Run `az login`.' });
    });
    it('preserves missing-origin and invalid-remote errors before any provider CLI', async () => {
        git.remoteUrl.mockRejectedValueOnce(new Error('missing'));
        await expect(submit()).rejects.toMatchObject({ code: 'unknown-remote', message: 'The repository at /repo has no `origin` remote.' });
        git.remoteUrl.mockResolvedValue('/srv/git/repo.git');
        await expect(submit()).rejects.toMatchObject({ code: 'unknown-remote' });
        expect(run).not.toHaveBeenCalled();
    });
    it('preserves Git command diagnostics on failure', async () => {
        git.pushBranch.mockRejectedValue(new Error('git push -u origin feature/x failed: denied'));
        await expect(submit()).rejects.toMatchObject({ code: 'command-failed', message: 'git push -u origin feature/x failed: denied' });
    });
    it('requires a title before any IO', async () => {
        await expect(submit({ title: ' ' })).rejects.toMatchObject({ code: 'invalid-input' });
        expect(git.remoteUrl).not.toHaveBeenCalled();
    });
    it('aborts a conflicting pick and cleans the linked worktree and branch', async () => {
        git.cherryPick.mockRejectedValue(new Error('conflict'));
        git.refExists.mockImplementation(async (_cwd, ref) => ref === 'CHERRY_PICK_HEAD');
        git.status.mockResolvedValue('UU file.txt');
        await expect(submit({ commits: 'abc' })).rejects.toMatchObject({ code: 'conflict', commit: 'abcdef0' });
        const worktree = git.addWorktree.mock.calls[0][2];
        expect(git.cherryPick).toHaveBeenCalledWith(worktree, 'abcdef0');
        expect(git.abortCherryPick).toHaveBeenCalledWith(worktree);
        expect(git.removeWorktree).toHaveBeenCalledWith('/repo', worktree);
        expect(git.deleteBranch).toHaveBeenCalledWith('/repo', 'pr/abcdef0-add-thing');
        expect(git.pushBranch).not.toHaveBeenCalled();
        expect(fs.readdirSync(tempDir)).toEqual([]);
    });
    it('skips an empty pick, fetches again, rebases and retains the pushed branch', async () => {
        git.cherryPick.mockRejectedValue(new Error('empty'));
        git.refExists.mockImplementation(async (_cwd, ref) => ref === 'CHERRY_PICK_HEAD');
        await submit({ commits: 'abc' });
        const worktree = git.addWorktree.mock.calls[0][2];
        expect(git.skipCherryPick).toHaveBeenCalledWith(worktree);
        expect(git.fetchBranch.mock.calls).toEqual([['/repo', 'main'], [worktree, 'main']]);
        expect(git.rebase).toHaveBeenCalledWith(worktree, 'main');
        expect(git.pushBranch).toHaveBeenCalledWith(worktree, 'pr/abcdef0-add-thing');
        expect(git.deleteBranch).not.toHaveBeenCalled();
    });
    it('aborts a rebase conflict and removes the branch', async () => {
        git.rebase.mockRejectedValue(new Error('conflict'));
        await expect(submit({ commits: 'abc' })).rejects.toMatchObject({ code: 'conflict', message: expect.stringContaining('Rebasing onto origin/main conflicted') });
        expect(git.abortRebase).toHaveBeenCalled();
        expect(git.deleteBranch).toHaveBeenCalled();
    });
    it('suffixes generated branches on local collision', async () => {
        git.refExists.mockImplementation(async (_cwd, ref) => ref === 'refs/heads/pr/abcdef0-add-thing');
        expect(await submit({ commits: ['abc'] })).toMatchObject({ branch: 'pr/abcdef0-add-thing-2' });
    });
    it('suffixes explicit branches on remote collision without reading a label', async () => {
        git.refExists.mockImplementation(async (_cwd, ref) => ref === 'refs/remotes/origin/coc/work-items/x');
        expect(await submit({ commits: 'abc', branch: 'coc/work-items/x' })).toMatchObject({ branch: 'coc/work-items/x-2' });
        expect(git.shortSha).not.toHaveBeenCalled();
        expect(git.commitSubject).not.toHaveBeenCalled();
    });
    it('resolves lists and delegates topological ordering', async () => {
        git.resolveCommit.mockImplementation(async (_cwd, ref) => ref + '-sha');
        git.orderCommits.mockResolvedValue(['a-sha', 'b-sha']);
        await submit({ commits: ['b', 'a'] });
        expect(git.orderCommits).toHaveBeenCalledWith('/repo', ['b-sha', 'a-sha']);
        expect(git.cherryPick.mock.calls.map(call => call[1])).toEqual(['a-sha', 'b-sha']);
    });
    it('reports empty ranges without mutation', async () => {
        git.commitsInRange.mockResolvedValue([]);
        await expect(submit({ commits: 'a..b' })).rejects.toMatchObject({ code: 'no-commits' });
        expect(git.fetchBranch).not.toHaveBeenCalled();
    });
    it('uses the returned WSL worktree alias for picks, fetch, rebase and push', async () => {
        const alias = String.raw`\\wsl.localhost\Ubuntu\mnt\c\Temp\worktree`;
        git.addWorktree.mockResolvedValue(alias);
        await submit({ commits: 'abc' });
        expect(git.cherryPick).toHaveBeenCalledWith(alias, 'abcdef0');
        expect(git.fetchBranch).toHaveBeenLastCalledWith(alias, 'main');
        expect(git.rebase).toHaveBeenCalledWith(alias, 'main');
        expect(git.pushBranch).toHaveBeenCalledWith(alias, 'pr/abcdef0-add-thing');
        expect(git.removeWorktree).toHaveBeenCalledWith('/repo', alias);
        expect(run.mock.calls.every(([, , options]) => options.cwd === '/repo')).toBe(true);
    });
    it('passes the selected repository on every run', async () => {
        await submit({ repoRoot: '/other/repo' });
        for (const op of ['remoteUrl', 'defaultBranch', 'currentBranch', 'headSha', 'remoteBranchSha', 'pushBranch'] as const) {
            expect(git[op].mock.calls[0][0]).toBe('/other/repo');
        }
    });
});

describe('createPullRequest commits mode (real git)', () => {
    let root: string;
    let remote: string;
    let repo: string;

    const git = (cwd: string, ...args: string[]) =>
        execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

    beforeEach(async () => {
        root = await fsp.mkdtemp(path.join(os.tmpdir(), 'coc-pr-git-'));
        remote = path.join(root, 'remote.git');
        repo = path.join(root, 'repo');
        git(root, 'init', '--bare', '-b', 'main', remote);
        git(root, 'init', '-b', 'main', repo);
        for (const [k, v] of [['user.email', 't@example.com'], ['user.name', 'T'], ['commit.gpgsign', 'false']]) {
            git(repo, 'config', k, v);
        }
        // `remote.origin.url` looks like GitHub; git rewrites it to the local bare repo.
        git(repo, 'remote', 'add', 'origin', GH_URL);
        git(repo, 'config', `url.${remote}.insteadOf`, GH_URL);
        fs.writeFileSync(path.join(repo, 'file.txt'), 'base\n');
        git(repo, 'add', '.');
        git(repo, 'commit', '-m', 'base');
        git(repo, 'push', '-u', 'origin', 'main');
    });

    afterEach(async () => {
        await fsp.rm(root, { recursive: true, force: true });
    });

    /** Forge/Rust git; fake provider CLI. */
    function hybridRunner(): PrCliRunner {
        return async (command, args, { cwd }) => {
            if (args[0] === 'pr' && args[1] === 'list') return { stdout: '[]', stderr: '' };
            if (args[0] === 'pr' && args[1] === 'create') return { stdout: 'https://github.com/example/repo/pull/1\n', stderr: '' };
            return { stdout: '', stderr: '' };
        };
    }

    it('aborts on a conflict and leaves the caller repo, branch and HEAD unchanged', async () => {
        // Base moves on the remote; the local commit edits the same line.
        fs.writeFileSync(path.join(repo, 'file.txt'), 'local change\n');
        git(repo, 'commit', '-am', 'local edit');
        const localSha = git(repo, 'rev-parse', 'HEAD');
        git(repo, 'switch', '-c', 'upstream-work', 'origin/main');
        fs.writeFileSync(path.join(repo, 'file.txt'), 'upstream change\n');
        git(repo, 'commit', '-am', 'upstream edit');
        git(repo, 'push', 'origin', 'upstream-work:main');
        git(repo, 'switch', 'main');
        // Leave the caller's worktree dirty.
        fs.writeFileSync(path.join(repo, 'dirty.txt'), 'dirty\n');
        const headBefore = git(repo, 'rev-parse', 'HEAD');
        const tempDir = path.join(root, 'tmp');
        fs.mkdirSync(tempDir);

        const err = await createPullRequest({ repoRoot: repo, title: 'T', commits: localSha }, { runCommand: hybridRunner(), tempDir })
            .catch(e => e);

        expect(err).toMatchObject({ code: 'conflict', commit: localSha });
        expect(git(repo, 'rev-parse', 'HEAD')).toBe(headBefore);
        expect(git(repo, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('main');
        expect(git(repo, 'worktree', 'list', '--porcelain').match(/^worktree /gm)).toHaveLength(1);
        expect(git(repo, 'branch', '--list', 'pr/*')).toBe('');
        expect(fs.readdirSync(tempDir)).toEqual([]);
        expect(fs.existsSync(path.join(repo, 'dirty.txt'))).toBe(true);
    });

    it('cherry-picks onto a fresh branch, pushes it, and cleans up the worktree', async () => {
        fs.writeFileSync(path.join(repo, 'new.txt'), 'new\n');
        git(repo, 'add', 'new.txt');
        git(repo, 'commit', '-m', 'Add new file');
        const sha = git(repo, 'rev-parse', 'HEAD');
        fs.writeFileSync(path.join(repo, 'dirty.txt'), 'dirty\n');
        const tempDir = path.join(root, 'tmp');
        fs.mkdirSync(tempDir);

        const result = await createPullRequest({ repoRoot: repo, title: 'T', commits: `${sha}~1..${sha}` }, { runCommand: hybridRunner(), tempDir });

        expect(result).toMatchObject({ provider: 'github', id: 1, base: 'main', existing: false });
        expect(result.branch).toMatch(/^pr\/[0-9a-f]+-add-new-file$/);
        expect(git(remote, 'rev-parse', `refs/heads/${result.branch}^{tree}`)).toBe(git(repo, 'rev-parse', `${sha}^{tree}`));
        expect(git(repo, 'rev-parse', 'HEAD')).toBe(sha);
        expect(git(repo, 'worktree', 'list', '--porcelain').match(/^worktree /gm)).toHaveLength(1);
        expect(fs.readdirSync(tempDir)).toEqual([]);
    });
});
