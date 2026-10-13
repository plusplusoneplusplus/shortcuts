import { useEffect } from 'react';

export interface BrowserControlScope {
    routingRef: string;
    panelScope?: string;
}

const scopes = new Map<object, BrowserControlScope>();
const listeners = new Set<() => void>();
export function getBrowserControlScope(): BrowserControlScope | undefined { return [...scopes.values()].at(-1); }
export function subscribeBrowserControlScope(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

/** A visible conversation publishes its concrete owner, independent of a repo-group picker. */
export function useBrowserControlScope(routingRef?: string | null, panelScope?: string | null): void {
    useEffect(() => {
        if (!routingRef) return;
        const lease = {};
        scopes.set(lease, { routingRef, ...(panelScope ? { panelScope } : {}) });
        for (const listener of listeners) listener();
        return () => {
            scopes.delete(lease);
            for (const listener of listeners) listener();
        };
    }, [routingRef, panelScope]);
}
