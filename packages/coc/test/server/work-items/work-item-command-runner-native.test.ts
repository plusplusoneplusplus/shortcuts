/**
 * The Work Item command runner's git half, against real repositories.
 *
 * `defaultWorkItemCommandRunner` used to be one `execFile`, so the nine git
 * commands behind `POST .../submit-pr` were nine children spawned from the
 * event-loop thread. `git` now goes through `execGitAsync` and only `gh` still
 * spawns. Three differences have to be shown to be invisible, and only a real
 * repository can show them:
 *
 *  - stdout loses one trailing line ending. Every git reader here calls
 *    `.trim()`, so the value they compare is unchanged — asserted against what
 *    the same command prints through Node.
 *  - a git command's `stderr` comes back empty. Nothing reads it on success.
 *  - a failure is `git <args> failed: <stderr>` rather than Node's
 *    `Command failed:`. Nobody classifies on that text; `resolveDefaultBaseBranch`
 *    catches it whole and falls back to `main`, which the last case drives.
 *
 * The runner is injectable and every existing case injects one, so nothing
 * exercised the shipped path — that is what this file is for. The mutating and
 * network commands are still canned: what is under test is who runs the reads.
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
    type WorkItemCommandRunner,
} from '../../../src/server/work-items/work-item-execution-shared';
import { submitWorkItemPullRequest } from '../../../src/server/work-items/work-item-pr-submission-command';
import type { WorkItem, WorkItemChange } from '../../../src/server/work-items/types';

const execFileAsync = promisify(execFile);

/** The commands the hybrid runner is allowed to run for real. */
const REAL_READS = new Set(['status', 'rev-parse', 'symbolic-ref']);

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

/**
 * Run the reads for real and can the rest, recording every command line.
 *
 * `fetch`, `switch`, `cherry-pick` and `push` are the mutating and network half
 * of the sequence; this file is about who runs the reads that feed them.
 */
function hybridRunner(canned: Record<string, { stdout: string; stderr: string }> = {}) {
    const seen: string[] = [];
    const run: WorkItemCommandRunner = async (command, args, options) => {
        seen.push(`${command} ${args.join(' ')}`);
        if (command === 'git' && REAL_READS.has(args[0])) {
            return defaultWorkItemCommandRunner(command, args, options);
        }
        return canned[`${command} ${args.join(' ')}`] ?? { stdout: '', stderr: '' };
    };
    return { run, seen };
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
    it('reads the branch and the clean tree from native git, falling back to main', async () => {
        const dir = await makeRepo('submit-no-origin');
        const { item, change } = submissionInput();
        const { run, seen } = hybridRunner();

        const result = await submitWorkItemPullRequest({
            item,
            change,
            repoRoot: dir,
            branchName: 'coc/work-items/runner-item',
            runCommand: async (command, args, options) => {
                if (command === 'gh') return { stdout: `${PR_URL}\n`, stderr: '' };
                return run(command, args, options);
            },
        });

        expect(result).toEqual({ branchName: 'coc/work-items/runner-item', prUrl: PR_URL, prNumber: 7 });
        // `symbolic-ref --quiet` fails in a repo with no origin/HEAD; the real
        // rejection reaches the catch and the fallback base branch is used.
        expect(seen).toContain('git symbolic-ref --quiet --short refs/remotes/origin/HEAD');
        expect(seen).toContain('git fetch origin main');
        expect(seen).toContain('git switch -c coc/work-items/runner-item origin/main');
        // The branch restored at the end is the one native git reported.
        expect(seen[seen.length - 1]).toBe('git switch feature/current');
    });

    it('takes the base branch from a real origin/HEAD', async () => {
        const dir = await makeRepo('submit-origin-head');
        await execGitAsync(['update-ref', 'refs/remotes/origin/trunk', 'HEAD'], dir);
        await execGitAsync(['symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/trunk'], dir);
        const { item, change } = submissionInput();
        const { run, seen } = hybridRunner();

        await submitWorkItemPullRequest({
            item,
            change,
            repoRoot: dir,
            branchName: 'coc/work-items/from-origin-head',
            runCommand: async (command, args, options) => {
                if (command === 'gh') return { stdout: `${PR_URL}\n`, stderr: '' };
                return run(command, args, options);
            },
        });

        expect(seen).toContain('git fetch origin trunk');
        expect(seen).toContain('git switch -c coc/work-items/from-origin-head origin/trunk');
    });

    it('refuses a dirty workspace on the strength of native porcelain output', async () => {
        const dir = await makeRepo('submit-dirty', 'feature/current', true);
        const { item, change } = submissionInput();
        const { run, seen } = hybridRunner();

        await expect(
            submitWorkItemPullRequest({ item, change, repoRoot: dir, runCommand: run }),
        ).rejects.toThrow('Cannot submit PR because the workspace has uncommitted changes');
        expect(seen).toEqual(['git status --porcelain']);
    });
});
