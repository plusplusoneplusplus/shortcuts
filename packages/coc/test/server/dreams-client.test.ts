import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DreamsClient } from '@plusplusoneplusplus/coc-client';
import type { RequestAdapter } from '@plusplusoneplusplus/coc-client';

describe('DreamsClient', () => {
    let transport: RequestAdapter;
    let client: DreamsClient;

    beforeEach(() => {
        transport = {
            request: vi.fn().mockResolvedValue({ cards: [] }),
        };
        client = new DreamsClient(transport);
    });

    it('lists cards with workspace-scoped path and optional filters', async () => {
        await client.listCards('ws/with spaces', {
            includeHidden: true,
            statuses: ['visible', 'approved'],
        });

        expect(transport.request).toHaveBeenCalledWith('/workspaces/ws%2Fwith%20spaces/dreams/cards', {
            query: {
                includeHidden: true,
                status: ['visible', 'approved'],
            },
        });
    });

    it('reads a card detail', async () => {
        (transport.request as any).mockResolvedValue({ card: { id: 'dream-1' } });

        await client.getCard('ws-1', 'dream-1');

        expect(transport.request).toHaveBeenCalledWith('/workspaces/ws-1/dreams/cards/dream-1');
    });

    it('enqueues a manual dream pass', async () => {
        (transport.request as any).mockResolvedValue({ task: { id: 'task-1', type: 'dream-run' } });

        await client.runNow('ws-1', {
            provider: 'claude',
            config: { model: 'claude-sonnet-4.6', reasoningEffort: 'high' },
            confidenceThreshold: 0.9,
        });

        expect(transport.request).toHaveBeenCalledWith('/workspaces/ws-1/dreams/run', {
            method: 'POST',
            body: {
                provider: 'claude',
                config: { model: 'claude-sonnet-4.6', reasoningEffort: 'high' },
                confidenceThreshold: 0.9,
            },
        });
    });

    it('sends lifecycle requests to card action endpoints', async () => {
        (transport.request as any).mockResolvedValue({ card: { id: 'dream-1' } });

        await client.approve('ws-1', 'dream-1');
        await client.dismiss('ws-1', 'dream-1', { dedupRationale: 'duplicate' });
        await client.convert('ws-1', 'dream-1', { artifactType: 'work-item', artifactId: 'WI-1' });
        await client.markSuperseded('ws-1', 'dream-1', { supersededByCardId: 'dream-2', dedupRationale: 'duplicate' });

        expect(transport.request).toHaveBeenNthCalledWith(1, '/workspaces/ws-1/dreams/cards/dream-1/approve', {
            method: 'POST',
        });
        expect(transport.request).toHaveBeenNthCalledWith(2, '/workspaces/ws-1/dreams/cards/dream-1/dismiss', {
            method: 'POST',
            body: { dedupRationale: 'duplicate' },
        });
        expect(transport.request).toHaveBeenNthCalledWith(3, '/workspaces/ws-1/dreams/cards/dream-1/convert', {
            method: 'POST',
            body: { artifactType: 'work-item', artifactId: 'WI-1' },
        });
        expect(transport.request).toHaveBeenNthCalledWith(4, '/workspaces/ws-1/dreams/cards/dream-1/supersede', {
            method: 'POST',
            body: { supersededByCardId: 'dream-2', dedupRationale: 'duplicate' },
        });
    });
});
