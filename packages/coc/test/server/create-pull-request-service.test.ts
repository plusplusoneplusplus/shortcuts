import { describe, it, expect, beforeEach, afterEach } from 'vitest';
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

const GH_URL = 'https://github.com/example/repo.git';
const ADO_URL = 'https://dev.azure.com/org/proj/_git/repo';

type Call = { command: string; args: string[]; cwd: string };
type Handler = (call: Call) => { stdout?: string; stderr?: string } | Error | undefined;

function fail(message: string, extra: Record<string, unknown> = {}): Error {
    return Object.assign(new Error(message), extra);
}

/** Fake runner: `handler` answers first; unhandled calls succeed with empty output. */
function fakeRunner(handler: Handler): PrCliRunner & { calls: Call[] } {
    const calls: Call[] = [];
    const runner = (async (command: string, args: string[], options: { cwd: string }) => {
        const call = { command, args, cwd: options.cwd };
        calls.push(call);
        const res = handler(call);
        if (res instanceof Error) throw res;
        return { stdout: res?.stdout ?? '', stderr: res?.stderr ?? '' };
    }) as PrCliRunner & { calls: Call[] };
    runner.calls = calls;
    return runner;
}

function line(call: Call): string {
    return `${call.command} ${call.args.join(' ')}`;
}

/** Happy-path answers for a current-branch run against `remoteUrl`. */
function currentBranchHandler(remoteUrl: string, overrides: Handler = () => undefined): Handler {
    return call => {
        const o = overrides(call);
        if (o) return o;
        const l = line(call);
        if (l === 'git config --get remote.origin.url') return { stdout: `${remoteUrl}\n` };
        if (l === 'git symbolic-ref --quiet --short refs/remotes/origin/HEAD') return { stdout: 'origin/main\n' };
        if (l === 'git rev-parse --abbrev-ref HEAD') return { stdout: 'feature/x\n' };
        if (l === 'git rev-parse HEAD') return { stdout: 'aaa111\n' };
        if (l.startsWith('git ls-remote --heads')) return { stdout: '' };
        if (l.startsWith('gh pr list')) return { stdout: '[]' };
        if (l.startsWith('gh pr create')) return { stdout: 'https://github.com/example/repo/pull/42\n' };
        if (l.startsWith('az repos pr list')) return { stdout: '[]' };
        if (l.startsWith('az repos pr create')) {
            return { stdout: JSON.stringify({ pullRequestId: 7, repository: { webUrl: ADO_URL } }) };
        }
        return undefined;
    };
}

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

describe('createPullRequest (fake runner)', () => {
    let tempDir: string;
    beforeEach(async () => {
        tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'coc-pr-test-'));
    });
    afterEach(async () => {
        await fsp.rm(tempDir, { recursive: true, force: true });
    });

    it('current-branch mode on GitHub pushes and creates the PR', async () => {
        const run = fakeRunner(currentBranchHandler(GH_URL));
        const result = await createPullRequest({ repoRoot: '/repo', title: 'My PR', body: 'Body' }, { runCommand: run, tempDir });
        expect(result).toEqual({
            url: 'https://github.com/example/repo/pull/42',
            id: 42,
            provider: 'github',
            branch: 'feature/x',
            base: 'main',
            existing: false,
            autoMerge: { requested: false, enabled: false },
        });
        const lines = run.calls.map(line);
        expect(lines).toContain('gh auth status');
        expect(lines).toContain('git push -u origin feature/x');
        expect(lines.some(l => l.startsWith('gh pr merge'))).toBe(false);
    });

    it('skips the push when the remote branch is already up to date', async () => {
        const run = fakeRunner(currentBranchHandler(GH_URL, c => line(c).startsWith('git ls-remote --heads') ? { stdout: 'aaa111\trefs/heads/feature/x\n' } : undefined));
        await createPullRequest({ repoRoot: '/repo', title: 'T' }, { runCommand: run, tempDir });
        expect(run.calls.map(line).some(l => l.startsWith('git push'))).toBe(false);
    });

    it('returns the existing open PR instead of creating another', async () => {
        const run = fakeRunner(currentBranchHandler(GH_URL, c => line(c).startsWith('gh pr list')
            ? { stdout: '[{"number":9,"url":"https://github.com/example/repo/pull/9"}]' }
            : undefined));
        const result = await createPullRequest({ repoRoot: '/repo', title: 'T' }, { runCommand: run, tempDir });
        expect(result).toMatchObject({ id: 9, existing: true });
        expect(run.calls.map(line).some(l => l.startsWith('gh pr create'))).toBe(false);
    });

    it('refuses when the current branch is the base branch', async () => {
        const run = fakeRunner(currentBranchHandler(GH_URL, c => line(c) === 'git rev-parse --abbrev-ref HEAD' ? { stdout: 'main\n' } : undefined));
        await expect(createPullRequest({ repoRoot: '/repo', title: 'T' }, { runCommand: run, tempDir }))
            .rejects.toMatchObject({ code: 'on-base-branch' });
    });

    it('creates an ADO PR through az with @file text and enables auto-complete', async () => {
        let titleText = '';
        const run = fakeRunner(currentBranchHandler(ADO_URL, c => {
            if (line(c).startsWith('az repos pr create')) {
                const titleArg = c.args[c.args.indexOf('--title') + 1];
                titleText = fs.readFileSync(titleArg.slice(1), 'utf8');
            }
            return undefined;
        }));
        const result = await createPullRequest(
            { repoRoot: '/repo', title: 'A & B "quoted"', body: 'x', autoMerge: true, mergeMethod: 'squash' },
            { runCommand: run, tempDir },
        );
        expect(titleText).toBe('A & B "quoted"');
        expect(result).toMatchObject({ provider: 'ado', id: 7, url: `${ADO_URL}/pullrequest/7`, autoMerge: { requested: true, enabled: true } });
        const lines = run.calls.map(line);
        expect(lines).toContain('az account show --output none');
        expect(lines.some(l => l.startsWith('az repos pr update --id 7 --auto-complete true --squash true'))).toBe(true);
    });

    it('keeps the PR and returns a warning when auto-merge fails', async () => {
        const run = fakeRunner(currentBranchHandler(GH_URL, c => line(c).startsWith('gh pr merge') ? fail('auto-merge not allowed') : undefined));
        const result = await createPullRequest({ repoRoot: '/repo', title: 'T', autoMerge: true }, { runCommand: run, tempDir });
        expect(result.id).toBe(42);
        expect(result.autoMerge.requested).toBe(true);
        expect(result.autoMerge.enabled).toBe(false);
        expect(result.autoMerge.warning).toMatch(/auto-merge/);
    });

    it('names the CLI and install/login steps when gh is missing', async () => {
        const run = fakeRunner(currentBranchHandler(GH_URL, c => c.command === 'gh' ? fail('spawn gh ENOENT', { code: 'ENOENT' }) : undefined));
        await expect(createPullRequest({ repoRoot: '/repo', title: 'T' }, { runCommand: run, tempDir }))
            .rejects.toMatchObject({ code: 'cli-missing', message: expect.stringContaining('gh auth login') });
    });

    it('reports a not-logged-in az with the login command', async () => {
        const run = fakeRunner(currentBranchHandler(ADO_URL, c => line(c).startsWith('az account show') ? fail('Please run az login') : undefined));
        await expect(createPullRequest({ repoRoot: '/repo', title: 'T' }, { runCommand: run, tempDir }))
            .rejects.toMatchObject({ code: 'not-logged-in', message: expect.stringContaining('az login') });
    });

    it('fails with unknown-remote before touching any CLI', async () => {
        const run = fakeRunner(currentBranchHandler('/srv/git/repo.git'));
        await expect(createPullRequest({ repoRoot: '/repo', title: 'T' }, { runCommand: run, tempDir }))
            .rejects.toMatchObject({ code: 'unknown-remote' });
        expect(run.calls.every(c => c.command === 'git')).toBe(true);
    });

    it('requires a title', async () => {
        const run = fakeRunner(currentBranchHandler(GH_URL));
        await expect(createPullRequest({ repoRoot: '/repo', title: '  ' }, { runCommand: run, tempDir }))
            .rejects.toMatchObject({ code: 'invalid-input' });
    });

    it('commits mode aborts on conflict, removes the worktree, deletes the branch, and never touches the caller HEAD', async () => {
        const run = fakeRunner(currentBranchHandler(GH_URL, c => {
            const l = line(c);
            if (l === 'git rev-parse --verify abc^{commit}') return { stdout: 'abcdef0\n' };
            if (l === 'git rev-parse --short abcdef0') return { stdout: 'abcdef0\n' };
            if (l === 'git log -1 --pretty=%s abcdef0') return { stdout: 'Add thing\n' };
            if (l.startsWith('git rev-parse --verify --quiet refs/')) return fail('missing');
            if (l === 'git cherry-pick abcdef0') return fail('conflict');
            if (l === 'git rev-parse --verify --quiet CHERRY_PICK_HEAD') return { stdout: 'abcdef0\n' };
            if (l === 'git status --porcelain') return { stdout: 'UU file.txt\n' };
            return undefined;
        }));
        const err = await createPullRequest({ repoRoot: '/repo', title: 'T', commits: 'abc' }, { runCommand: run, tempDir })
            .catch(e => e);
        expect(err).toBeInstanceOf(CreatePullRequestError);
        expect(err.code).toBe('conflict');
        expect(err.commit).toBe('abcdef0');
        const lines = run.calls.map(line);
        expect(lines).toContain('git cherry-pick --abort');
        expect(lines.some(l => l.startsWith('git worktree remove --force'))).toBe(true);
        expect(lines).toContain('git branch -D pr/abcdef0-add-thing');
        expect(lines.some(l => /^git (checkout|switch|reset)/.test(l))).toBe(false);
        expect(lines.some(l => l.startsWith('git push') || l.startsWith('gh pr create'))).toBe(false);
        // Only the worktree commands run outside the caller's repo.
        const outside = run.calls.filter(c => c.cwd !== '/repo').map(line);
        expect(outside.every(l => !l.startsWith('git worktree') && !l.startsWith('git branch'))).toBe(true);
        expect(fs.readdirSync(tempDir)).toEqual([]);
    });

    it('commits mode adds a numeric suffix on branch collision', async () => {
        const run = fakeRunner(currentBranchHandler(GH_URL, c => {
            const l = line(c);
            if (l === 'git rev-parse --verify abc^{commit}') return { stdout: 'abcdef0\n' };
            if (l === 'git rev-parse --short abcdef0') return { stdout: 'abcdef0\n' };
            if (l === 'git log -1 --pretty=%s abcdef0') return { stdout: 'Add thing\n' };
            if (l === 'git rev-parse --verify --quiet refs/heads/pr/abcdef0-add-thing') return { stdout: 'x' };
            if (l.startsWith('git rev-parse --verify --quiet refs/')) return fail('missing');
            return undefined;
        }));
        const result = await createPullRequest({ repoRoot: '/repo', title: 'T', commits: ['abc'] }, { runCommand: run, tempDir });
        expect(result.branch).toBe('pr/abcdef0-add-thing-2');
        const lines = run.calls.map(line);
        expect(lines).toContain('git push -u origin pr/abcdef0-add-thing-2');
        expect(lines.some(l => l.startsWith('git branch -D'))).toBe(false);
        expect(lines.some(l => l.startsWith('git worktree remove --force'))).toBe(true);
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

    /** Real git; fake gh. */
    function hybridRunner(): PrCliRunner {
        return async (command, args, { cwd }) => {
            if (command === 'git') {
                return { stdout: execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }), stderr: '' };
            }
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
