/**
 * What the Work Item command runner hands the native boundary.
 *
 * `timeout: 0` is the load-bearing one. This runner never had a timeout and
 * `execGitAsync` defaults to 30 s, so taking the default would kill the
 * `git fetch` and the `git push` of a real repository mid-transfer — the same
 * trap the clone route hit. A wall-clock test cannot show that without a slow
 * remote, so the option is asserted where it crosses instead.
 *
 * The mock wraps the real `execGitAsync` rather than replacing it, so every
 * case still runs against a real repository and the recording is a side
 * effect. The specifier is the root barrel because that is what
 * `work-item-execution-shared.ts` imports — mocking `@plusplusoneplusplus/forge/git`
 * would leave the barrel's own copy untouched.
 */

import { describe, expect, it, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const recorded = vi.hoisted(() => [] as Array<{
    args: string[];
    repoRoot: string;
    options?: { maxBuffer?: number; timeout?: number; cwd?: string };
}>);

vi.mock('@plusplusoneplusplus/forge', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@plusplusoneplusplus/forge')>();
    return {
        ...actual,
        execGitAsync: vi.fn(async (args: string[], repoRoot: string, options?: Record<string, unknown>) => {
            recorded.push({ args, repoRoot, options: options as never });
            return actual.execGitAsync(args, repoRoot, options as never);
        }),
    };
});

import { execGitAsync } from '@plusplusoneplusplus/forge';
import { defaultWorkItemCommandRunner } from '../../../src/server/work-items/work-item-execution-shared';

const TEN_MB = 1024 * 1024 * 10;

let tmpDir: string;
let repo: string;

beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wi-runner-options-'));
    repo = path.join(tmpDir, 'repo');
    fs.mkdirSync(repo, { recursive: true });
    await execGitAsync(['init', '-q', '-b', 'main', '.'], repo);
    await execGitAsync(['config', 'user.email', 'runner@example.com'], repo);
    await execGitAsync(['config', 'user.name', 'Runner'], repo);
    await execGitAsync(['config', 'commit.gpgsign', 'false'], repo);
    // Keeps the porcelain and diff assertions off Windows' CRLF normalization.
    await execGitAsync(['config', 'core.autocrlf', 'false'], repo);
    fs.writeFileSync(path.join(repo, 'tracked.txt'), 'one\n');
    await execGitAsync(['add', 'tracked.txt'], repo);
    await execGitAsync(['commit', '-q', '-m', 'first'], repo);
});

beforeEach(() => {
    recorded.length = 0;
});

afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('the options the git path crosses with', () => {
    it('asks for no deadline and the ten-megabyte buffer the runner always had', async () => {
        await defaultWorkItemCommandRunner('git', ['status', '--porcelain'], { cwd: repo });

        expect(recorded).toHaveLength(1);
        expect(recorded[0].options).toEqual({ maxBuffer: TEN_MB, timeout: 0 });
    });

    it('addresses the repository with -C rather than a working directory', async () => {
        await defaultWorkItemCommandRunner('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: repo });

        expect(recorded[0].repoRoot).toBe(repo);
        expect(recorded[0].args).toEqual(['rev-parse', '--abbrev-ref', 'HEAD']);
        expect(recorded[0].options?.cwd).toBeUndefined();
    });

    it('leaves a non-git command alone', async () => {
        const result = await defaultWorkItemCommandRunner(
            process.execPath,
            ['-e', 'process.stdout.write("ok")'],
            { cwd: repo },
        );

        expect(result.stdout).toBe('ok');
        expect(recorded).toHaveLength(0);
    });
});
