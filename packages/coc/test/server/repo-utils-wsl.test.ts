import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('child_process', async () => {
    const actual = await vi.importActual<typeof import('child_process')>('child_process');
    return {
        ...actual,
        execFileSync: vi.fn(),
    };
});

import * as childProcess from 'child_process';
import { getWslExecutablePath } from '@plusplusoneplusplus/forge';
import { findGitRoot, normalizeRepoPath } from '../../src/server/repo-utils';

describe('repo-utils (WSL)', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('routes git root discovery through wsl.exe for WSL paths', () => {
        const spy = vi.spyOn(childProcess, 'execFileSync').mockReturnValue('/home/tester/repo\n' as never);
        const repoPath = String.raw`\\wsl$\Ubuntu\home\tester\repo`;

        const gitRoot = findGitRoot(repoPath);

        expect(gitRoot).toBe('/home/tester/repo');
        expect(spy).toHaveBeenCalledWith(
            getWslExecutablePath(),
            expect.arrayContaining(['-d', 'Ubuntu', '--', 'sh', '-lc']),
            expect.objectContaining({ encoding: 'utf8' }),
        );
    });

    it('normalizes WSL paths to a stable repo identity', () => {
        const repoPath = `${String.raw`\\wsl$\Ubuntu\home\tester\repo`}\\`;
        expect(normalizeRepoPath(repoPath)).toBe('wsl://ubuntu/home/tester/repo');
    });
});
