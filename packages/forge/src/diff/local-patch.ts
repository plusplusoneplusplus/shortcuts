/** Local patch boundary: workspace/WSL transport and public shape conversion. */
import * as path from 'path';
import { loadNativeGit, NativeAddonLoadError, type NativeGitPatchStore } from '@plusplusoneplusplus/coc-native';
import { execGitAsync } from '../git/exec';
import { ensureGitSafeDirectoryAsync } from '../git/safe-directory';
import { resolveWorkspaceExecutionContext } from '../utils/workspace-execution';
import { nativePatchToDiff } from './diff-utils';
import type { GetFileDiffOptions } from './types';

export interface LocalPatchOptions extends GetFileDiffOptions {
    /** Cancels this read without revoking other requests sharing its Rust store. */
    signal?: AbortSignal;
}

export function loadRangePatch(
    root: string, base: string, head: string, filePath?: string, options?: LocalPatchOptions,
) {
    return loadLocalPatch(root, { mode: 'range', base, head }, filePath, options);
}

export function loadComparisonPatch(root: string, base: string, head: string, filePath?: string, options?: LocalPatchOptions) {
    return loadLocalPatch(root, { mode: 'comparison', base, head }, filePath, options);
}

export function loadCommitPatch(root: string, commit: string, filePath?: string, options?: LocalPatchOptions) {
    return loadLocalPatch(root, { mode: 'commit', base: commit }, filePath, options);
}

export function loadCommitShowPatch(root: string, commit: string, filePath?: string, options?: LocalPatchOptions) {
    return loadLocalPatch(root, { mode: 'show', base: commit }, filePath, options);
}

export function loadWorkingTreePatch(root: string, scope: 'all' | 'staged' | 'unstaged', filePath?: string, options?: LocalPatchOptions) {
    return loadLocalPatch(root, { scope }, filePath, options);
}

export function loadPendingPatch(root: string, options?: LocalPatchOptions) {
    return loadLocalPatch(root, { scope: 'all', headings: true }, undefined, options);
}

const revisionStores = new Map<string, NativeGitPatchStore>();

/** Rust owns scoped snapshots; this map only keeps recent handles. */
function revisionStore(root: string, distro?: string, linuxRoot?: string) {
    const workspace = distro ? root : path.resolve(root);
    const key = JSON.stringify([workspace, distro, linuxRoot]);
    const store = revisionStores.get(key) ?? loadNativeGit().openGitPatchStore(workspace, linuxRoot ?? workspace, distro);
    if (typeof store.beginTransport !== 'function') {
        throw new NativeAddonLoadError('Native GitPatchStore lacks transport continuations; rebuild with `npm run build:native -w packages/coc-native`.');
    }
    revisionStores.delete(key);
    revisionStores.set(key, store);
    // Evicted handles are released by GC; in-flight work keeps its own reference.
    if (revisionStores.size > 16) revisionStores.delete(revisionStores.keys().next().value!);
    return store;
}

async function loadLocalPatch(
    root: string, source: { mode: 'commit' | 'show'; base: string; head?: undefined } | { mode: 'range' | 'comparison'; base: string; head: string } | { scope: string; headings?: boolean },
    filePath?: string, options?: LocalPatchOptions,
) {
    const signal = options?.signal;
    signal?.throwIfAborted();
    const addon = loadNativeGit();
    const context = options?.contextLines == null ? undefined : Math.max(0, Math.floor(options.contextLines));
    const maxLines = options?.maxLines == null ? undefined : Math.floor(options.maxLines);
    const execOptions = 'mode' in source && source.mode === 'comparison' ? { timeout: 10000 } : undefined;
    let result;
    const execution = resolveWorkspaceExecutionContext(root);
    // Unresolved default distros remain stateless rather than sharing an identity
    // that could silently change to another distro.
    const request = execution.kind !== 'wsl' ? revisionStore(root).beginTransport()
        : execution.distro ? revisionStore(root, execution.distro, execution.linuxWorkingDirectory).beginTransport()
            : undefined;
    const controller = new AbortController();
    const abort = () => {
        request?.cancel();
        controller.abort(signal?.reason);
    };
    signal?.addEventListener('abort', abort, { once: true });
    let timer: ReturnType<typeof setInterval> | undefined;
    try {
        signal?.throwIfAborted();
        if (execution.kind === 'wsl') {
            if (request) {
                if (typeof request.checkActive !== 'function') {
                    throw new NativeAddonLoadError('Native GitPatchRequest lacks transport cancellation; rebuild with `npm run build:native -w packages/coc-native`.');
                }
                request.checkActive();
                timer = setInterval(() => {
                    try { request.checkActive(); } catch (error) { controller.abort(error); }
                }, 25);
                timer.unref();
            }
            let batch;
            if ('scope' in source) {
                if (request && typeof request.processWorkingTree !== 'function') {
                    throw new NativeAddonLoadError('Native GitPatchRequest lacks working-tree composition; rebuild with `npm run build:native -w packages/coc-native`.');
                }
                batch = await addon.prepareGitWorkingTreePatch(source.scope, filePath, context);
            } else {
                batch = [await addon.prepareGitRevisionPatch(source.mode, source.base, source.head, filePath, context)];
            }
            signal?.throwIfAborted();
            request?.checkActive();
            const outputs = await Promise.all(batch.map(args => execGitAsync(args, root, {
                signal: controller.signal, ...execOptions,
            })));
            clearInterval(timer);
            signal?.throwIfAborted();
            request?.checkActive();
            result = 'scope' in source
                ? request ? await request.processWorkingTree(outputs, maxLines, source.headings)
                    : await addon.composeGitWorkingTreePatch(outputs, maxLines, source.headings)
                : request ? await request.process(outputs[0], maxLines) : await addon.processGitPatch(outputs[0], maxLines);
        } else {
            if (!request || typeof request.revisionPatch !== 'function' || typeof request.workingTreePatch !== 'function') {
                throw new NativeAddonLoadError('Native GitPatchRequest lacks host cancellation; rebuild with `npm run build:native -w packages/coc-native`.');
            }
            await ensureGitSafeDirectoryAsync(root);
            signal?.throwIfAborted();
            result = 'scope' in source
                ? await request.workingTreePatch(source.scope, filePath, context, maxLines, source.headings)
                : await request.revisionPatch(source.mode, source.base, source.head, filePath, context, maxLines, execOptions);
        }
        signal?.throwIfAborted();
        return { ...nativePatchToDiff(result.files), content: result.content, summary: result.summary };
    } catch (error) {
        signal?.throwIfAborted();
        throw error;
    } finally {
        signal?.removeEventListener('abort', abort);
        clearInterval(timer);
        controller.abort();
        request?.cancel();
    }
}

/** Commit metadata retains Git ordering and absent binary counts. */
export async function loadCommitFiles(root: string, commit: string, timeout = 30000) {
    return (await loadCommitMetadata(root, commit, timeout)).files;
}

export async function loadCommitMetadata(root: string, commit: string, timeout = 30000) {
    const addon = loadNativeGit();
    if (resolveWorkspaceExecutionContext(root).kind === 'wsl') {
        const batch = await addon.prepareGitCommitFiles(commit);
        const [names, counts, parents] = await Promise.all(batch.map(args => execGitAsync(args, root, { timeout })));
        return addon.processGitCommitMetadata(names, counts, parents);
    }
    await ensureGitSafeDirectoryAsync(root);
    return addon.gitCommitFiles(root, commit, { timeout });
}
