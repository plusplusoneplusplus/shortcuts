import { loadNativeGit, type NativeGitPatchStore, type NativeGitRemotePatchSource } from '@plusplusoneplusplus/coc-native';
import type { WorkspaceExecutionContext } from '../utils/workspace-execution';

export function openRemotePatchStore(
    workspaceId: string, execution: WorkspaceExecutionContext, source: NativeGitRemotePatchSource,
): NativeGitPatchStore {
    if (execution.kind === 'wsl' && !execution.distro) {
        throw new Error('Remote patch processing requires a resolved WSL distro identity');
    }
    const root = execution.kind === 'wsl' ? execution.linuxWorkingDirectory : execution.workingDirectory;
    if (!root) {
        throw new Error('Remote patch processing requires a repository root');
    }
    return loadNativeGit().openRemoteGitPatchStore(workspaceId, root,
        source, execution.kind === 'wsl' ? execution.distro : undefined);
}

/** Capture a scope's generation before authenticated I/O and retire it on every outcome. */
export async function loadSuppliedPatch(
    fetchDiff: () => Promise<string>, store?: NativeGitPatchStore, signal?: AbortSignal,
    file?: { path: string; maxLines?: number },
) {
    signal?.throwIfAborted();
    const addon = loadNativeGit();
    const request = store?.beginTransport();
    let selection: ReturnType<NativeGitPatchStore['beginTransport']> | undefined;
    const cancel = () => { request?.cancel(); selection?.cancel(); };
    signal?.addEventListener('abort', cancel, { once: true });
    try {
        signal?.throwIfAborted();
        // Per-file processing must retain the generation captured before transport.
        if (file) selection = store?.beginTransport();
        const raw = await fetchDiff();
        signal?.throwIfAborted();
        const patch = await (request ? request.process(raw) : addon.processGitPatch(raw));
        signal?.throwIfAborted();
        if (file) {
            const selected = patch.files.find(entry => entry.path === file.path)?.raw ?? '';
            const { content } = await (selection ? selection.process(selected, file.maxLines)
                : addon.processGitPatch(selected, file.maxLines));
            signal?.throwIfAborted();
            return { ...patch, content };
        }
        return patch;
    } catch (error) {
        signal?.throwIfAborted();
        throw error;
    } finally {
        signal?.removeEventListener('abort', cancel);
        request?.cancel();
        selection?.cancel();
    }
}
