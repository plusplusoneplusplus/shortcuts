/**
 * Tests for LoopsClient — verifies API path construction and method delegation.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LoopsClient } from '@plusplusoneplusplus/coc-client';
import type { RequestAdapter } from '@plusplusoneplusplus/coc-client';

describe('LoopsClient', () => {
    let transport: RequestAdapter;
    let client: LoopsClient;

    beforeEach(() => {
        transport = {
            request: vi.fn().mockResolvedValue({ loops: [] }),
        } as any;
        client = new LoopsClient(transport);
    });

    it('list() calls correct workspace-scoped path', async () => {
        await client.list('ws-abc');
        expect(transport.request).toHaveBeenCalledWith('/workspaces/ws-abc/loops');
    });

    it('listAll() calls server-wide /loops path', async () => {
        await client.listAll();
        expect(transport.request).toHaveBeenCalledWith('/loops');
    });

    it('get() calls correct loop path', async () => {
        (transport.request as any).mockResolvedValue({ loop: { id: 'l1' } });
        await client.get('ws-abc', 'l1');
        expect(transport.request).toHaveBeenCalledWith('/workspaces/ws-abc/loops/l1');
    });

    it('patch() sends PATCH with body', async () => {
        (transport.request as any).mockResolvedValue({ loop: { id: 'l1' } });
        await client.patch('ws-abc', 'l1', { description: 'updated' });
        expect(transport.request).toHaveBeenCalledWith('/workspaces/ws-abc/loops/l1', {
            method: 'PATCH',
            body: { description: 'updated' },
        });
    });

    it('delete() sends DELETE', async () => {
        (transport.request as any).mockResolvedValue({ deleted: true, loop: { id: 'l1' } });
        await client.delete('ws-abc', 'l1');
        expect(transport.request).toHaveBeenCalledWith('/workspaces/ws-abc/loops/l1', {
            method: 'DELETE',
        });
    });

    it('pause() sends POST to /pause with optional reason', async () => {
        (transport.request as any).mockResolvedValue({ loop: { id: 'l1' } });
        await client.pause('ws-abc', 'l1', 'manual');
        expect(transport.request).toHaveBeenCalledWith('/workspaces/ws-abc/loops/l1/pause', {
            method: 'POST',
            body: { reason: 'manual' },
        });
    });

    it('resume() sends POST to /resume', async () => {
        (transport.request as any).mockResolvedValue({ loop: { id: 'l1' } });
        await client.resume('ws-abc', 'l1');
        expect(transport.request).toHaveBeenCalledWith('/workspaces/ws-abc/loops/l1/resume', {
            method: 'POST',
        });
    });

    it('list() returns loops array from response', async () => {
        const mockLoops = [{ id: 'l1' }, { id: 'l2' }];
        (transport.request as any).mockResolvedValue({ loops: mockLoops });
        const result = await client.list('ws-abc');
        expect(result).toEqual(mockLoops);
    });

    it('list() returns empty array when response has no loops', async () => {
        (transport.request as any).mockResolvedValue({});
        const result = await client.list('ws-abc');
        expect(result).toEqual([]);
    });

    it('encodes workspace IDs with special characters', async () => {
        await client.list('ws/special chars');
        expect(transport.request).toHaveBeenCalledWith('/workspaces/ws%2Fspecial%20chars/loops');
    });
});
