import { expect, it, vi } from 'vitest';
import { loadNativeGit } from '@plusplusoneplusplus/coc-native';
import { createPullRequestIterationDiffProvider } from '../../src/diff/pr-diff-provider';

vi.mock('../../src/utils/workspace-execution', () => ({
    resolveWorkspaceExecutionContext: () => ({ kind: 'wsl', linuxWorkingDirectory: '/fixture/repo' }),
}));

it('rejects unresolved default WSL identity before opening a scope or fetching authenticated data', async () => {
    const open = vi.spyOn(loadNativeGit(), 'openRemoteGitPatchStore');
    const fetch = vi.fn().mockResolvedValue('');
    const provider = createPullRequestIterationDiffProvider({
        kind: 'pr-iteration', provider: 'ado', repositoryRoot: 'wsl-workspace',
        remoteRepositoryId: 'routing-alias', pullRequestId: 1, iterationId: 3,
    }, fetch, { workspaceId: 'workspace-a', host: 'provider.example', repository: 'org/project/repo' });
    await expect(provider.getFullDiff()).rejects.toThrow('requires a resolved WSL distro identity');
    expect(open).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    vi.restoreAllMocks();
});
