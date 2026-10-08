/** Local patch boundary: workspace/WSL transport and public shape conversion. */
import { loadNativeGit } from '@plusplusoneplusplus/coc-native';
import { execGitAsync } from '../git/exec';
import { ensureGitSafeDirectoryAsync } from '../git/safe-directory';
import { resolveWorkspaceExecutionContext } from '../utils/workspace-execution';
import { nativePatchToDiff } from './diff-utils';
import type { GetFileDiffOptions } from './types';

export function loadRangePatch(
    root: string, base: string, head: string, filePath?: string, options?: GetFileDiffOptions,
) {
    return loadLocalPatch(root, { base, head }, filePath, options);
}

export function loadCommitPatch(root: string, commit: string, filePath?: string, options?: GetFileDiffOptions) {
    return loadLocalPatch(root, { commit }, filePath, options);
}

async function loadLocalPatch(
    root: string, source: { commit: string } | { base: string; head: string },
    filePath?: string, options?: GetFileDiffOptions,
) {
    const addon = loadNativeGit();
    const context = options?.contextLines == null ? undefined : Math.max(0, Math.floor(options.contextLines));
    const maxLines = options?.maxLines == null ? undefined : Math.floor(options.maxLines);
    let result;
    if (resolveWorkspaceExecutionContext(root).kind === 'wsl') {
        const args = 'commit' in source
            ? await addon.prepareGitCommitPatch(source.commit, filePath, context)
            : await addon.prepareGitRangePatch(source.base, source.head, filePath, context);
        result = await addon.processGitPatch(await execGitAsync(args, root), maxLines);
    } else {
        await ensureGitSafeDirectoryAsync(root);
        result = 'commit' in source
            ? await addon.gitCommitPatch(root, source.commit, filePath, context, maxLines)
            : await addon.gitRangePatch(root, source.base, source.head, filePath, context, maxLines);
    }
    return { ...nativePatchToDiff(result.files), content: result.content, summary: result.summary };
}
