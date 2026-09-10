/**
 * Process-wide handle on the running {@link LanguageServerManager}.
 *
 * The manager is constructed during server composition, long after the route
 * table is built, and only a couple of call sites outside the WebSocket bridge
 * ever need it — workspace removal is the main one. Registering it here keeps
 * those call sites from threading an extra dependency through the route
 * factories, and mirrors the module-level listener convention already used by
 * `repository.ts`.
 *
 * Every accessor is a no-op when nothing is registered, so tests and embedders
 * that never build the infrastructure still work.
 */

import type { LanguageServerManager } from './manager';

let activeManager: LanguageServerManager | undefined;

/**
 * Publishes the manager for this process and returns an unregister function.
 *
 * The unregister is identity-checked: a late call from a disposed manager
 * cannot clear a newer one that has already taken its place.
 */
export function setActiveLanguageServerManager(manager: LanguageServerManager): () => void {
    activeManager = manager;
    return () => {
        if (activeManager === manager) {
            activeManager = undefined;
        }
    };
}

/** The running manager, or undefined when language support is not composed. */
export function getActiveLanguageServerManager(): LanguageServerManager | undefined {
    return activeManager;
}

/**
 * Stops every language server belonging to a workspace. Called when a
 * workspace is removed so its processes do not outlive it.
 */
export async function disposeLanguageServersForWorkspace(workspaceId: string): Promise<void> {
    await activeManager?.disposeWorkspace(workspaceId);
}
