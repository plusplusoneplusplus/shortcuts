/**
 * WSL routing for `BranchService`, which stays in TypeScript.
 *
 * A repository inside a distro never reaches the addon: the commands still go
 * out through `wsl.exe` from Node. That dispatch is the one thing left in this
 * service worth asserting against a mocked child process rather than a real
 * repository, because the distro it targets does not exist on the test box.
 *
 * Windows-only, like the routing itself — `resolveWorkspaceExecutionContext`
 * only reports `kind: 'wsl'` for a `\\wsl$\...` path on win32.
 */

import { describe, expect, it, vi, beforeEach, type Mock } from 'vitest';
import { execFileAsync } from '../../src/utils/exec-utils';
import { BranchService } from '../../src/git/branch-service';
import { setLogger, nullLogger } from '../../src/logger';

vi.mock('../../src/utils/exec-utils', () => ({
    execAsync: vi.fn(),
    execFileAsync: vi.fn(),
}));

vi.mock('../../src/git/safe-directory', () => ({
    ensureGitSafeDirectorySync: vi.fn(),
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

const mockedExecFileAsync = execFileAsync as Mock;
const WSL_REPO = String.raw`\\wsl$\Ubuntu\home\tester\repo`;
const IN_DISTRO = ['-d', 'Ubuntu', '--cd', '/home/tester/repo', '--'];

let service: BranchService;

beforeEach(() => {
    vi.clearAllMocks();
    setLogger(nullLogger);
    service = new BranchService();
});

describe.runIf(process.platform === 'win32')('BranchService inside a WSL distro', () => {
    it('routes a checkout through wsl.exe as an argv array', async () => {
        mockedExecFileAsync.mockResolvedValueOnce({ stdout: '', stderr: '' });

        const result = await service.switchBranch(WSL_REPO, 'main');

        expect(result).toEqual({ success: true });
        expect(mockedExecFileAsync).toHaveBeenCalledWith(
            expect.stringContaining('wsl.exe'),
            [...IN_DISTRO, 'git', 'checkout', 'main'],
            expect.objectContaining({
                windowsHide: true,
                env: expect.objectContaining({ GIT_TERMINAL_PROMPT: '0' }),
            }),
        );
    });

    it('routes a scoped fetch through wsl.exe with the ten-minute timeout', async () => {
        mockedExecFileAsync
            .mockResolvedValueOnce({ stdout: 'feature/local\n', stderr: '' })
            .mockResolvedValueOnce({ stdout: 'upstream\n', stderr: '' })
            .mockResolvedValueOnce({ stdout: 'refs/heads/release/2.0\n', stderr: '' })
            .mockResolvedValueOnce({ stdout: '', stderr: '' })
            .mockResolvedValueOnce({ stdout: '', stderr: '' });

        const result = await service.fetchCurrentBranch(WSL_REPO);

        expect(result).toEqual({ success: true });
        expect(mockedExecFileAsync).toHaveBeenNthCalledWith(
            5,
            expect.stringContaining('wsl.exe'),
            [...IN_DISTRO, 'git', 'fetch', '--no-tags', '--', 'upstream', 'refs/heads/release/2.0'],
            expect.objectContaining({ timeout: 600_000 }),
        );
    });

    it('translates a path-shaped argument into the distro namespace', async () => {
        mockedExecFileAsync.mockResolvedValueOnce({ stdout: '', stderr: '' });

        // Git inside the distro cannot open a UNC path; the temporary patch and
        // commit-message files this service writes take the same route.
        await service.fetch(WSL_REPO, String.raw`\\wsl$\Ubuntu\home\tester\other`);

        expect(mockedExecFileAsync).toHaveBeenCalledWith(
            expect.stringContaining('wsl.exe'),
            [...IN_DISTRO, 'git', 'fetch', '/home/tester/other'],
            expect.anything(),
        );
    });

    it('reports a failure with the shared git error text', async () => {
        mockedExecFileAsync.mockRejectedValueOnce(
            Object.assign(new Error('Command failed'), { stderr: 'fatal: no such branch\n' }),
        );

        const result = await service.switchBranch(WSL_REPO, 'nonexistent');

        expect(result).toEqual({
            success: false,
            error: 'git checkout nonexistent failed: fatal: no such branch',
        });
    });
});
