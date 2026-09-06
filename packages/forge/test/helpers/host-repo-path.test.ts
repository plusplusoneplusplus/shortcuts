/**
 * `hostRepoPath` exists for one reason: on win32 a POSIX absolute path is not a
 * host path.
 *
 * `resolveWorkspaceExecutionContext` reads `/home/user/repo` typed on Windows
 * as a path inside the default WSL distro — deliberately, since that is the
 * only thing it can mean there. So a suite that hardcodes `/repo` as "the
 * repository" gets the host branch on Linux and macOS and the WSL branch on the
 * Windows runners, and any mock standing in for the host seam is never called.
 * That is precisely how `git-diff-provider`, `git-api`, `git-cache-api`,
 * `git-commit-edge-cases` and the two `git-native-required` suites failed on
 * Windows and nowhere else.
 *
 * These tests pin both halves on every platform by stubbing `process.platform`,
 * so the guarantee does not depend on which runner happens to execute them.
 */

import { describe, expect, it, afterEach } from 'vitest';
import { resolveWorkspaceExecutionContext } from '../../src/utils/workspace-execution';
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
            const context = resolveWorkspaceExecutionContext(hostRepoPath('test', 'repo'));
            expect(context.kind).toBe('windows');
        });
    }

    // The failure mode itself, stated as a test: without the helper the fixture
    // path changes meaning between runners.
    it('is not what a hardcoded POSIX path gives you on win32', () => {
        setPlatform('win32');
        expect(resolveWorkspaceExecutionContext('/test/repo').kind).toBe('wsl');
        expect(resolveWorkspaceExecutionContext(hostRepoPath('test', 'repo')).kind).toBe('windows');
    });

    // A WSL fixture needs no helper: the UNC spelling carries its own distro and
    // reads the same everywhere. Keep that true so suites do not reach for
    // `hostRepoPath` when they mean the other branch.
    it('leaves the WSL UNC spelling alone on every platform', () => {
        for (const platform of ['win32', 'linux', 'darwin'] as const) {
            setPlatform(platform);
            expect(resolveWorkspaceExecutionContext('\\\\wsl$\\Ubuntu\\home\\user\\repo').kind)
                .toBe('wsl');
        }
    });
});
