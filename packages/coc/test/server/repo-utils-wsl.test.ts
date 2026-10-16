import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@plusplusoneplusplus/forge', async original => ({
    ...await original<typeof import('@plusplusoneplusplus/forge')>(),
    discoverGitRepoRoot: vi.fn(),
}));

import { discoverGitRepoRoot } from '@plusplusoneplusplus/forge';
import { findGitRoot, normalizeRepoPath } from '../../src/server/git/repo-utils';

describe('repo-utils (WSL)', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('delegates repository discovery to Forge with the exact workspace path', async () => {
        vi.mocked(discoverGitRepoRoot).mockResolvedValueOnce('/home/tester/repo');
        const repoPath = String.raw`\\wsl$\Ubuntu\home\tester\repo`;
        expect(await findGitRoot(repoPath)).toBe('/home/tester/repo');
        expect(discoverGitRepoRoot).toHaveBeenCalledWith(repoPath);
    });

    it.runIf(process.platform === 'win32')('normalizes WSL paths to a stable repo identity', () => {
        const repoPath = `${String.raw`\\wsl$\Ubuntu\home\tester\repo`}\\`;
        expect(normalizeRepoPath(repoPath)).toBe('wsl://ubuntu/home/tester/repo');
    });
});
