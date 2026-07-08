/**
 * WorktreeMetadataStore — repo-scoped index of CoC-created Git worktrees.
 *
 * Persists one JSON index per workspace under the repo-scoped data root:
 *
 *   <dataDir>/repos/<workspaceId>/git-worktrees/index.json
 *
 * The index lists every {@link WorktreeMetadata} record for that workspace so
 * the cleanup list (AC-06) and run-detail chips (AC-05) can enumerate worktrees
 * scoped strictly to the selected workspace. The actual worktree checkouts live
 * in sibling `git-worktrees/<id>/` directories created by the worktree service.
 *
 * This module is pure persistence — it never runs Git. Git creation/removal is
 * the worktree service's job.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { WorktreeMetadata } from '@plusplusoneplusplus/coc-client';
import { getRepoDataPath } from '../paths';
import { atomicWriteJSON } from '../shared/fs-utils';

export type { WorktreeMetadata };

/** Directory (under the repo data root) that holds worktree checkouts + index. */
export const WORKTREES_DIR = 'git-worktrees';
/** Index filename inside {@link WORKTREES_DIR}. */
export const WORKTREES_INDEX_FILE = 'index.json';

export interface WorktreeMetadataStoreOptions {
    /** CoC data root (e.g. `~/.coc`). */
    dataDir: string;
}

/**
 * File-backed store for worktree metadata records, scoped per workspace.
 */
export class WorktreeMetadataStore {
    constructor(private readonly options: WorktreeMetadataStoreOptions) {}

    /** Absolute path to the `git-worktrees` directory for a workspace. */
    getWorktreesDir(workspaceId: string): string {
        return getRepoDataPath(this.options.dataDir, workspaceId, WORKTREES_DIR);
    }

    /** Absolute path to the per-run worktree checkout directory. */
    getWorktreePath(workspaceId: string, id: string): string {
        return path.join(this.getWorktreesDir(workspaceId), id);
    }

    /** Absolute path to the workspace's worktree index file. */
    private getIndexPath(workspaceId: string): string {
        return path.join(this.getWorktreesDir(workspaceId), WORKTREES_INDEX_FILE);
    }

    /**
     * Return every worktree record for a workspace, newest first. Missing or
     * unreadable index files yield an empty list (nothing recorded yet).
     */
    async list(workspaceId: string): Promise<WorktreeMetadata[]> {
        const indexPath = this.getIndexPath(workspaceId);
        let raw: string;
        try {
            raw = await fs.promises.readFile(indexPath, 'utf-8');
        } catch (err: any) {
            if (err?.code === 'ENOENT') return [];
            throw err;
        }
        let parsed: unknown;
        try {
            parsed = JSON.parse(raw);
        } catch {
            return [];
        }
        if (!Array.isArray(parsed)) return [];
        return (parsed as WorktreeMetadata[])
            .filter(entry => entry && typeof entry === 'object' && typeof entry.id === 'string')
            .slice()
            .sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
    }

    /** Return a single worktree record, or `null` when it is not recorded. */
    async get(workspaceId: string, id: string): Promise<WorktreeMetadata | null> {
        const all = await this.list(workspaceId);
        return all.find(entry => entry.id === id) ?? null;
    }

    /**
     * Insert or replace a worktree record (keyed by `id`), then persist the
     * whole index atomically. Returns the stored record.
     */
    async upsert(record: WorktreeMetadata): Promise<WorktreeMetadata> {
        const all = await this.list(record.workspaceId);
        const idx = all.findIndex(entry => entry.id === record.id);
        if (idx >= 0) {
            all[idx] = record;
        } else {
            all.push(record);
        }
        await atomicWriteJSON(this.getIndexPath(record.workspaceId), all);
        return record;
    }

    /**
     * Load → mutate → write a single record. Returns the updated record, or
     * `null` when no record with `id` exists (the index is left unchanged).
     */
    async update(
        workspaceId: string,
        id: string,
        mutate: (record: WorktreeMetadata) => WorktreeMetadata,
    ): Promise<WorktreeMetadata | null> {
        const all = await this.list(workspaceId);
        const idx = all.findIndex(entry => entry.id === id);
        if (idx < 0) return null;
        const next = mutate(all[idx]);
        all[idx] = next;
        await atomicWriteJSON(this.getIndexPath(workspaceId), all);
        return next;
    }

    /**
     * Mark a worktree record as cleaned (checkout removed). The branch is never
     * touched — cleanup preserves it. Returns the updated record, or `null`
     * when the record does not exist.
     */
    async markCleaned(
        workspaceId: string,
        id: string,
        cleanedAt: string,
    ): Promise<WorktreeMetadata | null> {
        return this.update(workspaceId, id, record => ({
            ...record,
            status: 'cleaned',
            cleanedAt,
        }));
    }
}
