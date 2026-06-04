/**
 * FileWorkItemStore — file-backed implementation of WorkItemStore.
 *
 * Storage layout (per workspace):
 *   <dataDir>/repos/<workspaceId>/work-items/
 *     index.json              — WorkItemIndexEntry[] (lightweight listing)
 *     <workItemId>.json       — Full WorkItem data
 *     plans/<workItemId>/
 *       v1.md                 — Plan version 1
 *       v2.md                 — Plan version 2
 *
 * Uses atomic tmp→rename writes and a write-queue for safe concurrency.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { getRepoDataPath } from '@plusplusoneplusplus/forge';
import type {
    WorkItem,
    WorkItemGitHubMirrorMetadata,
    WorkItemIndexEntry,
    WorkItemFilter,
    WorkItemListResult,
    WorkItemGroupedResult,
    WorkItemPlanVersion,
    WorkItemExecution,
    WorkItemChange,
    WorkItemStore,
    WorkItemStatus,
    WorkItemTrackerMetadata,
    WorkItemSyncParentReference,
    WorkItemSyncProvider,
    WorkItemSyncRemoteIdentity,
} from './types';
import { getOwnWorkItemTrackerKind, toIndexEntry, WORK_ITEM_STATUSES } from './types';

// ============================================================================
// Store Implementation
// ============================================================================

export interface FileWorkItemStoreOptions {
    /** Base data directory (default: ~/.coc). */
    dataDir: string;
}

interface LegacyWorkItemSyncLink {
    provider: WorkItemSyncProvider;
    remote: WorkItemSyncRemoteIdentity;
    remoteRevision?: string;
    remoteUpdatedAt?: string;
    lastSyncedAt?: string;
    lastSyncedFingerprint?: string;
    parent?: WorkItemSyncParentReference;
}

type LegacyStoredWorkItem = WorkItem & { syncLinks?: LegacyWorkItemSyncLink[] };
type LegacyWorkItemIndexEntry = WorkItemIndexEntry & { syncLinks?: LegacyWorkItemSyncLink[] };

function getLegacyGitHubSyncLink(item: Pick<LegacyStoredWorkItem, 'syncLinks'>): LegacyWorkItemSyncLink | undefined {
    return item.syncLinks?.find(link => link.provider === 'github');
}

function positiveIssueNumber(link: LegacyWorkItemSyncLink): number | undefined {
    const issueNumber = link.remote.issueNumber;
    return typeof issueNumber === 'number' && Number.isInteger(issueNumber) && issueNumber > 0
        ? issueNumber
        : undefined;
}

function githubTrackerFromLegacySyncLink(link: LegacyWorkItemSyncLink): (WorkItemTrackerMetadata & { kind: 'github-backed' }) | undefined {
    const issueNumber = positiveIssueNumber(link);
    if (issueNumber === undefined) return undefined;
    return {
        kind: 'github-backed',
        provider: 'github',
        github: {
            issueId: link.remote.issueId,
            issueNumber,
            issueUrl: link.remote.issueUrl,
            lastPulledAt: link.lastSyncedAt,
        },
    };
}

function githubMirrorFromLegacySyncLink(link: LegacyWorkItemSyncLink): WorkItemGitHubMirrorMetadata | undefined {
    const issueNumber = positiveIssueNumber(link);
    if (issueNumber === undefined) return undefined;
    return {
        issueId: link.remote.issueId,
        issueNumber,
        issueUrl: link.remote.issueUrl,
        updatedAt: link.remoteUpdatedAt,
        lastPulledAt: link.lastSyncedAt,
    };
}

export class FileWorkItemStore implements WorkItemStore {
    private readonly dataDir: string;
    private writeQueue: Promise<void> = Promise.resolve();
    private repairedRepos = new Set<string>();

    constructor(options: FileWorkItemStoreOptions) {
        this.dataDir = options.dataDir;
    }

    // ── Path helpers ────────────────────────────────────────────

    private workItemsDir(repoId: string): string {
        return getRepoDataPath(this.dataDir, repoId, 'work-items');
    }

    private indexPath(repoId: string): string {
        return path.join(this.workItemsDir(repoId), 'index.json');
    }

    private itemPath(repoId: string, id: string): string {
        return path.join(this.workItemsDir(repoId), `${this.sanitize(id)}.json`);
    }

    private planDir(repoId: string, id: string): string {
        return path.join(this.workItemsDir(repoId), 'plans', this.sanitize(id));
    }

    private planVersionPath(repoId: string, id: string, version: number): string {
        return path.join(this.planDir(repoId, id), `v${version}.md`);
    }

    private counterPath(repoId: string): string {
        return path.join(this.workItemsDir(repoId), 'counter.json');
    }

    private sanitize(id: string): string {
        return id.replace(/[^a-zA-Z0-9_-]/g, '_');
    }

    // ── Low-level I/O ───────────────────────────────────────────

    private enqueueWrite<T>(fn: () => Promise<T>): Promise<T> {
        const result = this.writeQueue.then(fn);
        this.writeQueue = result.then(() => {}, () => {});
        return result;
    }

    private async atomicWrite(filePath: string, content: string): Promise<void> {
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        const tmpPath = filePath + '.tmp';
        await fs.writeFile(tmpPath, content, 'utf-8');
        await fs.rename(tmpPath, filePath);
    }

    private async readJSON<T>(filePath: string, defaultValue: T): Promise<T> {
        try {
            let data = await fs.readFile(filePath, 'utf-8');
            // Strip UTF-8 BOM if present
            if (data.charCodeAt(0) === 0xFEFF) data = data.slice(1);
            return JSON.parse(data) as T;
        } catch {
            return defaultValue;
        }
    }

    private async readIndex(repoId: string): Promise<WorkItemIndexEntry[]> {
        const raw = await this.readJSON<unknown>(this.indexPath(repoId), []);
        // Handle corrupted index: single object instead of array
        let entries: LegacyWorkItemIndexEntry[];
        if (raw && !Array.isArray(raw)) {
            entries = [raw as unknown as LegacyWorkItemIndexEntry];
        } else {
            entries = raw as LegacyWorkItemIndexEntry[];
        }

        // Repair once per repo per process lifetime: scan for orphaned .json item files
        if (!this.repairedRepos.has(repoId)) {
            this.repairedRepos.add(repoId);
            try {
                const dir = this.workItemsDir(repoId);
                const files = await fs.readdir(dir);
                const indexedIds = new Set(entries.map(e => e.id));
                let repaired = false;
                for (const file of files) {
                    if (!file.endsWith('.json') || file === 'index.json' || file === 'counter.json') continue;
                    const itemId = file.replace(/\.json$/, '');
                    if (indexedIds.has(itemId)) continue;
                    const item = await this.readItem(repoId, itemId);
                    if (item) {
                        // Fix missing repoId
                        if (!item.repoId) item.repoId = repoId;
                        entries.push(toIndexEntry(item));
                        repaired = true;
                    }
                }
                // Also fix existing entries that have corrupted/missing repoId
                if (!repaired && !Array.isArray(raw)) {
                    repaired = true; // corrupted format needs rewrite
                }
                for (const entry of entries) {
                    if (!entry.repoId) {
                        entry.repoId = repoId;
                        repaired = true;
                    }
                }
                if (repaired) {
                    await this.atomicWrite(this.indexPath(repoId), JSON.stringify(entries, null, 2));
                }
            } catch {
                // Non-fatal
            }
        }

        return this.migrateLegacySyncLinks(repoId, entries);
    }

    private async writeIndex(repoId: string, entries: WorkItemIndexEntry[]): Promise<void> {
        await this.atomicWrite(this.indexPath(repoId), JSON.stringify(entries, null, 2));
    }

    private async readItem(repoId: string, id: string): Promise<LegacyStoredWorkItem | undefined> {
        const result = await this.readJSON<LegacyStoredWorkItem | null>(this.itemPath(repoId, id), null);
        return result ?? undefined;
    }

    private async writeItem(repoId: string, item: WorkItem): Promise<void> {
        const { syncLinks: _legacySyncLinks, ...cleanItem } = item as LegacyStoredWorkItem;
        await this.atomicWrite(this.itemPath(repoId, item.id), JSON.stringify(cleanItem, null, 2));
    }

    private async readCounter(repoId: string): Promise<number> {
        const data = await this.readJSON<{ next: number }>(this.counterPath(repoId), { next: 0 });
        return data.next;
    }

    private async writeCounter(repoId: string, next: number): Promise<void> {
        await this.atomicWrite(this.counterPath(repoId), JSON.stringify({ next }, null, 2));
    }

    /**
     * Assign workItemNumber to all existing items that lack one (ordered by createdAt),
     * then initialize the counter. Called once per repo when the counter file is missing.
     */
    private async migrateWorkItemNumbers(repoId: string): Promise<void> {
        const index = await this.readIndex(repoId);
        // Collect items that already have numbers to find the max
        let maxNumber = 0;
        const needsMigration: WorkItemIndexEntry[] = [];
        for (const entry of index) {
            if (entry.workItemNumber != null) {
                maxNumber = Math.max(maxNumber, entry.workItemNumber);
            } else {
                needsMigration.push(entry);
            }
        }

        // Sort by createdAt ascending so earlier items get lower numbers
        needsMigration.sort((a, b) => a.createdAt.localeCompare(b.createdAt));

        let nextNumber = maxNumber + 1;
        for (const entry of needsMigration) {
            const item = await this.readItem(repoId, entry.id);
            if (item && item.workItemNumber == null) {
                item.workItemNumber = nextNumber;
                await this.writeItem(repoId, item);
            }
            entry.workItemNumber = nextNumber;
            nextNumber++;
        }

        if (needsMigration.length > 0) {
            await this.writeIndex(repoId, index);
        }
        await this.writeCounter(repoId, nextNumber);
    }

    /**
     * Get the next work item number for a repo, initializing/migrating if needed.
     * Must be called inside enqueueWrite to ensure atomicity.
     */
    private async nextWorkItemNumber(repoId: string): Promise<number> {
        const counterFile = this.counterPath(repoId);
        try {
            await fs.access(counterFile);
        } catch {
            // Counter file doesn't exist — run migration
            await this.migrateWorkItemNumbers(repoId);
        }
        const current = await this.readCounter(repoId);
        const next = current === 0 ? 1 : current;
        await this.writeCounter(repoId, next + 1);
        return next;
    }

    // ── CRUD ────────────────────────────────────────────────────

    async addWorkItem(item: WorkItem): Promise<void> {
        return this.enqueueWrite(async () => {
            const index = await this.readIndex(item.repoId);
            if (index.some(e => e.id === item.id)) {
                throw new Error(`Work item already exists: ${item.id}`);
            }
            // Assign sequential work item number
            if (item.workItemNumber == null) {
                item.workItemNumber = await this.nextWorkItemNumber(item.repoId);
            }
            await this.writeItem(item.repoId, item);
            // Save initial plan version if present
            if (item.plan) {
                const planVersion: WorkItemPlanVersion = {
                    version: item.plan.version,
                    content: item.plan.content,
                    createdAt: item.plan.updatedAt,
                    resolvedBy: item.plan.resolvedBy,
                };
                await this.writePlanVersionFile(item.repoId, item.id, planVersion);
            }
            index.push(toIndexEntry(item));
            await this.writeIndex(item.repoId, index);
        });
    }

    async getWorkItem(id: string, repoId?: string): Promise<WorkItem | undefined> {
        if (repoId) {
            await this.readIndex(repoId);
            return this.readItem(repoId, id);
        }
        // Scan all repos (expensive but needed for cross-repo lookup)
        const repos = await this.listRepoIds();
        for (const repo of repos) {
            await this.readIndex(repo);
            const item = await this.readItem(repo, id);
            if (item) return item;
        }
        return undefined;
    }

    async updateWorkItem(
        id: string,
        updates: Partial<Omit<WorkItem, 'id' | 'repoId' | 'createdAt'>>,
    ): Promise<WorkItem | undefined> {
        let updated: WorkItem | undefined;
        await this.enqueueWrite(async () => {
            const repos = updates.status !== undefined
                ? await this.findRepoForItem(id)
                : await this.findRepoForItem(id);
            if (!repos) return;

            const item = await this.readItem(repos, id);
            if (!item) return;

            const now = new Date().toISOString();
            updated = { ...item, ...updates, updatedAt: now };

            await this.writeItem(repos, updated);

            // Update index
            const index = await this.readIndex(repos);
            const idx = index.findIndex(e => e.id === id);
            if (idx !== -1) {
                index[idx] = toIndexEntry(updated);
            }
            await this.writeIndex(repos, index);
        });
        return updated;
    }

    async removeWorkItem(id: string): Promise<boolean> {
        let removed = false;
        await this.enqueueWrite(async () => {
            const repoId = await this.findRepoForItem(id);
            if (!repoId) return;

            const index = await this.readIndex(repoId);

            // Block deletion if children exist
            const childCount = index.filter(e => e.parentId === id).length;
            if (childCount > 0) {
                throw new Error(
                    `Cannot delete work item: it has ${childCount} child item(s). ` +
                    `Move, unlink, or delete children first.`,
                );
            }

            // Remove item file
            try {
                await fs.unlink(this.itemPath(repoId, id));
            } catch { /* ignore */ }

            // Remove plan versions directory
            try {
                await fs.rm(this.planDir(repoId, id), { recursive: true, force: true });
            } catch { /* ignore */ }

            // Remove from index
            const filtered = index.filter(e => e.id !== id);
            await this.writeIndex(repoId, filtered);

            removed = index.length !== filtered.length;
        });
        return removed;
    }

    async listWorkItems(filter?: WorkItemFilter): Promise<WorkItemListResult> {
        const repoId = filter?.repoId;
        let entries: WorkItemIndexEntry[];

        if (repoId) {
            entries = await this.readIndex(repoId);
        } else {
            // Aggregate across all repos
            const repos = await this.listRepoIds();
            entries = [];
            for (const repo of repos) {
                entries.push(...await this.readIndex(repo));
            }
        }

        let filtered = this.applyFilter(entries, filter);

        // Apply search (case-insensitive substring match against title, description, tags)
        if (filter?.search) {
            const q = filter.search.toLowerCase();
            filtered = filtered.filter(e => {
                if (e.title.toLowerCase().includes(q)) return true;
                if (e.description && e.description.toLowerCase().includes(q)) return true;
                if (e.tags?.some(t => t.toLowerCase().includes(q))) return true;
                return false;
            });
        }

        const total = filtered.length;

        // Apply pagination
        if (filter?.offset !== undefined || filter?.limit !== undefined) {
            const offset = filter.offset ?? 0;
            const limit = filter.limit ?? filtered.length;
            filtered = filtered.slice(offset, offset + limit);
        }

        return { items: filtered, total };
    }

    async listWorkItemsGrouped(filter?: WorkItemFilter): Promise<WorkItemGroupedResult> {
        const repoId = filter?.repoId;
        let entries: WorkItemIndexEntry[];

        if (repoId) {
            entries = await this.readIndex(repoId);
        } else {
            const repos = await this.listRepoIds();
            entries = [];
            for (const repo of repos) {
                entries.push(...await this.readIndex(repo));
            }
        }

        // Apply non-status filters (source, priority, type, tags)
        const filterWithoutStatus = filter ? { ...filter, status: undefined } : undefined;
        let filtered = this.applyFilter(entries, filterWithoutStatus);

        // Apply search
        if (filter?.search) {
            const q = filter.search.toLowerCase();
            filtered = filtered.filter(e => {
                if (e.title.toLowerCase().includes(q)) return true;
                if (e.description && e.description.toLowerCase().includes(q)) return true;
                if (e.tags?.some(t => t.toLowerCase().includes(q))) return true;
                return false;
            });
        }

        const limit = filter?.limit ?? 20;
        const groups: Record<string, WorkItemListResult> = {};

        const groupedStatuses = new Set(filtered.map(entry => entry.status));
        for (const status of WORK_ITEM_STATUSES) {
            const statusItems = filtered.filter(e => e.status === status);
            if (statusItems.length === 0) continue;
            groups[status] = {
                items: statusItems.slice(0, limit),
                total: statusItems.length,
            };
            groupedStatuses.delete(status);
        }

        for (const status of [...groupedStatuses].sort((a, b) => a.localeCompare(b))) {
            const statusItems = filtered.filter(e => e.status === status);
            groups[status] = {
                items: statusItems.slice(0, limit),
                total: statusItems.length,
            };
        }

        return { groups };
    }

    // ── Plan versioning ─────────────────────────────────────────

    async getPlanVersions(workItemId: string): Promise<WorkItemPlanVersion[]> {
        const repoId = await this.findRepoForItem(workItemId);
        if (!repoId) return [];

        const dir = this.planDir(repoId, workItemId);
        try {
            const files = await fs.readdir(dir);
            const versions: WorkItemPlanVersion[] = [];
            for (const file of files.filter(f => f.startsWith('v') && f.endsWith('.md'))) {
                const versionNum = parseInt(file.slice(1, -3), 10);
                if (isNaN(versionNum)) continue;
                const content = await fs.readFile(path.join(dir, file), 'utf-8');
                // Parse metadata header if present, otherwise bare content
                const parsed = this.parsePlanFile(content, versionNum);
                versions.push(parsed);
            }
            return versions.sort((a, b) => a.version - b.version);
        } catch {
            return [];
        }
    }

    async getPlanVersion(workItemId: string, version: number): Promise<WorkItemPlanVersion | undefined> {
        const repoId = await this.findRepoForItem(workItemId);
        if (!repoId) return undefined;

        const filePath = this.planVersionPath(repoId, workItemId, version);
        try {
            const content = await fs.readFile(filePath, 'utf-8');
            return this.parsePlanFile(content, version);
        } catch {
            return undefined;
        }
    }

    async savePlanVersion(workItemId: string, plan: WorkItemPlanVersion): Promise<void> {
        return this.enqueueWrite(async () => {
            const repoId = await this.findRepoForItem(workItemId);
            if (!repoId) return;
            await this.writePlanVersionFile(repoId, workItemId, plan);
        });
    }

    // ── Execution history ───────────────────────────────────────

    async addExecution(workItemId: string, execution: WorkItemExecution): Promise<void> {
        return this.enqueueWrite(async () => {
            const repoId = await this.findRepoForItem(workItemId);
            if (!repoId) return;

            const item = await this.readItem(repoId, workItemId);
            if (!item) return;

            const history = item.executionHistory ?? [];
            history.push(execution);
            item.executionHistory = history;
            item.taskId = execution.taskId;
            item.processId = execution.processId;
            item.updatedAt = new Date().toISOString();

            await this.writeItem(repoId, item);

            // Keep index in sync (lastRunAt, updatedAt)
            await this.refreshIndexEntry(repoId, item);
        });
    }

    async updateExecution(
        workItemId: string,
        taskId: string,
        updates: Partial<WorkItemExecution>,
    ): Promise<void> {
        return this.enqueueWrite(async () => {
            const repoId = await this.findRepoForItem(workItemId);
            if (!repoId) return;

            const item = await this.readItem(repoId, workItemId);
            if (!item?.executionHistory) return;

            const execIdx = item.executionHistory.findIndex(e => e.taskId === taskId);
            if (execIdx === -1) return;

            item.executionHistory[execIdx] = { ...item.executionHistory[execIdx], ...updates };
            item.updatedAt = new Date().toISOString();

            await this.writeItem(repoId, item);

            // Keep index in sync (lastRunAt, updatedAt)
            await this.refreshIndexEntry(repoId, item);
        });
    }

    // ── Change tracking ─────────────────────────────────────────────

    async addChange(workItemId: string, change: WorkItemChange): Promise<void> {
        return this.enqueueWrite(async () => {
            const repoId = await this.findRepoForItem(workItemId);
            if (!repoId) return;
            const item = await this.readItem(repoId, workItemId);
            if (!item) return;
            item.changes = [...(item.changes ?? []), change];
            item.updatedAt = new Date().toISOString();
            await this.writeItem(repoId, item);
        });
    }

    async updateChange(workItemId: string, changeId: string, updates: Partial<WorkItemChange>): Promise<void> {
        return this.enqueueWrite(async () => {
            const repoId = await this.findRepoForItem(workItemId);
            if (!repoId) return;
            const item = await this.readItem(repoId, workItemId);
            if (!item?.changes) return;
            const idx = item.changes.findIndex(c => c.id === changeId);
            if (idx === -1) return;
            item.changes[idx] = { ...item.changes[idx], ...updates };
            item.updatedAt = new Date().toISOString();
            await this.writeItem(repoId, item);
        });
    }

    async getChanges(workItemId: string): Promise<WorkItemChange[]> {
        const repoId = await this.findRepoForItem(workItemId);
        if (!repoId) return [];
        const item = await this.readItem(repoId, workItemId);
        return item?.changes ?? [];
    }

    /**
     * List all index entries whose parentId matches the given id.
     * Used by hierarchy routes to enumerate direct children.
     */
    async listChildren(parentId: string, repoId: string): Promise<WorkItemIndexEntry[]> {
        const index = await this.readIndex(repoId);
        return index.filter(e => e.parentId === parentId);
    }

    // ── Internal helpers ────────────────────────────────────────

    private async writePlanVersionFile(
        repoId: string,
        workItemId: string,
        plan: WorkItemPlanVersion,
    ): Promise<void> {
        const header = [
            `---`,
            `version: ${plan.version}`,
            `createdAt: ${plan.createdAt}`,
            ...(plan.resolvedBy ? [`resolvedBy: ${plan.resolvedBy}`] : []),
            ...(plan.summary ? [`summary: ${plan.summary}`] : []),
            `---`,
            '',
        ].join('\n');
        const filePath = this.planVersionPath(repoId, workItemId, plan.version);
        await this.atomicWrite(filePath, header + plan.content);
    }

    private parsePlanFile(raw: string, version: number): WorkItemPlanVersion {
        // Parse optional YAML front-matter header
        const frontMatterMatch = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
        if (!frontMatterMatch) {
            return { version, content: raw, createdAt: '' };
        }
        const meta = frontMatterMatch[1];
        const content = frontMatterMatch[2];
        const createdAt = meta.match(/createdAt:\s*(.+)/)?.[1]?.trim() ?? '';
        const resolvedBy = meta.match(/resolvedBy:\s*(.+)/)?.[1]?.trim() as 'user' | 'ai' | undefined;
        const summary = meta.match(/summary:\s*(.+)/)?.[1]?.trim();
        return { version, content, createdAt, resolvedBy, summary };
    }

    private applyFilter(entries: WorkItemIndexEntry[], filter?: WorkItemFilter): WorkItemIndexEntry[] {
        if (!filter) return entries;

        const entriesById = filter.tracker
            ? new Map(entries.map(entry => [entry.id, entry]))
            : undefined;
        return entries.filter(e => {
            if (filter.status) {
                const statuses = Array.isArray(filter.status) ? filter.status : [filter.status];
                if (!statuses.includes(e.status)) return false;
            }
            if (filter.source && e.source !== filter.source) return false;
            if (filter.priority && e.priority !== filter.priority) return false;
            if (filter.type && (e.type ?? 'work-item') !== filter.type) return false;
            if (filter.tracker && entriesById && this.getInheritedTrackerKind(e, entriesById) !== filter.tracker) return false;
            if (filter.tags?.length) {
                if (!e.tags?.some(t => filter.tags!.includes(t))) return false;
            }
            return true;
        });
    }

    private getInheritedTrackerKind(
        entry: WorkItemIndexEntry,
        entriesById: Map<string, WorkItemIndexEntry>,
    ): ReturnType<typeof getOwnWorkItemTrackerKind> {
        let current = entry;
        const visited = new Set<string>();
        while (current.parentId && !visited.has(current.id)) {
            visited.add(current.id);
            const parent = entriesById.get(current.parentId);
            if (!parent) break;
            current = parent;
        }
        return getOwnWorkItemTrackerKind(current);
    }

    private findRootEpicEntry(
        entry: WorkItemIndexEntry,
        entriesById: Map<string, WorkItemIndexEntry>,
    ): WorkItemIndexEntry | undefined {
        let current = entry;
        const visited = new Set<string>();
        while (current.parentId && !visited.has(current.id)) {
            visited.add(current.id);
            const parent = entriesById.get(current.parentId);
            if (!parent) break;
            current = parent;
        }
        return (current.type ?? 'work-item') === 'epic' && !current.parentId ? current : undefined;
    }

    private async migrateLegacySyncLinks(repoId: string, entries: LegacyWorkItemIndexEntry[]): Promise<WorkItemIndexEntry[]> {
        if (!entries.some(entry => entry.syncLinks?.length)) return entries;

        const entriesById = new Map(entries.map(entry => [entry.id, entry]));
        const itemsById = new Map<string, LegacyStoredWorkItem>();
        for (const entry of entries) {
            const item = await this.readItem(repoId, entry.id);
            if (item) itemsById.set(entry.id, item);
        }

        const githubRootTrackers = new Map<string, WorkItemTrackerMetadata & { kind: 'github-backed' }>();
        for (const entry of entries) {
            if ((entry.type ?? 'work-item') !== 'epic' || entry.parentId) continue;
            const rootItem = itemsById.get(entry.id);
            if (rootItem?.tracker?.kind === 'github-backed') {
                githubRootTrackers.set(entry.id, rootItem.tracker);
                continue;
            }
            const legacyLink = rootItem ? getLegacyGitHubSyncLink(rootItem) : undefined;
            const tracker = legacyLink ? githubTrackerFromLegacySyncLink(legacyLink) : undefined;
            if (tracker) githubRootTrackers.set(entry.id, tracker);
        }

        let changed = false;
        const nextEntries: WorkItemIndexEntry[] = [];

        for (const entry of entries) {
            const item = itemsById.get(entry.id);
            const hasLegacyEntryLinks = (entry.syncLinks?.length ?? 0) > 0;
            if (!item) {
                if (hasLegacyEntryLinks) {
                    const { syncLinks: _legacySyncLinks, ...entryWithoutLegacyLinks } = entry;
                    nextEntries.push(entryWithoutLegacyLinks);
                    changed = true;
                } else {
                    nextEntries.push(entry);
                }
                continue;
            }

            const hasLegacyItemLinks = (item.syncLinks?.length ?? 0) > 0;
            if (!hasLegacyItemLinks && !hasLegacyEntryLinks) {
                nextEntries.push(entry);
                continue;
            }

            const updated: LegacyStoredWorkItem = { ...item };
            const rootEntry = this.findRootEpicEntry(entry, entriesById);
            const rootTracker = rootEntry ? githubRootTrackers.get(rootEntry.id) : undefined;
            const legacyLink = getLegacyGitHubSyncLink(item);

            if (rootEntry?.id === entry.id && rootTracker) {
                updated.tracker = rootTracker;
            }

            if (rootTracker && legacyLink) {
                const mirror = githubMirrorFromLegacySyncLink(legacyLink);
                if (mirror && !updated.githubMirror) {
                    updated.githubMirror = mirror;
                }
            }

            delete updated.syncLinks;
            await this.writeItem(repoId, updated);
            nextEntries.push(toIndexEntry(updated));
            changed = true;
        }

        if (changed) {
            await this.writeIndex(repoId, nextEntries);
        }
        return nextEntries;
    }

    private async findRepoForItem(id: string): Promise<string | undefined> {
        const repos = await this.listRepoIds();
        for (const repo of repos) {
            const index = await this.readIndex(repo);
            if (index.some(e => e.id === id)) return repo;
        }
        return undefined;
    }

    private async refreshIndexEntry(repoId: string, item: WorkItem): Promise<void> {
        const index = await this.readIndex(repoId);
        const idx = index.findIndex(e => e.id === item.id);
        if (idx !== -1) {
            index[idx] = toIndexEntry(item);
            await this.writeIndex(repoId, index);
        }
    }

    private async listRepoIds(): Promise<string[]> {
        const reposDir = path.join(this.dataDir, 'repos');
        try {
            const entries = await fs.readdir(reposDir, { withFileTypes: true });
            const repoIds: string[] = [];
            for (const entry of entries) {
                if (!entry.isDirectory()) continue;
                // Only include repos that have a work-items directory
                try {
                    await fs.access(path.join(reposDir, entry.name, 'work-items', 'index.json'));
                    repoIds.push(entry.name);
                } catch {
                    // No work-items in this repo — skip
                }
            }
            return repoIds;
        } catch {
            return [];
        }
    }

    // ── Pin/archive ─────────────────────────────────────────────

    async pinWorkItem(id: string, pinnedAt: string): Promise<WorkItem | undefined> {
        return this.updateWorkItem(id, { pinnedAt });
    }

    async unpinWorkItem(id: string): Promise<WorkItem | undefined> {
        return this.updateWorkItem(id, { pinnedAt: undefined });
    }

    async archiveWorkItem(id: string, archivedAt: string): Promise<WorkItem | undefined> {
        return this.updateWorkItem(id, { archivedAt });
    }

    async unarchiveWorkItem(id: string): Promise<WorkItem | undefined> {
        return this.updateWorkItem(id, { archivedAt: undefined });
    }
}
