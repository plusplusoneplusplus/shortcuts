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
    WorkItemIndexEntry,
    WorkItemFilter,
    WorkItemPlanVersion,
    WorkItemExecution,
    WorkItemChange,
    WorkItemStore,
    WorkItemStatus,
} from './types';
import { toIndexEntry } from './types';

// ============================================================================
// Store Implementation
// ============================================================================

export interface FileWorkItemStoreOptions {
    /** Base data directory (default: ~/.coc). */
    dataDir: string;
}

export class FileWorkItemStore implements WorkItemStore {
    private readonly dataDir: string;
    private writeQueue: Promise<void> = Promise.resolve();

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
            const data = await fs.readFile(filePath, 'utf-8');
            return JSON.parse(data) as T;
        } catch {
            return defaultValue;
        }
    }

    private async readIndex(repoId: string): Promise<WorkItemIndexEntry[]> {
        return this.readJSON(this.indexPath(repoId), []);
    }

    private async writeIndex(repoId: string, entries: WorkItemIndexEntry[]): Promise<void> {
        await this.atomicWrite(this.indexPath(repoId), JSON.stringify(entries, null, 2));
    }

    private async readItem(repoId: string, id: string): Promise<WorkItem | undefined> {
        const result = await this.readJSON<WorkItem | null>(this.itemPath(repoId, id), null);
        return result ?? undefined;
    }

    private async writeItem(repoId: string, item: WorkItem): Promise<void> {
        await this.atomicWrite(this.itemPath(repoId, item.id), JSON.stringify(item, null, 2));
    }

    // ── CRUD ────────────────────────────────────────────────────

    async addWorkItem(item: WorkItem): Promise<void> {
        return this.enqueueWrite(async () => {
            const index = await this.readIndex(item.repoId);
            if (index.some(e => e.id === item.id)) {
                throw new Error(`Work item already exists: ${item.id}`);
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
            return this.readItem(repoId, id);
        }
        // Scan all repos (expensive but needed for cross-repo lookup)
        const repos = await this.listRepoIds();
        for (const repo of repos) {
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

            // Remove item file
            try {
                await fs.unlink(this.itemPath(repoId, id));
            } catch { /* ignore */ }

            // Remove plan versions directory
            try {
                await fs.rm(this.planDir(repoId, id), { recursive: true, force: true });
            } catch { /* ignore */ }

            // Remove from index
            const index = await this.readIndex(repoId);
            const filtered = index.filter(e => e.id !== id);
            await this.writeIndex(repoId, filtered);

            removed = index.length !== filtered.length;
        });
        return removed;
    }

    async listWorkItems(filter?: WorkItemFilter): Promise<WorkItemIndexEntry[]> {
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

        return this.applyFilter(entries, filter);
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

        return entries.filter(e => {
            if (filter.status) {
                const statuses = Array.isArray(filter.status) ? filter.status : [filter.status];
                if (!statuses.includes(e.status)) return false;
            }
            if (filter.source && e.source !== filter.source) return false;
            if (filter.priority && e.priority !== filter.priority) return false;
            if (filter.type && (e.type ?? 'work-item') !== filter.type) return false;
            if (filter.tags?.length) {
                if (!e.tags?.some(t => filter.tags!.includes(t))) return false;
            }
            return true;
        });
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
}
