/**
 * Tests for CronsClient — verifies API path construction and method delegation.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CronsClient } from '@plusplusoneplusplus/coc-client';
import type { RequestAdapter } from '@plusplusoneplusplus/coc-client';

describe('CronsClient', () => {
    let transport: RequestAdapter;
    let client: CronsClient;

    beforeEach(() => {
        transport = {
            request: vi.fn().mockResolvedValue({ crons: [] }),
        } as any;
        client = new CronsClient(transport);
    });

    it('list() calls correct workspace-scoped path', async () => {
        await client.list('ws-abc');
        expect(transport.request).toHaveBeenCalledWith('/workspaces/ws-abc/crons');
    });

    it('listAll() calls server-wide /crons path', async () => {
        await client.listAll();
        expect(transport.request).toHaveBeenCalledWith('/crons');
    });

    it('get() calls correct cron path', async () => {
        (transport.request as any).mockResolvedValue({ cron: { id: 'l1' } });
        await client.get('ws-abc', 'l1');
        expect(transport.request).toHaveBeenCalledWith('/workspaces/ws-abc/crons/l1');
    });

    it('patch() sends PATCH with body', async () => {
        (transport.request as any).mockResolvedValue({ cron: { id: 'l1' } });
        await client.patch('ws-abc', 'l1', { description: 'updated' });
        expect(transport.request).toHaveBeenCalledWith('/workspaces/ws-abc/crons/l1', {
            method: 'PATCH',
            body: { description: 'updated' },
        });
    });

    it('delete() sends DELETE', async () => {
        (transport.request as any).mockResolvedValue({ deleted: true, cron: { id: 'l1' } });
        await client.delete('ws-abc', 'l1');
        expect(transport.request).toHaveBeenCalledWith('/workspaces/ws-abc/crons/l1', {
            method: 'DELETE',
        });
    });

    it('pause() sends POST to /pause with optional reason', async () => {
        (transport.request as any).mockResolvedValue({ cron: { id: 'l1' } });
        await client.pause('ws-abc', 'l1', 'manual');
        expect(transport.request).toHaveBeenCalledWith('/workspaces/ws-abc/crons/l1/pause', {
            method: 'POST',
            body: { reason: 'manual' },
        });
    });

    it('resume() sends POST to /resume', async () => {
        (transport.request as any).mockResolvedValue({ cron: { id: 'l1' } });
        await client.resume('ws-abc', 'l1');
        expect(transport.request).toHaveBeenCalledWith('/workspaces/ws-abc/crons/l1/resume', {
            method: 'POST',
        });
    });

    it('list() returns crons array from response', async () => {
        const mockCrons = [{ id: 'l1' }, { id: 'l2' }];
        (transport.request as any).mockResolvedValue({ crons: mockCrons });
        const result = await client.list('ws-abc');
        expect(result).toEqual(mockCrons);
    });

    it('list() returns empty array when response has no crons', async () => {
        (transport.request as any).mockResolvedValue({});
        const result = await client.list('ws-abc');
        expect(result).toEqual([]);
    });

    it('encodes workspace IDs with special characters', async () => {
        await client.list('ws/special chars');
        expect(transport.request).toHaveBeenCalledWith('/workspaces/ws%2Fspecial%20chars/crons');
    });
});
