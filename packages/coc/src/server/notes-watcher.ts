/**
 * Notes Watcher
 *
 * Watches `~/.coc/repos/<workspaceId>/notes/` directories for registered
 * workspaces and fires a debounced callback when note files change.
 * This enables auto-refresh of the NoteEditor when the AI modifies a
 * note file on disk.
 *
 * Mirrors the TaskWatcher pattern — uses Node.js built-in `fs.watch`.
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import * as fs from 'fs';
import * as path from 'path';

// ============================================================================
// Types
// ============================================================================

export type NotesChangedCallback = (workspaceId: string, changedPaths: string[]) => void;

// ============================================================================
// NotesWatcher
// ============================================================================

const DEBOUNCE_MS = 300;

export class NotesWatcher {
    private watchers = new Map<string, fs.FSWatcher>();
    private timers = new Map<string, ReturnType<typeof setTimeout>>();
    private changedFiles = new Map<string, Set<string>>();
    private watchedDirs = new Map<string, string>();
    private onNotesChanged: NotesChangedCallback;

    constructor(onNotesChanged: NotesChangedCallback) {
        this.onNotesChanged = onNotesChanged;
    }

    /**
     * Start watching the given notes directory for a workspace.
     * No-ops gracefully if the directory does not exist.
     */
    watchWorkspace(workspaceId: string, notesDir: string): void {
        if (this.watchers.has(workspaceId)) return;

        try {
            const stat = fs.statSync(notesDir);
            if (!stat.isDirectory()) return;
        } catch {
            return;
        }

        try {
            let watcher: fs.FSWatcher;
            try {
                watcher = fs.watch(notesDir, { recursive: true }, (_event, filename) => {
                    this.bufferChange(workspaceId, filename);
                });
            } catch {
                watcher = fs.watch(notesDir, (_event, filename) => {
                    this.bufferChange(workspaceId, filename);
                });
            }

            watcher.on('error', () => {
                this.cleanupWatcher(workspaceId);
            });

            this.watchers.set(workspaceId, watcher);
            this.watchedDirs.set(workspaceId, notesDir);
        } catch {
            // fs.watch can throw if the path disappears
        }
    }

    unwatchWorkspace(workspaceId: string): void {
        this.cleanupWatcher(workspaceId);
    }

    closeAll(): void {
        for (const [id] of this.watchers) {
            this.cleanupWatcher(id);
        }
    }

    isWatching(workspaceId: string): boolean {
        return this.watchers.has(workspaceId);
    }

    // ========================================================================
    // Private
    // ========================================================================

    private bufferChange(workspaceId: string, filename: string | null): void {
        if (!filename) return;
        // Only track markdown files
        if (!filename.endsWith('.md')) return;

        let files = this.changedFiles.get(workspaceId);
        if (!files) {
            files = new Set();
            this.changedFiles.set(workspaceId, files);
        }
        // Normalize to forward slashes for cross-platform consistency
        files.add(filename.replace(/\\/g, '/'));

        this.debounceFire(workspaceId);
    }

    private debounceFire(workspaceId: string): void {
        const existing = this.timers.get(workspaceId);
        if (existing) clearTimeout(existing);

        const timer = setTimeout(() => {
            this.timers.delete(workspaceId);
            if (!this.watchers.has(workspaceId)) return;

            const files = this.changedFiles.get(workspaceId);
            if (files && files.size > 0) {
                const changed = Array.from(files);
                files.clear();

                // Resolve to full paths relative to the notes root
                const notesDir = this.watchedDirs.get(workspaceId);
                const fullPaths = notesDir
                    ? changed.map(f => path.join(notesDir, f).replace(/\\/g, '/'))
                    : changed;

                this.onNotesChanged(workspaceId, fullPaths);
            }
        }, DEBOUNCE_MS);

        this.timers.set(workspaceId, timer);
    }

    private cleanupWatcher(workspaceId: string): void {
        const timer = this.timers.get(workspaceId);
        if (timer) {
            clearTimeout(timer);
            this.timers.delete(workspaceId);
        }

        const watcher = this.watchers.get(workspaceId);
        if (watcher) {
            try { watcher.close(); } catch { /* ignore */ }
            this.watchers.delete(workspaceId);
        }

        this.changedFiles.delete(workspaceId);
        this.watchedDirs.delete(workspaceId);
    }
}
