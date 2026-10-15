import * as fs from 'fs/promises';
import * as path from 'path';
import { loadNativeGit } from '@plusplusoneplusplus/coc-native';
import { resolveWorkspaceExecutionContext, translatePathForHostFilesystem } from '../utils/workspace-execution';
import { ensureGitSafeDirectoryAsync } from './safe-directory';
import { runGitViaWsl } from './exec';

/** Discover from a directory or file; unusable host addons remain visible errors. */
export async function discoverGitRepoRoot(pathLike: string): Promise<string | null> {
    const context = resolveWorkspaceExecutionContext(pathLike);
    if (context.kind !== 'wsl') {
        const addon = loadNativeGit();
        try {
            await ensureGitSafeDirectoryAsync(pathLike);
            const root = await addon.gitDiscoverRepoRoot(path.resolve(pathLike));
            return root && path.isAbsolute(root) ? root : null;
        } catch { return null; }
    }
    try {
        const hostPath = translatePathForHostFilesystem(context.linuxWorkingDirectory, context);
        const isDirectory = await fs.stat(hostPath).then(stat => stat.isDirectory(), () => false);
        const directory = isDirectory ? context.linuxWorkingDirectory : path.posix.dirname(context.linuxWorkingDirectory);
        await ensureGitSafeDirectoryAsync(pathLike);
        const root = (await runGitViaWsl({ ...context, linuxWorkingDirectory: directory },
            ['rev-parse', '--show-toplevel'], { timeout: 30_000 })).trim();
        return root || null;
    } catch { return null; }
}
