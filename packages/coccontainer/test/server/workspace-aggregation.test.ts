/**
 * Unit tests for WorkspaceAggregationService — online aggregation, offline cache
 * fallback, disconnected-agent metadata, and the cache-unification regression.
 */

import { describe, it, expect, vi } from 'vitest';
import { WorkspaceAggregationService } from '../../src/server/workspace-aggregation';
import type { Agent } from '../../src/store';

function agent(partial: Partial<Agent>): Agent {
    return { id: 'a1', name: 'A', address: 'http://h:1', status: 'unknown', lastSeenAt: null, createdAt: '', ...partial };
}

describe('WorkspaceAggregationService', () => {
    it('aggregates and decorates workspaces from an online agent (array response)', async () => {
        const proxy = { proxy: vi.fn().mockResolvedValue({ status: 200, body: JSON.stringify([{ id: 'w1', rootPath: '/r' }]), headers: {} }) };
        const svc = new WorkspaceAggregationService(proxy as any, {} as any);
        const res = await svc.aggregate([agent({ id: 'a1', name: 'Agent1', address: 'http://h:1' })]);
        expect(res).toHaveLength(1);
        expect(res[0]).toMatchObject({ id: 'w1', agentId: 'a1', agentName: 'Agent1', agentAddress: 'http://h:1' });
    });

    it('accepts the { workspaces: [...] } response shape', async () => {
        const proxy = { proxy: vi.fn().mockResolvedValue({ status: 200, body: JSON.stringify({ workspaces: [{ id: 'w1', rootPath: '/r' }] }), headers: {} }) };
        const svc = new WorkspaceAggregationService(proxy as any, {} as any);
        const res = await svc.aggregate([agent({})]);
        expect(res.map(w => w.id)).toEqual(['w1']);
    });

    it('falls back to the cache on a non-200 response', async () => {
        const proxy = { proxy: vi.fn() };
        const svc = new WorkspaceAggregationService(proxy as any, {} as any);
        proxy.proxy.mockResolvedValueOnce({ status: 200, body: JSON.stringify([{ id: 'w1', rootPath: '/r' }]), headers: {} });
        await svc.aggregate([agent({ address: 'http://h:1' })]); // seed cache
        proxy.proxy.mockResolvedValueOnce({ status: 500, body: '', headers: {} });
        const res = await svc.aggregate([agent({ address: 'http://h:1' })]);
        expect(res.map(w => w.id)).toEqual(['w1']);
    });

    it('returns cached workspaces for offline agents with agentOffline flag', async () => {
        const svc = new WorkspaceAggregationService({ proxy: vi.fn() } as any, {} as any);
        svc.addCachedWorkspace('http://h:1', { id: 'w1', rootPath: '/r' });
        const res = await svc.aggregate([agent({ status: 'offline', address: 'http://h:1' })]);
        expect(res).toHaveLength(1);
        expect(res[0]).toMatchObject({ id: 'w1', agentOffline: true, agentId: 'a1' });
    });

    it('falls back to disconnected-agent metadata for offline inbound agents with empty cache', async () => {
        const mgr = { getDisconnectedAgent: vi.fn().mockReturnValue({ workspaces: [{ id: 'w9', name: 'W9', rootPath: '/p' }] }) };
        const svc = new WorkspaceAggregationService({ proxy: vi.fn() } as any, mgr as any);
        const res = await svc.aggregate([agent({ status: 'offline', address: 'inbound://abc' })]);
        expect(mgr.getDisconnectedAgent).toHaveBeenCalledWith('abc');
        expect(res.map(w => w.id)).toEqual(['w9']);
        expect(res[0]).toMatchObject({ agentOffline: true });
    });

    it('REGRESSION: a workspace registered via addCachedWorkspace appears in aggregation', async () => {
        // The /api/container/workspace-registered route calls addCachedWorkspace and
        // /api/workspaces aggregation must read the SAME cache, so a just-registered
        // workspace surfaces immediately — even before the agent itself reports it.
        // (Previously the route wrote to a separate module-level cache that the
        // server aggregation never read, so the workspace never appeared.)
        const proxy = { proxy: vi.fn().mockResolvedValue({ status: 200, body: '[]', headers: {} }) };
        const svc = new WorkspaceAggregationService(proxy as any, {} as any);
        svc.addCachedWorkspace('http://h:1', { id: 'w-new', rootPath: '/new' });
        const res = await svc.aggregate([agent({ id: 'a1', name: 'Agent1', status: 'unknown', address: 'http://h:1' })]);
        expect(res.map(w => w.id)).toContain('w-new');
        expect(res.find(w => w.id === 'w-new')).toMatchObject({ agentId: 'a1', agentName: 'Agent1', agentAddress: 'http://h:1' });
    });
});
