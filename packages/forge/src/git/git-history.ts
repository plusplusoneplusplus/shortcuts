import { loadNativeGit, NativeAddonLoadError, type NativeGitLogOptions } from '@plusplusoneplusplus/coc-native';
import { resolveWorkspaceExecutionContext } from '../utils/workspace-execution';
import { ensureGitSafeDirectoryAsync } from './safe-directory';
import { execGitAsync } from './exec';

/** Rust owns history planning/decoding; Forge owns workspace execution routing. */
export async function loadGitHistory(
    root: string, options: NativeGitLogOptions, rev?: string, fixedSearch = false,
) {
    const native = loadNativeGit();
    const args = native.prepareGitHistory(options, rev, fixedSearch);
    try {
        if (resolveWorkspaceExecutionContext(root).kind === 'wsl') {
            return await native.processGitHistory(await execGitAsync(args, root));
        }
        await ensureGitSafeDirectoryAsync(root);
        return await native.gitHistory(root, args);
    } catch (error) {
        if (!(error instanceof NativeAddonLoadError) && args.at(-1)?.endsWith('^!')) return [];
        throw error;
    }
}
