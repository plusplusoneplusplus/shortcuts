/**
 * Workspace/root-scoped lifecycle for the native Notes content index.
 *
 * Root authorization stays in the Notes route layer. This service receives an
 * already-resolved root and owns a native index per scope plus a subscription
 * to the shared watch service. Index state is never shared by physical path alone.
 */

import * as path from 'path';
import type {
    NativeNotesIndex,
    NativeNotesIndexAddon,
    NativeNotesSearchResponse,
} from '@plusplusoneplusplus/coc-native';
import { getServerLogger } from '../logging/server-logger';
import { getNativeWatchService, type NativeWatchServiceLike, type WatchBatch } from '../shared/native-watch-service';
import { DEFAULT_ROOT_ID } from './notes-root-resolver';

const DEFAULT_DEBOUNCE_MS = 300;
const MAX_INCREMENTAL_PATHS = 1_024;

export interface NotesSearchScope {
    workspaceId: string;
    rootId: string;
    absolutePath: string;
    isDefault: boolean;
    isTaskDerived?: boolean;
}

interface NotesSearchLogger {
    error(bindings: Record<string, unknown>, message: string): void;
    warn(bindings: Record<string, unknown>, message: string): void;
}

export interface NotesSearchServiceOptions {
    nativeAddon: Pick<NativeNotesIndexAddon, 'buildNotesIndex'>;
    debounceMs?: number;
    watchService?: NativeWatchServiceLike;
    logger?: NotesSearchLogger;
}

interface IndexEntry {
    readonly workspaceId: string;
    readonly rootId: string;
    readonly absolutePath: string;
    readonly isDefault: boolean;
    readonly isTaskDerived: boolean;
    index?: NativeNotesIndex;
    buildPromise?: Promise<NativeNotesIndex>;
    refreshPromise?: Promise<void>;
    subscriptionId?: number;
    pendingPaths: Set<string>;
    recoveryRequested: boolean;
    changeVersion: number;
    disposed: boolean;
}

function comparisonPath(filePath: string): string {
    const normalized = path.normalize(path.resolve(filePath));
    return process.platform === 'win32' ? normalized.toLocaleLowerCase('en-US') : normalized;
}

function isSameOrWithin(candidate: string, root: string): boolean {
    const relative = path.relative(comparisonPath(root), comparisonPath(candidate));
    return relative === ''
        || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function normalizeWatcherFilename(raw: string): string | undefined {
    if (!raw || raw.includes('\0')) return undefined;

    const slashPath = raw.replace(/\\/g, '/');
    if (path.posix.isAbsolute(slashPath) || path.win32.isAbsolute(raw) || /^[A-Za-z]:/.test(raw)) {
        return undefined;
    }

    const segments = slashPath.split('/');
    if (segments.includes('..')) return undefined;
    const normalized = segments.filter(segment => segment !== '' && segment !== '.').join(path.sep);
    return normalized || undefined;
}

function pathsEqual(left: string, right: string): boolean {
    return comparisonPath(left) === comparisonPath(right);
}

/**
 * Long-lived owner of native Notes indexes and their refresh watchers.
 */
export class NotesSearchService {
    private readonly nativeAddon: Pick<NativeNotesIndexAddon, 'buildNotesIndex'>;
    private readonly debounceMs: number;
    private readonly watchService: NativeWatchServiceLike;
    private readonly logger: NotesSearchLogger;
    private readonly entries = new Map<string, Map<string, IndexEntry>>();
    private readonly evictedWorkspaces = new Set<string>();
    private readonly evictedRoots = new Map<string, Set<string>>();
    private disposed = false;

    constructor(options: NotesSearchServiceOptions) {
        this.nativeAddon = options.nativeAddon;
        this.debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
        this.watchService = options.watchService ?? getNativeWatchService();
        this.logger = options.logger ?? getServerLogger();
    }

    /** Search one already-authorized root, lazily sharing its initial build. */
    async search(scope: NotesSearchScope, query: string): Promise<NativeNotesSearchResponse> {
        if (this.disposed) {
            throw new Error('Notes search service is disposed');
        }
        if (this.evictedWorkspaces.has(scope.workspaceId)) {
            throw new Error(`Notes search workspace '${scope.workspaceId}' is unavailable`);
        }
        if (this.evictedRoots.get(scope.workspaceId)?.has(scope.rootId)) {
            throw new Error(`Notes search root '${scope.rootId}' is unavailable`);
        }
        const entry = this.getOrCreateEntry(scope);
        const index = await this.getOrBuildIndex(entry);
        // A request that began before eviction/disposal may finish against the
        // native handle it already captured.
        return index.search(query);
    }

    /** Drop one root without affecting any other root in the workspace. */
    evictRoot(workspaceId: string, rootId: string): void {
        let evicted = this.evictedRoots.get(workspaceId);
        if (!evicted) {
            evicted = new Set();
            this.evictedRoots.set(workspaceId, evicted);
        }
        evicted.add(rootId);
        const workspaceEntries = this.entries.get(workspaceId);
        const entry = workspaceEntries?.get(rootId);
        if (!entry) return;
        this.disposeEntry(entry);
        workspaceEntries!.delete(rootId);
        if (workspaceEntries!.size === 0) this.entries.delete(workspaceId);
    }

    /** Drop every index and watcher owned by one workspace. */
    evictWorkspace(workspaceId: string): void {
        this.evictedWorkspaces.add(workspaceId);
        const workspaceEntries = this.entries.get(workspaceId);
        if (!workspaceEntries) return;
        for (const entry of workspaceEntries.values()) this.disposeEntry(entry);
        this.entries.delete(workspaceId);
    }

    /** Allow a newly registered workspace id to create scopes again. */
    activateWorkspace(workspaceId: string): void {
        if (this.disposed) return;
        this.evictedWorkspaces.delete(workspaceId);
        this.evictedRoots.delete(workspaceId);
    }

    /**
     * Reconcile a complete set of authorized root ids for one workspace.
     * Useful when a caller can resolve managed, configured, and task-derived
     * roots together.
     */
    reconcileWorkspaceRoots(workspaceId: string, activeRootIds: Iterable<string>): void {
        const active = new Set(activeRootIds);
        const evicted = this.evictedRoots.get(workspaceId);
        if (evicted) {
            for (const rootId of active) evicted.delete(rootId);
            if (evicted.size === 0) this.evictedRoots.delete(workspaceId);
        }
        const workspaceEntries = this.entries.get(workspaceId);
        if (!workspaceEntries) return;
        for (const rootId of [...workspaceEntries.keys()]) {
            if (!active.has(rootId)) this.evictRoot(workspaceId, rootId);
        }
    }

    /**
     * Reconcile only user-configured roots. Managed and task-derived roots have
     * separate lifecycles and are deliberately preserved.
     */
    reconcileConfiguredRoots(workspaceId: string, configuredRootIds: Iterable<string>): void {
        const configured = new Set(configuredRootIds);
        const evicted = this.evictedRoots.get(workspaceId);
        if (evicted) {
            for (const rootId of configured) evicted.delete(rootId);
            if (evicted.size === 0) this.evictedRoots.delete(workspaceId);
        }
        const workspaceEntries = this.entries.get(workspaceId);
        if (!workspaceEntries) return;
        for (const rootId of [...workspaceEntries.keys()]) {
            const isConfigured = rootId !== DEFAULT_ROOT_ID
                && workspaceEntries.get(rootId)?.isTaskDerived !== true;
            if (isConfigured && !configured.has(rootId)) {
                this.evictRoot(workspaceId, rootId);
            }
        }
    }

    /** Stop every watcher and reject future work. In-flight native work may finish. */
    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        for (const workspaceEntries of this.entries.values()) {
            for (const entry of workspaceEntries.values()) this.disposeEntry(entry);
        }
        this.entries.clear();
        this.evictedWorkspaces.clear();
        this.evictedRoots.clear();
    }

    /** Read-only lifecycle diagnostic used by focused service tests. */
    hasScope(workspaceId: string, rootId: string): boolean {
        return this.entries.get(workspaceId)?.has(rootId) ?? false;
    }

    private getOrCreateEntry(scope: NotesSearchScope): IndexEntry {
        const absolutePath = path.resolve(scope.absolutePath);
        let workspaceEntries = this.entries.get(scope.workspaceId);
        if (!workspaceEntries) {
            workspaceEntries = new Map();
            this.entries.set(scope.workspaceId, workspaceEntries);
        }

        const existing = workspaceEntries.get(scope.rootId);
        if (
            existing
            && pathsEqual(existing.absolutePath, absolutePath)
            && existing.isDefault === scope.isDefault
            && existing.isTaskDerived === (scope.isTaskDerived === true)
        ) {
            return existing;
        }
        if (existing) {
            this.disposeEntry(existing);
            workspaceEntries.delete(scope.rootId);
        }

        const entry: IndexEntry = {
            workspaceId: scope.workspaceId,
            rootId: scope.rootId,
            absolutePath,
            isDefault: scope.isDefault,
            isTaskDerived: scope.isTaskDerived === true,
            pendingPaths: new Set(),
            recoveryRequested: false,
            changeVersion: 0,
            disposed: false,
        };
        // Subscription failures must remain visible, and must not cache an
        // unwatched entry that a later search would silently reuse.
        entry.subscriptionId = this.watchService.subscribe({
            workspaceId: entry.workspaceId,
            root: entry.absolutePath,
            recursive: true,
            ignoreDirs: [],
            extensions: [],
            respectGitignore: false,
            debounceMs: this.debounceMs,
        }, batch => this.handleWatchBatch(entry, batch));
        workspaceEntries.set(scope.rootId, entry);
        return entry;
    }

    private getOrBuildIndex(entry: IndexEntry): Promise<NativeNotesIndex> {
        if (entry.index) return Promise.resolve(entry.index);
        if (entry.buildPromise) return entry.buildPromise;

        const buildPromise = this.nativeAddon.buildNotesIndex(entry.absolutePath, {
            skipSymlinks: !entry.isDefault,
        }).then(index => {
            if (!entry.disposed) entry.index = index;
            return index;
        }).finally(() => {
            if (entry.buildPromise === buildPromise) entry.buildPromise = undefined;
        });
        entry.buildPromise = buildPromise;
        return buildPromise;
    }

    private handleWatchBatch(entry: IndexEntry, batch: WatchBatch): void {
        if (entry.disposed) return;
        if (!batch.rescan && batch.paths.length === 0) return;
        entry.changeVersion++;
        if (batch.rescan) entry.recoveryRequested = true;
        if (!entry.recoveryRequested) {
            for (const filename of batch.paths) {
                const normalized = normalizeWatcherFilename(filename);
                if (!normalized
                    || !isSameOrWithin(path.resolve(entry.absolutePath, normalized), entry.absolutePath)
                    || !normalized.endsWith('.md')) {
                    // Untyped paths may identify renamed/deleted directories.
                    entry.recoveryRequested = true;
                    break;
                }
                entry.pendingPaths.add(normalized.split(path.sep).join('/'));
                if (entry.pendingPaths.size > MAX_INCREMENTAL_PATHS) {
                    entry.recoveryRequested = true;
                    break;
                }
            }
        }
        if (entry.recoveryRequested) entry.pendingPaths.clear();
        this.startDrain(entry);
    }

    private startDrain(entry: IndexEntry): void {
        if (entry.disposed || entry.refreshPromise) return;
        const fullRefresh = entry.recoveryRequested;
        const changedPaths = fullRefresh ? [] : [...entry.pendingPaths];
        if (!fullRefresh && changedPaths.length === 0) return;

        const versionAtStart = entry.changeVersion;
        entry.recoveryRequested = false;
        entry.pendingPaths.clear();
        let failed = false;

        const refreshPromise = (async () => {
            try {
                const index = await this.getOrBuildIndex(entry);
                if (entry.disposed) return;
                if (fullRefresh) {
                    await index.refresh();
                } else {
                    await index.refreshChanged(changedPaths);
                }
            } catch (error) {
                if (entry.disposed) return;
                failed = true;
                // The native handle retains its prior complete snapshot. Retry
                // with a full rebuild when another event arrives.
                entry.recoveryRequested = true;
                this.logger.error({
                    err: error,
                    workspaceId: entry.workspaceId,
                    rootId: entry.rootId,
                    notesRoot: entry.absolutePath,
                }, 'Notes search index refresh failed');
            }
        })().finally(() => {
            if (entry.refreshPromise === refreshPromise) entry.refreshPromise = undefined;
            if (entry.disposed) return;

            const changedDuringRefresh = entry.changeVersion > versionAtStart;
            const hasPendingWork = entry.recoveryRequested || entry.pendingPaths.size > 0;
            if (hasPendingWork && (!failed || changedDuringRefresh)) {
                this.startDrain(entry);
            }
        });
        entry.refreshPromise = refreshPromise;
    }

    private disposeEntry(entry: IndexEntry): void {
        if (entry.disposed) return;
        entry.disposed = true;
        entry.pendingPaths.clear();
        entry.recoveryRequested = false;
        if (entry.subscriptionId !== undefined) this.watchService.unsubscribe(entry.subscriptionId);
        entry.subscriptionId = undefined;
        entry.index = undefined;
    }
}
