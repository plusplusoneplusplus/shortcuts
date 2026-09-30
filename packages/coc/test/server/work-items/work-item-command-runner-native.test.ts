/**
 * The Work Item command runner's git half, against real repositories.
 *
 * `defaultWorkItemCommandRunner` runs `git` through the native `execGitAsync`
 * and only spawns a child for anything else (`gh`, `az`). The differences from
 * Node's `execFile` have to be shown to be invisible, and only a real
 * repository can show them:
 *
 *  - stdout loses one trailing line ending. Every git reader calls `.trim()`.
 *  - a git command's `stderr` comes back empty. Nothing reads it on success.
 *  - a failure is `git <args> failed: <stderr>` rather than Node's
 *    `Command failed:`.
 *
 * The last block drives a whole Work Item PR submission (through the shared
 * create-PR service) over the shipped runner, with only `gh` canned.
 */

import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { execFile } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { promisify } from 'util';
import { execGitAsync } from '@plusplusoneplusplus/forge';
import {
    defaultWorkItemCommandRunner,
} from '../../../src/server/work-items/work-item-execution-shared';
import { submitWorkItemPullRequest } from '../../../src/server/work-items/work-item-pr-submission-command';
import type { WorkItem, WorkItemChange } from '../../../src/server/work-items/types';

const execFileAsync = promisify(execFile);

let tmpDir: string;

/** A repository on `branch` with one commit, and a second file left dirty on request. */
async function makeRepo(name: string, branch = 'feature/current', dirty = false): Promise<string> {
    const dir = path.join(tmpDir, name);
    fs.mkdirSync(dir, { recursive: true });
    await execGitAsync(['init', '-q', '-b', branch, '.'], dir);
    await execGitAsync(['config', 'user.email', 'runner@example.com'], dir);
    await execGitAsync(['config', 'user.name', 'Runner'], dir);
    await execGitAsync(['config', 'commit.gpgsign', 'false'], dir);
    // Keeps the porcelain and diff assertions off Windows' CRLF normalization.
    await execGitAsync(['config', 'core.autocrlf', 'false'], dir);
    fs.writeFileSync(path.join(dir, 'tracked.txt'), 'one\n');
    await execGitAsync(['add', 'tracked.txt'], dir);
    await execGitAsync(['commit', '-q', '-m', 'first'], dir);
    if (dirty) {
        fs.writeFileSync(path.join(dir, 'tracked.txt'), 'two\n');
        fs.writeFileSync(path.join(dir, 'untracked.txt'), 'new\n');
    }
    return dir;
}

/** What the same command printed before the move: Node's own `execFile`. */
async function viaExecFile(args: string[], cwd: string): Promise<{ stdout: string; stderr: string }> {
    const { stdout, stderr } = await execFileAsync('git', args, { cwd, encoding: 'utf8' });
    return { stdout: stdout ?? '', stderr: stderr ?? '' };
}

/** A minimal work item / change pair; only these fields are read. */
function submissionInput(): { item: WorkItem; change: WorkItemChange } {
    const change = {
        id: 'change-1',
        planVersion: 2,
        taskId: 'task-1',
        status: 'closed',
        commits: [{ sha: '1111111111111111111111111111111111111111', message: 'First' }],
    } as unknown as WorkItemChange;
    const item = {
        id: 'wi-1',
        title: 'Runner item',
        description: 'Ship it.',
        status: 'aiDone',
        changes: [change],
    } as unknown as WorkItem;
    return { item, change };
}

const PR_URL = 'https://github.com/example/repo/pull/7';

beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wi-command-runner-'));
});

afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('defaultWorkItemCommandRunner, git path', () => {
    it('reports a clean working tree as an empty string', async () => {
        const dir = await makeRepo('clean');
        const result = await defaultWorkItemCommandRunner('git', ['status', '--porcelain'], { cwd: dir });
        expect(result).toEqual({ stdout: '', stderr: '' });
    });

    it('keeps porcelain output byte-identical but for the last line ending', async () => {
        const dir = await makeRepo('dirty', 'feature/current', true);
        const native = await defaultWorkItemCommandRunner('git', ['status', '--porcelain'], { cwd: dir });
        const legacy = await viaExecFile(['status', '--porcelain'], dir);

        expect(legacy.stdout).toBe(`${native.stdout}\n`);
        // The leading space of ` M tracked.txt` is what a `trim()` of the whole
        // buffer would have eaten; only the trailing newline goes.
        expect(native.stdout.split('\n')).toEqual([' M tracked.txt', '?? untracked.txt']);
        // The read that decides eligibility sees a non-empty string either way.
        expect(native.stdout.trim()).toBe(legacy.stdout.trim());
    });

    it('returns the current branch without its trailing newline', async () => {
        const dir = await makeRepo('branch-name');
        const native = await defaultWorkItemCommandRunner('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: dir });
        const legacy = await viaExecFile(['rev-parse', '--abbrev-ref', 'HEAD'], dir);

        expect(native.stdout).toBe('feature/current');
        expect(legacy.stdout).toBe('feature/current\n');
        expect(native.stdout.trim()).toBe(legacy.stdout.trim());
    });

    it('drops stderr on a successful git command', async () => {
        const dir = await makeRepo('fetch-source');
        const bare = path.join(tmpDir, 'origin.git');
        await execGitAsync(['init', '-q', '--bare', bare], tmpDir);
        await execGitAsync(['remote', 'add', 'origin', bare], dir);
        await execGitAsync(['push', '-q', 'origin', 'feature/current'], dir);

        const result = await defaultWorkItemCommandRunner('git', ['fetch', 'origin', 'feature/current'], { cwd: dir });

        expect(result.stderr).toBe('');
        // The fetch really ran: the remote-tracking ref exists now.
        expect(await execGitAsync(['rev-parse', '--verify', 'FETCH_HEAD'], dir)).toMatch(/^[0-9a-f]{40}$/);
    });

    it('rejects with the native runner wording, carrying the stderr git printed', async () => {
        const dir = await makeRepo('bad-ref');
        const stderr = await viaExecFile(['rev-parse', '--verify', 'no-such-ref'], dir).then(
            () => '',
            (err: { stderr?: string }) => (err.stderr ?? '').trim(),
        );
        expect(stderr).not.toBe('');

        await expect(
            defaultWorkItemCommandRunner('git', ['rev-parse', '--verify', 'no-such-ref'], { cwd: dir }),
        ).rejects.toThrow(`git rev-parse --verify no-such-ref failed: ${stderr}`);
    });

    it('still spawns a child, with both streams, for a command that is not git', async () => {
        const dir = await makeRepo('not-git');
        const result = await defaultWorkItemCommandRunner(
            process.execPath,
            ['-e', 'process.stdout.write("out"); process.stderr.write("err")'],
            { cwd: dir },
        );
        expect(result).toEqual({ stdout: 'out', stderr: 'err' });
    });
});

describe('submitWorkItemPullRequest over the shipped runner', () => {
    const GH_URL = 'https://github.com/example/runner-repo.git';

    /**
     * A repo whose `origin` reads as GitHub but pushes to a local bare repo
     * (`url.<bare>.insteadOf`), with one extra commit to submit on top of main.
     */
    async function makeSubmittableRepo(name: string): Promise<{ dir: string; bare: string; sha: string }> {
        const dir = await makeRepo(name, 'main');
        const bare = path.join(tmpDir, `${name}-origin.git`);
        await execGitAsync(['init', '-q', '--bare', bare], tmpDir);
        await execGitAsync(['remote', 'add', 'origin', GH_URL], dir);
        await execGitAsync(['config', `url.${bare}.insteadOf`, GH_URL], dir);
        await execGitAsync(['push', '-q', '-u', 'origin', 'main'], dir);
        await execGitAsync(['remote', 'set-head', 'origin', 'main'], dir);
        fs.writeFileSync(path.join(dir, 'feature.txt'), 'feature\n');
        await execGitAsync(['add', 'feature.txt'], dir);
        await execGitAsync(['commit', '-q', '-m', 'Add feature'], dir);
        const sha = (await execGitAsync(['rev-parse', 'HEAD'], dir)).trim();
        // Leave the workspace dirty: the submission must not care.
        fs.writeFileSync(path.join(dir, 'tracked.txt'), 'dirty\n');
        return { dir, bare, sha };
    }

    it('pushes a fresh branch through native git and leaves the workspace branch, HEAD and edits alone', async () => {
        const { dir, bare, sha } = await makeSubmittableRepo('submit-real');
        const { item, change } = submissionInput();
        change.commits = [{ sha, message: 'Add feature' }] as WorkItemChange['commits'];
        const headBefore = (await execGitAsync(['rev-parse', 'HEAD'], dir)).trim();
        const seen: string[] = [];

        const result = await submitWorkItemPullRequest({
            item,
            change,
            repoRoot: dir,
            branchName: 'coc/work-items/runner-item',
            tempDir: tmpDir,
            runCommand: async (command, args, options) => {
                seen.push(`${command} ${args.join(' ')}`);
                if (command === 'gh') {
                    if (args[1] === 'list') return { stdout: '[]', stderr: '' };
                    if (args[1] === 'create') return { stdout: `${PR_URL}\n`, stderr: '' };
                    return { stdout: '', stderr: '' };
                }
                return defaultWorkItemCommandRunner(command, args, options);
            },
        });

        expect(result).toEqual({ branchName: 'coc/work-items/runner-item', prUrl: PR_URL, prNumber: 7 });
        expect(seen).toContain('git fetch origin main');
        // The branch really reached the remote with the submitted commit's change.
        const pushed = (await execGitAsync(['--git-dir', bare, 'show', 'coc/work-items/runner-item:feature.txt'], tmpDir)).trim();
        expect(pushed).toBe('feature');
        // The workspace kept its branch, HEAD and uncommitted edit; the temp worktree is gone.
        expect((await execGitAsync(['rev-parse', '--abbrev-ref', 'HEAD'], dir)).trim()).toBe('main');
        expect((await execGitAsync(['rev-parse', 'HEAD'], dir)).trim()).toBe(headBefore);
        expect(fs.readFileSync(path.join(dir, 'tracked.txt'), 'utf8')).toBe('dirty\n');
        const worktrees = (await execGitAsync(['worktree', 'list', '--porcelain'], dir)).split('\n').filter(l => l.startsWith('worktree '));
        expect(worktrees).toHaveLength(1);
    });
});
