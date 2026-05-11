import { describe, expect, it } from 'vitest';
import { PromptHistoryClient } from '../../src';
import { createMockAdapter } from './helpers';

describe('PromptHistoryClient', () => {
    it('issues GET /prompt-history with workspaceId and default limit', async () => {
        const adapter = createMockAdapter({ items: ['most recent', 'older'] });
        const client = new PromptHistoryClient(adapter);

        const res = await client.list({ workspaceId: 'ws-1' });

        expect(res).toEqual({ items: ['most recent', 'older'] });
        expect(adapter.calls).toEqual([
            {
                path: '/prompt-history',
                options: { query: { workspaceId: 'ws-1', limit: undefined } },
            },
        ]);
    });

    it('passes a custom limit through to the server', async () => {
        const adapter = createMockAdapter({ items: ['a', 'b', 'c'] });
        const client = new PromptHistoryClient(adapter);

        await client.list({ workspaceId: 'ws-1', limit: 25 });

        expect(adapter.calls).toEqual([
            {
                path: '/prompt-history',
                options: { query: { workspaceId: 'ws-1', limit: 25 } },
            },
        ]);
    });

    it('returns an empty items array unchanged', async () => {
        const adapter = createMockAdapter({ items: [] });
        const client = new PromptHistoryClient(adapter);
        const res = await client.list({ workspaceId: 'ws-empty' });
        expect(res).toEqual({ items: [] });
    });
});
