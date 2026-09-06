/**
 * The coc copy of `hostRepoPath` has to agree with forge's classifier, since
 * that is the code every fixture path in the git suites is read by.
 *
 * See `packages/forge/test/helpers/host-repo-path.test.ts` for why this matters:
 * a POSIX absolute path on win32 means WSL, so a suite hardcoding `/repo` takes
 * a different branch on the Windows runners than it does anywhere else.
 */

import { describe, expect, it, afterEach } from 'vitest';
import { resolveWorkspaceExecutionContext } from '@plusplusoneplusplus/forge';
import { hostRepoPath } from './host-repo-path';

const realPlatform = process.platform;

function setPlatform(platform: NodeJS.Platform): void {
    Object.defineProperty(process, 'platform', { value: platform, configurable: true });
}

afterEach(() => {
    setPlatform(realPlatform);
});

describe('hostRepoPath', () => {
    for (const platform of ['win32', 'linux', 'darwin'] as const) {
        it(`is read as a host path on ${platform}`, () => {
            setPlatform(platform);
            expect(resolveWorkspaceExecutionContext(hostRepoPath('repo')).kind).toBe('windows');
        });
    }

    it('is not what a hardcoded POSIX path gives you on win32', () => {
        setPlatform('win32');
        expect(resolveWorkspaceExecutionContext('/repo').kind).toBe('wsl');
        expect(resolveWorkspaceExecutionContext(hostRepoPath('repo')).kind).toBe('windows');
    });
});
