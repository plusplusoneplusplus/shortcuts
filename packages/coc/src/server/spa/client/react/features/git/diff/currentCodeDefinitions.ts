/** Workspace-symbol definitions for ref-backed diff models; never opens a document. */
import { parseBrowserDocumentUri } from '../../language-servers/documentStore';
import { getLanguageServerClient } from '../../language-servers/languageServerClient';
import {
    normalizeSymbols,
    supportsWorkspaceSymbols,
} from '../../language-servers/workspaceSymbols';
import type { LanguageNavigationTarget } from '../../language-servers/editorNavigation';

export interface CurrentCodeDefinitions {
    lookup(word: string, signal?: AbortSignal): Promise<LanguageNavigationTarget[]>;
    dispose(): void;
}

/**
 * Hold one workspace attachment for a diff's lifetime. The concrete route stays
 * separate from workspace identity, including for same-id clones on two hosts.
 */
export function createCurrentCodeDefinitions(
    workspaceId: string,
    routingRef?: string | null,
): CurrentCodeDefinitions {
    const attachment = getLanguageServerClient(workspaceId, undefined, routingRef).attachWorkspace();
    const pending = new Set<AbortController>();
    let disposed = false;

    return {
        async lookup(word, signal) {
            const query = word.trim();
            if (disposed || signal?.aborted || !query) return [];
            const abort = new AbortController();
            const cancel = () => abort.abort(signal?.reason);
            signal?.addEventListener('abort', cancel, { once: true });
            pending.add(abort);
            try {
                const answers = await Promise.all(attachment.getInfos()
                    .filter(supportsWorkspaceSymbols)
                    .map(async info => {
                        try {
                            const raw = await attachment.sendRequestTo(
                                info.definitionId, 'workspace/symbol', { query }, { signal: abort.signal },
                            );
                            // Validate the URI's owner before normalization stamps a
                            // target identity onto the row. Never relabel another repo.
                            const scoped = Array.isArray(raw) ? raw.filter(entry => (
                                typeof entry?.location?.uri === 'string'
                                && parseBrowserDocumentUri(entry.location.uri)?.workspaceId === workspaceId
                            )) : [];
                            return normalizeSymbols(scoped, info.definitionId)
                                .filter(symbol => symbol.name === query);
                        } catch {
                            return [];
                        }
                    }));
                if (disposed || abort.signal.aborted) return [];
                const targets = new Map<string, LanguageNavigationTarget>();
                for (const symbol of answers.flat()) {
                    const key = JSON.stringify([symbol.path, symbol.line, symbol.col]);
                    if (!targets.has(key)) targets.set(key, {
                        workspaceId,
                        path: symbol.path,
                        line: symbol.line,
                        column: symbol.col,
                        symbolCandidate: true,
                    });
                }
                return [...targets.values()];
            } finally {
                signal?.removeEventListener('abort', cancel);
                pending.delete(abort);
            }
        },
        dispose() {
            if (disposed) return;
            disposed = true;
            for (const abort of pending) abort.abort();
            pending.clear();
            attachment.release();
        },
    };
}
