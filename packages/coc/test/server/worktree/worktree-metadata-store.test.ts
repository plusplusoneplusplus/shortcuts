/**
 * WorktreeMetadataStore — repo-scoped persistence of CoC-created worktree
 * records. Covers path scoping, upsert/get/list, update/markCleaned, workspace
 * isolation, newest-first ordering, and robustness against a missing/corrupt
 * index.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    WorktreeMetadataStore,
    WORKTREES_DIR,
    WORKTREES_INDEX_FILE,
} from '../../../src/server/worktree/worktree-metadata-store';
import type { WorktreeMetadata } from '@plusplusoneplusplus/coc-client';

function record(overrides: Partial<WorktreeMetadata> & Pick<WorktreeMetadata, 'id' | 'workspaceId'>): WorktreeMetadata {
    return {
        path: `/tmp/${overrides.id}`,
        branch: `coc/x-${overrides.id}`,
        baseSha: 'a'.repeat(40),
        createdAt: '2026-07-08T00:00:00.000Z',
        sourceDirty: false,
        status: 'active',
        ...overrides,
    };
}

describe('WorktreeMetadataStore', () => {
    let dataDir: string;
    let store: WorktreeMetadataStore;

    beforeEach(() => {
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-meta-store-'));
        store = new WorktreeMetadataStore({ dataDir });
    });

    afterEach(() => {
        fs.rmSync(dataDir, { recursive: true, force: true });
    });

    describe('path scoping', () => {
        it('scopes the worktrees dir and checkout path under repos/<workspaceId>', () => {
            expect(store.getWorktreesDir('ws-a')).toBe(
                path.join(dataDir, 'repos', 'ws-a', WORKTREES_DIR),
            );
            expect(store.getWorktreePath('ws-a', 'run-1')).toBe(
                path.join(dataDir, 'repos', 'ws-a', WORKTREES_DIR, 'run-1'),
            );
        });

        it('writes the index into git-worktrees/index.json', async () => {
            await store.upsert(record({ id: 'run-1', workspaceId: 'ws-a' }));
            const indexPath = path.join(dataDir, 'repos', 'ws-a', WORKTREES_DIR, WORKTREES_INDEX_FILE);
            expect(fs.existsSync(indexPath)).toBe(true);
        });
    });

    describe('list', () => {
        it('returns [] when no index exists', async () => {
            expect(await store.list('ws-missing')).toEqual([]);
        });

        it('returns [] when the index is corrupt JSON', async () => {
            const dir = store.getWorktreesDir('ws-a');
            fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(path.join(dir, WORKTREES_INDEX_FILE), 'not json', 'utf-8');
            expect(await store.list('ws-a')).toEqual([]);
        });

        it('sorts newest-first by createdAt', async () => {
            await store.upsert(record({ id: 'old', workspaceId: 'ws-a', createdAt: '2026-01-01T00:00:00.000Z' }));
            await store.upsert(record({ id: 'new', workspaceId: 'ws-a', createdAt: '2026-06-01T00:00:00.000Z' }));
            const all = await store.list('ws-a');
            expect(all.map(r => r.id)).toEqual(['new', 'old']);
        });
    });

    describe('upsert / get', () => {
        it('inserts then reads back a record', async () => {
            await store.upsert(record({ id: 'run-1', workspaceId: 'ws-a', branch: 'coc/feature-abc' }));
            const got = await store.get('ws-a', 'run-1');
            expect(got?.branch).toBe('coc/feature-abc');
        });

        it('replaces an existing record by id (no duplicates)', async () => {
            await store.upsert(record({ id: 'run-1', workspaceId: 'ws-a', baseSha: 'a'.repeat(40) }));
            await store.upsert(record({ id: 'run-1', workspaceId: 'ws-a', baseSha: 'b'.repeat(40) }));
            const all = await store.list('ws-a');
            expect(all).toHaveLength(1);
            expect(all[0].baseSha).toBe('b'.repeat(40));
        });

        it('returns null for an unknown id', async () => {
            expect(await store.get('ws-a', 'nope')).toBeNull();
        });
    });

    describe('update / markCleaned', () => {
        it('markCleaned sets status + cleanedAt and preserves the branch', async () => {
            await store.upsert(record({ id: 'run-1', workspaceId: 'ws-a', branch: 'coc/keep-me' }));
            const updated = await store.markCleaned('ws-a', 'run-1', '2026-07-09T00:00:00.000Z');
            expect(updated?.status).toBe('cleaned');
            expect(updated?.cleanedAt).toBe('2026-07-09T00:00:00.000Z');
            expect(updated?.branch).toBe('coc/keep-me');
        });

        it('markCleaned returns null and does not create a record when id is unknown', async () => {
            expect(await store.markCleaned('ws-a', 'nope', '2026-07-09T00:00:00.000Z')).toBeNull();
            expect(await store.list('ws-a')).toEqual([]);
        });

        it('update returns null for an unknown id', async () => {
            const result = await store.update('ws-a', 'nope', r => r);
            expect(result).toBeNull();
        });
    });

    describe('workspace isolation', () => {
        it('does not leak records across workspaces', async () => {
            await store.upsert(record({ id: 'run-a', workspaceId: 'ws-a' }));
            await store.upsert(record({ id: 'run-b', workspaceId: 'ws-b' }));
            expect((await store.list('ws-a')).map(r => r.id)).toEqual(['run-a']);
            expect((await store.list('ws-b')).map(r => r.id)).toEqual(['run-b']);
            expect(await store.get('ws-a', 'run-b')).toBeNull();
        });
    });
});
