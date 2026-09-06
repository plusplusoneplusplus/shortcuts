import * as path from 'path';

/**
 * An absolute path the running platform reads as a repository *on the host*.
 *
 * This is not cosmetic. `resolveWorkspaceExecutionContext` treats a POSIX
 * absolute path on win32 as a path inside a WSL distro — that is the whole
 * point of the rule, since `/home/user/repo` typed on Windows can only mean
 * WSL — so a suite that hardcodes `/repo` as its fixture silently takes the
 * WSL branch on the Windows runners and the host branch everywhere else. Tests
 * that mock the host seam then watch their mock never get called.
 *
 * Use this wherever a fixture path stands in for a host checkout. A WSL
 * fixture is the `\\wsl$\<distro>\...` spelling, which reads the same on every
 * platform and needs no helper.
 */
export function hostRepoPath(...segments: string[]): string {
    return process.platform === 'win32'
        ? path.win32.join('C:\\', ...segments)
        : path.posix.join('/', ...segments);
}
