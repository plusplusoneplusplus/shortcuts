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

export function loadCommitShowPatch(root: string, commit: string, filePath?: string, options?: GetFileDiffOptions) {
    return loadLocalPatch(root, { commit, show: true }, filePath, options);
}

export function loadWorkingTreePatch(root: string, scope: 'all' | 'staged' | 'unstaged', filePath?: string, options?: GetFileDiffOptions) {
    return loadLocalPatch(root, { scope }, filePath, options);
}

export function loadPendingPatch(root: string) {
    return loadLocalPatch(root, { scope: 'all', headings: true });
}

async function loadLocalPatch(
    root: string, source: { commit: string; show?: boolean } | { base: string; head: string } | { scope: string; headings?: boolean },
    filePath?: string, options?: GetFileDiffOptions,
) {
    const addon = loadNativeGit();
    const context = options?.contextLines == null ? undefined : Math.max(0, Math.floor(options.contextLines));
    const maxLines = options?.maxLines == null ? undefined : Math.floor(options.maxLines);
    let result;
    if (resolveWorkspaceExecutionContext(root).kind === 'wsl') {
        if ('scope' in source) {
            const batch = await addon.prepareGitWorkingTreePatch(source.scope, filePath, context);
            const outputs = await Promise.all(batch.map(args => execGitAsync(args, root)));
            result = source.headings ? await addon.processGitPendingPatch(outputs) : await addon.processGitWorkingTreePatch(outputs, maxLines);
        } else {
            const args = 'commit' in source
                ? await (source.show ? addon.prepareGitShowPatch : addon.prepareGitCommitPatch)(source.commit, filePath, context)
                : await addon.prepareGitRangePatch(source.base, source.head, filePath, context);
            result = await addon.processGitPatch(await execGitAsync(args, root), maxLines);
        }
    } else {
        await ensureGitSafeDirectoryAsync(root);
        if ('scope' in source) {
            result = source.headings ? await addon.gitPendingPatch(root)
                : await addon.gitWorkingTreePatch(root, source.scope, filePath, context, maxLines);
        } else {
            result = 'commit' in source
                ? await (source.show ? addon.gitShowPatch : addon.gitCommitPatch)(root, source.commit, filePath, context, maxLines)
                : await addon.gitRangePatch(root, source.base, source.head, filePath, context, maxLines);
        }
    }
    return { ...nativePatchToDiff(result.files), content: result.content, summary: result.summary };
}

/** Commit metadata retains Git ordering and absent binary counts. */
export async function loadCommitFiles(root: string, commit: string, timeout = 30000) {
    const addon = loadNativeGit();
    if (resolveWorkspaceExecutionContext(root).kind === 'wsl') {
        const batch = await addon.prepareGitCommitFiles(commit);
        const [names, counts] = await Promise.all(batch.map(args => execGitAsync(args, root, { timeout })));
        return addon.processGitCommitFiles(names, counts);
    }
    await ensureGitSafeDirectoryAsync(root);
    return (await addon.gitCommitFiles(root, commit, { timeout })).files;
}
