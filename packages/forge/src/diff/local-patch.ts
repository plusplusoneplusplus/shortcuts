/** Local patch boundary: workspace/WSL transport and public shape conversion. */
import { loadNativeGit } from '@plusplusoneplusplus/coc-native';
import { execGitAsync } from '../git/exec';
import { ensureGitSafeDirectoryAsync } from '../git/safe-directory';
import { resolveWorkspaceExecutionContext } from '../utils/workspace-execution';
import { nativePatchToDiff } from './diff-utils';
import type { GetFileDiffOptions } from './types';

export async function loadRangePatch(
    root: string, base: string, head: string, filePath?: string, options?: GetFileDiffOptions,
) {
    const addon = loadNativeGit();
    const context = options?.contextLines == null ? undefined : Math.max(0, Math.floor(options.contextLines));
    const maxLines = options?.maxLines == null ? undefined : Math.floor(options.maxLines);
    let result;
    if (resolveWorkspaceExecutionContext(root).kind === 'wsl') {
        const args = await addon.prepareGitRangePatch(base, head, filePath, context);
        result = await addon.processGitPatch(await execGitAsync(args, root), maxLines);
    } else {
        await ensureGitSafeDirectoryAsync(root);
        result = await addon.gitRangePatch(root, base, head, filePath, context, maxLines);
    }
    return { ...nativePatchToDiff(result.files), content: result.content, summary: result.summary };
}
