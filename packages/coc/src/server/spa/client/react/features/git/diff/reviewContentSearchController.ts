import type { GitFileDiffContentResponse } from '@plusplusoneplusplus/coc-client';
import type { ContentSearchModes } from '../../repo-detail/explorer/types';
import {
    compileReviewContentQuery,
    type ReviewContentMatch,
    type ReviewSearchContents,
    type ReviewSearchSideFilter,
} from './reviewContentSearch';

/** IDs distinguish staged/unstaged entries that display the same path. */
export interface ReviewSearchFile {
    id: string;
    path: string;
}

export type ReviewSearchFileState =
    | { status: 'pending' | 'loading' }
    | { status: 'loaded'; contents: ReviewSearchContents }
    | { status: 'skipped'; reason: 'binary' | 'tooLarge' }
    | { status: 'error'; message: string };

export interface ReviewSearchFileResult {
    file: ReviewSearchFile;
    state: ReviewSearchFileState;
    matches: readonly ReviewContentMatch[];
}

export interface ReviewSearchSnapshot {
    running: boolean;
    error: string | null;
    /** Completed attempts, including skips and errors, among included files. */
    searched: number;
    total: number;
    files: readonly ReviewSearchFileResult[];
}

/**
 * One instance per owner/comparison lifetime. The caller supplies an existing,
 * per-call clone-routed loader; this controller never selects a server or saves state.
 */
export class ReviewContentSearchController {
    private readonly entries: ReviewSearchFileResult[];
    private readonly listeners = new Set<() => void>();
    private included: ReviewSearchFileResult[] = [];
    private search: ReturnType<typeof compileReviewContentQuery>['search'] = null;
    private side: ReviewSearchSideFilter = 'both';
    private active = 0;
    private disposed = false;
    private snapshot: ReviewSearchSnapshot = { running: false, error: null, searched: 0, total: 0, files: [] };

    constructor(
        files: readonly ReviewSearchFile[],
        private readonly load: (file: ReviewSearchFile) => Promise<GitFileDiffContentResponse>,
    ) {
        this.entries = files.map(file => ({ file: { ...file }, state: { status: 'pending' }, matches: [] }));
    }

    /** Stable methods for useSyncExternalStore. Snapshots are immutable between notifications. */
    readonly getSnapshot = (): ReviewSearchSnapshot => this.snapshot;
    readonly subscribe = (listener: () => void): (() => void) => {
        this.listeners.add(listener);
        return () => { this.listeners.delete(listener); };
    };

    start(query: string, modes: ContentSearchModes, side: ReviewSearchSideFilter = 'both', include = (_file: ReviewSearchFile) => true): void {
        if (this.disposed) return;
        const compiled = compileReviewContentQuery(query, modes);
        this.search = query.length > 0 ? compiled.search : null;
        this.side = side;
        this.included = this.search ? this.entries.filter(entry => include(entry.file)) : [];
        for (const entry of this.entries) entry.matches = [];
        for (const entry of this.included) this.match(entry);
        this.snapshot = { ...this.snapshot, running: this.search !== null, error: compiled.error };
        this.pump();
    }

    /** Stop scheduling reads. Already-dispatched reads settle into this review's cache. */
    stop(): void {
        if (this.disposed) return;
        this.snapshot = { ...this.snapshot, running: false };
        this.publish();
    }

    /** Failed reads stay explicit until Retry; successful/skipped files are never reloaded. */
    retry(fileId: string): void {
        if (this.disposed || !this.search) return;
        const entry = this.included.find(candidate => candidate.file.id === fileId);
        if (!entry || entry.state.status !== 'error') return;
        entry.state = { status: 'pending' };
        this.snapshot = { ...this.snapshot, running: true };
        this.pump();
    }

    /** Late loader replies cannot retain contents or notify a replaced review. */
    dispose(): void {
        this.disposed = true;
        this.search = null;
        this.included = [];
        this.entries.length = 0;
        this.listeners.clear();
        this.snapshot = { running: false, error: null, searched: 0, total: 0, files: [] };
    }

    private match(entry: ReviewSearchFileResult): void {
        entry.matches = entry.state.status === 'loaded' && this.search
            ? this.search(entry.state.contents, this.side) : [];
    }

    private pump(): void {
        if (this.disposed) return;
        if (this.snapshot.running) {
            for (const entry of this.included) {
                if (this.active >= 4) break;
                if (entry.state.status !== 'pending') continue;
                entry.state = { status: 'loading' };
                this.active++;
                // Promise boundary also catches synchronous loader/response failures.
                void Promise.resolve().then(() => {
                    if (this.disposed) return;
                    return this.load(entry.file);
                }).then(response => {
                    if (this.disposed) return;
                    if (!response) throw new Error('Invalid file content response');
                    if (response.binary || response.tooLarge) {
                        entry.state = { status: 'skipped', reason: response.binary ? 'binary' : 'tooLarge' };
                    } else {
                        const { base, head } = response;
                        if (typeof base?.exists !== 'boolean' || typeof head?.exists !== 'boolean'
                            || typeof base.content !== 'string' || typeof head.content !== 'string') {
                            throw new Error('Invalid file content response');
                        }
                        entry.state = { status: 'loaded', contents: {
                            old: base.exists ? base.content : null,
                            new: head.exists ? head.content : null,
                        } };
                    }
                    // Use the latest query, even if it changed while I/O was pending.
                    this.match(entry);
                }).catch(error => {
                    if (!this.disposed) entry.state = { status: 'error', message: error instanceof Error ? error.message : String(error) };
                }).finally(() => {
                    this.active--;
                    this.pump();
                });
            }
            if (!this.included.some(entry => entry.state.status === 'pending' || entry.state.status === 'loading')) {
                this.snapshot = { ...this.snapshot, running: false };
            }
        }
        this.publish();
    }

    private publish(): void {
        const files = this.included.map(entry => ({ ...entry }));
        this.snapshot = {
            ...this.snapshot,
            total: files.length,
            searched: files.filter(entry => ['loaded', 'skipped', 'error'].includes(entry.state.status)).length,
            files,
        };
        for (const listener of this.listeners) listener();
    }
}
