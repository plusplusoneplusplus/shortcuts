/**
 * DebouncedWatcherRegistry
 *
 * Generic registry that manages a set of `fs.FSWatcher` instances keyed by
 * an arbitrary string key. Each key gets its own debounce timer and
 * accumulated set of changed file paths. After the debounce window passes
 * without a new event the `onChange` callback fires with the collected paths.
 *
 * Supports an optional per-watch `shouldIgnore` predicate and `onError`
 * callback. Falls back to non-recursive `fs.watch` on platforms that do not
 * support the `{ recursive: true }` option (Linux + Node < 19).
 *
 * Zero external dependencies. Cross-platform compatible.
 */

import * as fs from 'fs';

// ============================================================================
// Types
// ============================================================================

export interface WatchOptions {
    /** Override the instance-level default debounce interval. */
    debounceMs?: number;
    /** Return true for filenames that should be ignored. Called before buffering. */
    shouldIgnore?: (filename: string) => boolean;
    /**
     * Called when the underlying `fs.FSWatcher` emits an 'error' event or
     * when `fs.watch` itself throws. After this callback the key is automatically
     * removed from the registry (`unwatch` is called for you).
     */
    onError?: (key: string, err: Error) => void;
}

// ============================================================================
// DebouncedWatcherRegistry
// ============================================================================

export class DebouncedWatcherRegistry<K extends string = string> {
    private readonly watchers = new Map<K, fs.FSWatcher>();
    private readonly timers = new Map<K, ReturnType<typeof setTimeout>>();
    private readonly changedFiles = new Map<K, Set<string>>();
    private readonly defaultDebounceMs: number;

    constructor(defaultDebounceMs = 300) {
        this.defaultDebounceMs = defaultDebounceMs;
    }

    /**
     * Start watching `watchPath` under the given key.
     * No-op if the key is already being watched.
     */
    watch(
        key: K,
        watchPath: string,
        onChange: (key: K, changedFiles: string[]) => void,
        options?: WatchOptions,
    ): void {
        if (this.watchers.has(key)) return;

        const ms = options?.debounceMs ?? this.defaultDebounceMs;
        const shouldIgnore = options?.shouldIgnore;
        const onError = options?.onError;

        this.changedFiles.set(key, new Set<string>());

        const fire = () => {
            this.timers.delete(key);
            const files = Array.from(this.changedFiles.get(key) ?? []);
            this.changedFiles.get(key)?.clear();
            if (this.watchers.has(key)) {
                onChange(key, files);
            }
        };

        const changeHandler = (_eventType: string, filename: string | null) => {
            if (!filename) return;
            if (shouldIgnore?.(filename)) return;

            this.changedFiles.get(key)?.add(filename);

            const existing = this.timers.get(key);
            if (existing) clearTimeout(existing);
            this.timers.set(key, setTimeout(fire, ms));
        };

        try {
            let watcher: fs.FSWatcher;
            try {
                watcher = fs.watch(watchPath, { recursive: true }, changeHandler);
            } catch {
                watcher = fs.watch(watchPath, changeHandler);
            }

            watcher.on('error', (err) => {
                const error = err instanceof Error ? err : new Error(String(err));
                this.unwatch(key);
                onError?.(key, error);
            });

            this.watchers.set(key, watcher);
        } catch (err) {
            this.changedFiles.delete(key);
            onError?.(key, err instanceof Error ? err : new Error(String(err)));
        }
    }

    /**
     * Stop watching the path associated with the given key.
     * Clears any pending debounce timer and accumulated file list.
     */
    unwatch(key: K): void {
        const timer = this.timers.get(key);
        if (timer) {
            clearTimeout(timer);
            this.timers.delete(key);
        }

        const watcher = this.watchers.get(key);
        if (watcher) {
            try {
                watcher.close();
            } catch {
                // Ignore close errors
            }
            this.watchers.delete(key);
        }

        this.changedFiles.delete(key);
    }

    /** Stop all watchers (e.g. on server shutdown). */
    closeAll(): void {
        for (const key of [...this.watchers.keys()]) {
            this.unwatch(key);
        }
    }

    /** Returns `true` if the key is currently being watched. */
    isWatching(key: K): boolean {
        return this.watchers.has(key);
    }

    /** Returns all keys that currently have an active watcher. */
    getWatchedKeys(): K[] {
        return [...this.watchers.keys()];
    }
}
