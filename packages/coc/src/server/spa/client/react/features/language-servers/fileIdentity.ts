import { getCocClientForWorkspace, resolveCloneRoute, subscribeCloneBaseUrl } from '../../repos/cloneRegistry';

export interface FileOwner {
    workspaceId: string;
    routingRef?: string | null;
}

/** No cached answer: revalidate the concrete owner and its filesystem each time. */
export async function resolveOwnedFile(owner: FileOwner, path: string, signal: AbortSignal): Promise<string> {
    signal.throwIfAborted();
    const ref = owner.routingRef === undefined ? owner.workspaceId : owner.routingRef;
    const route = JSON.stringify(resolveCloneRoute(ref));
    if (resolveCloneRoute(ref).kind === 'unresolved-remote') {
        throw new Error('The owning server is unavailable. Retry opening the file.');
    }
    const client = getCocClientForWorkspace(ref);
    let changed = false;
    const unsubscribe = subscribeCloneBaseUrl(ref, () => { changed = true; });
    let result: { path: string };
    try {
        result = await client.request<{ path: string }>(
            `/repos/${encodeURIComponent(owner.workspaceId)}/file-identity`,
            { query: { path }, signal, timeoutMs: 10_000 },
        );
    } finally {
        unsubscribe();
    }
    signal.throwIfAborted();
    if (changed || JSON.stringify(resolveCloneRoute(ref)) !== route || client !== getCocClientForWorkspace(ref)) {
        throw new Error('The owning server changed. Retry opening the file.');
    }
    if (!result || typeof result.path !== 'string' || !result.path
        || result.path.includes('\0') || result.path.startsWith('/') || /^[a-z]:/i.test(result.path)
        || result.path.split(/[\\/]/).some(part => !part || part === '..' || part === '.')) {
        throw new Error('Cannot confirm file identity. Retry opening the file.');
    }
    return result.path;
}

const candidateKey = (path: string) => path.replace(/\\/g, '/').split('/')
    .map(part => part.replace(/[ .]+$/g, '').toUpperCase().toLowerCase().normalize('NFC')).join('/');

/** Preserve existing buffer keys. Multiple aliases are an error, never a migration. */
export async function resolveFileOpenPath(
    path: string,
    existing: readonly string[],
    resolve: (path: string) => Promise<string>,
): Promise<string> {
    const identity = await resolve(path);
    const candidates = existing.filter(value => candidateKey(value) === candidateKey(path)
        || candidateKey(value) === candidateKey(identity));
    const matches = (await Promise.all(candidates.map(async value => (
        await resolve(value) === identity ? value : null
    )))).filter((value): value is string => value !== null);
    if (matches.length > 1) throw new Error('Multiple open buffers refer to this file. Close a duplicate and retry. Unsaved edits are unchanged.');
    return matches[0] ?? identity;
}

/** Serialize resolution and publication together, including same-tick opens. */
export class FileOpenQueue {
    private pending: Promise<void> = Promise.resolve();
    private controller = new AbortController();
    private published = new Set<string>();

    open(
        path: string,
        existing: () => readonly string[],
        resolve: (path: string, signal: AbortSignal) => Promise<string>,
        commit: (path: string, signal: AbortSignal) => void,
    ): Promise<void> {
        const signal = this.controller.signal;
        const operation = this.pending.then(async () => {
            signal.throwIfAborted();
            let resolved: string;
            for (;;) {
                signal.throwIfAborted();
                const current = [...existing()];
                for (const value of current) this.published.delete(value);
                resolved = await resolveFileOpenPath(path, [...new Set([...current, ...this.published])],
                    value => resolve(value, signal));
                signal.throwIfAborted();
                const fresh = existing();
                if (current.length === fresh.length && current.every((value, index) => value === fresh[index])) break;
            }
            commit(resolved, signal);
            this.published.add(resolved);
        }).catch(error => {
            signal.throwIfAborted();
            throw error;
        });
        this.pending = operation.catch(() => {});
        return operation;
    }

    dispose(): void {
        this.controller.abort();
        this.published.clear();
    }
}
