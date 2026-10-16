import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { loadNativeGit } from '@plusplusoneplusplus/coc-native';
import { discoverGitRepoRoot } from '../../src/git/discover-repo-root';
import { ensureGitSafeDirectoryAsync } from '../../src/git/safe-directory';
import { resolveWorkspaceExecutionContext } from '../../src/utils/workspace-execution';
import { execFileAsync } from '../../src/utils/exec-utils';

vi.mock('@plusplusoneplusplus/coc-native', async original => {
    const actual = await original<typeof import('@plusplusoneplusplus/coc-native')>();
    return { ...actual, loadNativeGit: vi.fn(actual.loadNativeGit) };
});
vi.mock('../../src/git/safe-directory', () => ({ ensureGitSafeDirectoryAsync: vi.fn() }));
vi.mock('../../src/utils/exec-utils', () => ({ execFileAsync: vi.fn() }));
vi.mock('../../src/utils/workspace-execution', async original => ({
    ...await original<typeof import('../../src/utils/workspace-execution')>(),
    resolveWorkspaceExecutionContext: vi.fn(),
    getWslExecutablePath: vi.fn(() => 'wsl.exe'),
    translatePathForHostFilesystem: (value: string) => value,
}));
let repo: string;
beforeAll(async () => {
    repo = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'forge-discover-')));
    execFileSync('git', ['init', '--initial-branch=main', repo]);
    await fs.writeFile(path.join(repo, 'file.txt'), 'hello');
});
afterAll(() => fs.rm(repo, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }));
beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(resolveWorkspaceExecutionContext).mockReturnValue({ kind: 'windows', workingDirectory: repo });
});
it('discovers host repositories from files and directories through the real addon', async () => {
    expect(path.normalize((await discoverGitRepoRoot(repo))!)).toBe(path.normalize(repo));
    expect(path.normalize((await discoverGitRepoRoot(path.join(repo, 'file.txt')))!)).toBe(path.normalize(repo));
    expect(ensureGitSafeDirectoryAsync).toHaveBeenCalledWith(repo);
    expect(execFileAsync).not.toHaveBeenCalled();
    expect(await discoverGitRepoRoot(path.join(os.tmpdir(), 'no-such-forge-repo', 'file'))).toBeNull();
});
it.each(['directory', 'file'])('routes WSL discovery from a %s through runGitViaWsl', async kind => {
    const target = kind === 'directory' ? repo : path.join(repo, 'file.txt');
    vi.mocked(resolveWorkspaceExecutionContext).mockReturnValue({ kind: 'wsl', distro: 'Ubuntu',
        linuxWorkingDirectory: target, originalWorkingDirectory: target });
    vi.mocked(execFileAsync).mockResolvedValue({ stdout: '/repo\n', stderr: '' });
    expect(await discoverGitRepoRoot(target)).toBe('/repo');
    expect(execFileAsync).toHaveBeenCalledWith('wsl.exe', [
        '-d', 'Ubuntu', '--cd', kind === 'directory' ? target : path.posix.dirname(target), '--', 'git', 'rev-parse', '--show-toplevel',
    ], expect.objectContaining({ timeout: 30_000 }));
});
it('reports inaccessible WSL repositories as absent', async () => {
    vi.mocked(resolveWorkspaceExecutionContext).mockReturnValue({ kind: 'wsl', distro: 'Ubuntu',
        linuxWorkingDirectory: '/absent', originalWorkingDirectory: '/absent' });
    vi.mocked(execFileAsync).mockRejectedValue(new Error('missing'));
    expect(await discoverGitRepoRoot('/absent')).toBeNull();
});

it('propagates an unusable host addon instead of returning an absent root', async () => {
    vi.mocked(loadNativeGit).mockImplementationOnce(() => { throw new Error('rebuild the addon'); });
    await expect(discoverGitRepoRoot(repo)).rejects.toThrow('rebuild the addon');
});
