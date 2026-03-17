/**
 * State persistence abstraction for the Markdown Review Editor.
 *
 * Replaces direct usage of vscode.Memento (context.workspaceState)
 * with a platform-agnostic key-value interface.
 */

/** Abstracts key-value state persistence */
export interface StateStore {
    /** Get a value by key, returning defaultValue if not found */
    get<T>(key: string, defaultValue: T): T;

    /** Set a value by key */
    update(key: string, value: unknown): Promise<void>;

    /** List all keys (optional, for debugging / migration) */
    keys?(): string[];
}
