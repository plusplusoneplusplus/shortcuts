import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { SqliteProcessStore } from '@plusplusoneplusplus/forge';
import { createProcessWorkspaceResolver } from '../../../src/server/processes/process-workspace-resolver';

describe('createProcessWorkspaceResolver', () => {
    let store: SqliteProcessStore;
    const tasks = new Map<string, { repoId?: string }>();
    const resolve = () => createProcessWorkspaceResolver({ getTask: id => tasks.get(id) }, store);

    beforeEach(async () => {
        tasks.clear();
        store = new SqliteProcessStore({ dbPath: ':memory:' });
        for (const [id, workspaceId] of [['queue_done-1', 'ws_a'], ['plain-1', 'ws_b']]) {
            await store.addProcess({ id, type: 'chat', status: 'completed', promptPreview: '',
                startTime: new Date(), metadata: { workspaceId } });
        }
    });
    afterEach(() => store.close());

    it('falls back to the persisted owner when the queue no longer holds the task', async () => {
        expect(await resolve()('queue_done-1')).toBe('ws_a');
        expect(await resolve()('done-1')).toBe('ws_a');
        expect(await resolve()('plain-1')).toBe('ws_b');
    });

    it('resolves a queued-only owner from the live task by its bare id', async () => {
        tasks.set('live-1', { repoId: 'ws_live' });
        expect(await resolve()('queue_live-1')).toBe('ws_live');
        expect(await resolve()('live-1')).toBe('ws_live');
    });

    it('prefers the live task repoId over persisted metadata', async () => {
        tasks.set('done-1', { repoId: 'ws_live' });
        expect(await resolve()('queue_done-1')).toBe('ws_live');
    });

    it('returns undefined for unknown owners, missing metadata and store failures', async () => {
        await store.addProcess({ id: 'queue_nows', type: 'chat', status: 'completed', promptPreview: '',
            startTime: new Date(), metadata: {} });
        expect(await resolve()('queue_missing')).toBeUndefined();
        expect(await resolve()('queue_nows')).toBeUndefined();
        const failing = createProcessWorkspaceResolver({}, { getProcess: async () => { throw new Error('db'); } });
        expect(await failing('queue_done-1')).toBeUndefined();
    });
});
