/**
 * Tests for execGitAsync — the dispatch point between the native addon and the
 * `wsl.exe` path that stays in TypeScript.
 *
 * The native path is exercised against a real temporary repository rather than
 * by asserting which child process was spawned: git no longer runs as a Node
 * child, so the only contract left is the observable one — trimmed stdout, the
 * `git <args> failed: <stderr>` rejection, and the option defaults.
 */

import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import { execGitAsync } from '../../src/git/exec';
import { execFileAsync } from '../../src/utils/exec-utils';
import { ensureGitSafeDirectoryAsync } from '../../src/git/safe-directory';

vi.mock('../../src/utils/exec-utils', () => ({
    execFileAsync: vi.fn(),
}));

vi.mock('../../src/git/safe-directory', () => ({
    ensureGitSafeDirectoryAsync: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../src/utils/workspace-execution', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../src/utils/workspace-execution')>();
    return {
        ...actual,
        getWslExecutablePath: vi.fn().mockReturnValue('C:\\Windows\\System32\\wsl.exe'),
        resolveWorkspaceExecutionContext: vi.fn((workingDirectory?: string) => {
            if (workingDirectory?.startsWith('\\\\wsl$')) {
                return actual.resolveWorkspaceExecutionContext(workingDirectory);
            }
            return { kind: 'windows', workingDirectory };
        }),
    };
});

const mockedExecFileAsync = vi.mocked(execFileAsync);
const mockedEnsureSafeDirectory = vi.mocked(ensureGitSafeDirectoryAsync);

let repo: string;
let repoWithSpaces: string;

function git(cwd: string, ...args: string[]): void {
    execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf-8' });
}

function makeRepo(prefix: string): string {
    const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
    git(dir, 'init', '--initial-branch=main');
    git(dir, 'config', 'user.email', 'ralph@example.com');
    git(dir, 'config', 'user.name', 'Ralph');
    git(dir, 'config', 'commit.gpgsign', 'false');
    fs.writeFileSync(path.join(dir, 'README.md'), 'hello\n');
    git(dir, 'add', '.');
    git(dir, 'commit', '-m', 'initial commit');
    return dir;
}

beforeAll(() => {
    repo = makeRepo('forge-exec-async-');
    repoWithSpaces = makeRepo('forge exec async with spaces ');
});

afterAll(() => {
    for (const dir of [repo, repoWithSpaces]) {
        if (dir) fs.rmSync(dir, { recursive: true, force: true });
    }
});

describe('execGitAsync on the native path', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockedEnsureSafeDirectory.mockResolvedValue(undefined);
    });

    it('resolves with trimmed stdout on success', async () => {
        await expect(execGitAsync(['rev-parse', '--abbrev-ref', 'HEAD'], repo)).resolves.toBe('main');
    });

    it('resolves with an empty string when the command prints nothing', async () => {
        await expect(execGitAsync(['status', '--porcelain'], repo)).resolves.toBe('');
    });

    it('handles repo paths with spaces correctly', async () => {
        await expect(execGitAsync(['rev-parse', '--abbrev-ref', 'HEAD'], repoWithSpaces)).resolves.toBe(
            'main',
        );
    });

    it('handles arguments with spaces without quoting them', async () => {
        await expect(
            execGitAsync(['log', '-1', '--format=%s', '--', 'README.md'], repo),
        ).resolves.toBe('initial commit');
    });

    it('never reaches the Node child-process helper', async () => {
        await execGitAsync(['rev-parse', 'HEAD'], repo);
        expect(mockedExecFileAsync).not.toHaveBeenCalled();
    });

    it('ensures the safe.directory entry before running', async () => {
        await execGitAsync(['rev-parse', 'HEAD'], repo);
        expect(mockedEnsureSafeDirectory).toHaveBeenCalledWith(repo);
    });

    it('rejects with the git <args> failed: shape on a non-zero exit', async () => {
        await expect(execGitAsync(['rev-parse', 'nope-not-a-ref'], repo)).rejects.toThrow(
            /^git rev-parse nope-not-a-ref failed: /,
        );
    });

    it('rejects when the path is not a repository', async () => {
        const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-exec-async-empty-'));
        try {
            await expect(execGitAsync(['status'], empty)).rejects.toThrow(/^git status failed: /);
        } finally {
            fs.rmSync(empty, { recursive: true, force: true });
        }
    });

    it('wraps a safe.directory failure in the same error shape', async () => {
        mockedEnsureSafeDirectory.mockRejectedValueOnce(new Error('config failed'));
        await expect(execGitAsync(['status'], repo)).rejects.toThrow('git status failed:');
    });

    it('applies a custom timeout, killing a command that outlives it', async () => {
        await expect(
            execGitAsync(['-c', 'alias.nap=!sleep 30', 'nap'], repo, { timeout: 250 }),
        ).rejects.toThrow(/^git -c alias\.nap=!sleep 30 nap failed: /);
    });

    it('applies a custom maxBuffer', async () => {
        await expect(execGitAsync(['log', '--format=%H %s'], repo, { maxBuffer: 8 })).rejects.toThrow(
            /^git log --format=%H %s failed: /,
        );
    });

    it('uses defaults generous enough for an ordinary command', async () => {
        await expect(execGitAsync(['log', '--format=%s'], repo)).resolves.toBe('initial commit');
    });

    it('runs concurrent calls against one repo without interleaving output', async () => {
        const heads = await Promise.all(
            Array.from({ length: 8 }, () => execGitAsync(['rev-parse', 'HEAD'], repo)),
        );
        expect(new Set(heads).size).toBe(1);
        expect(heads[0]).toMatch(/^[0-9a-f]{40}$/);
    });
});

describe('execGitAsync on the WSL path', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockedEnsureSafeDirectory.mockResolvedValue(undefined);
    });

    // WSL routing deliberately stays in TypeScript: the addon runs git on the
    // host and never learns that WSL exists, so this path must keep spawning
    // wsl.exe from Node.
    it.runIf(process.platform === 'win32')('routes WSL repos through wsl.exe', async () => {
        mockedExecFileAsync.mockResolvedValue({ stdout: 'main\n', stderr: '' });

        const repoRoot = String.raw`\\wsl$\Ubuntu\home\tester\repo`;
        const result = await execGitAsync(['rev-parse', '--abbrev-ref', 'HEAD'], repoRoot);

        expect(result).toBe('main');
        expect(mockedExecFileAsync).toHaveBeenCalledWith(
            expect.stringContaining('wsl.exe'),
            ['-d', 'Ubuntu', '--cd', '/home/tester/repo', '--', 'git', '-C', '/home/tester/repo', 'rev-parse', '--abbrev-ref', 'HEAD'],
            expect.objectContaining({ windowsHide: true, maxBuffer: 50 * 1024 * 1024, timeout: 30_000 }),
        );
    });

    it.runIf(process.platform === 'win32')('rejects with the same error shape', async () => {
        mockedExecFileAsync.mockRejectedValue(
            Object.assign(new Error('fail'), { stderr: 'fatal: not a git repository' }),
        );

        await expect(
            execGitAsync(['status'], String.raw`\\wsl$\Ubuntu\home\tester\repo`),
        ).rejects.toThrow('git status failed: fatal: not a git repository');
    });
});
