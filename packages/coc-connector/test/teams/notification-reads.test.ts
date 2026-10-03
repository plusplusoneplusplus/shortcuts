import { describe, expect, it, vi } from 'vitest';
import { McpTransport } from '../../src/teams/mcp/transport-mcp';
import { GraphClient } from '../../src/teams/graph/graph-client';
import { McpHttpError } from '../../src/teams/mcp/mcp-client';

const hints = { rootMessageIds: [] as string[], reconcile: false };
const root = (id: string, time = '2026-01-01T00:00:01Z') => ({ id, createdDateTime: time, body: { content: 'text' } });
const result = (value: unknown) => ({ content: [{ type: 'text', text: JSON.stringify(value) }] });
function setup(tracked = Array.from({ length: 10 }, (_, i) => `tracked-${i}`)) {
    const transport = new McpTransport('https://example.test/mcp', () => true, () => tracked);
    const callTool = vi.fn(async (name: string, _args: any) => result(name === 'ListChannelMessages'
        ? { messages: [root('visible')] } : { replies: [] }));
    Object.assign(transport, { client: { callTool }, teamId: 'team', _availableTools: ['ListChannelMessageReplies'] });
    return { transport, callTool };
}

describe('notification-authoritative MCP reads', () => {
    it('reads a hinted reply thread without waiting for five-root rotation', async () => {
        const s = setup();
        s.callTool.mockImplementation(async (name, args) => result(name === 'ListChannelMessages'
            ? { messages: [root('visible')] }
            : { replies: args.messageId === 'tracked-9' ? [root('reply')] : [] }));
        const read = await s.transport.poll('channel', undefined, { ...hints, rootMessageIds: ['tracked-9'] });
        expect(s.callTool.mock.calls[0]).toEqual(['ListChannelMessageReplies',
            { teamId: 'team', channelId: 'channel', messageId: 'tracked-9', maxReplies: 50 },
            expect.any(AbortSignal)]);
        expect(s.callTool).toHaveBeenCalledOnce();
        expect(read.messages.find(msg => msg.messageId === 'reply')?.replyToMessageId).toBe('tracked-9');
    });
    it('known-root wakes read only hinted histories despite many visible and tracked roots', async () => {
        const tracked = Array.from({ length: 100 }, (_, i) => `tracked-${i}`);
        const visible = Array.from({ length: 50 }, (_, i) => root(`visible-${i}`));
        const discovered: string[] = [];
        const s = setup(tracked);
        Object.assign(s.transport, { onChannelRootDiscovered: async (message: { messageId: string }) => {
            discovered.push(message.messageId);
        } });
        s.callTool.mockImplementation(async name => result(name === 'ListChannelMessages'
            ? { messages: visible } : { replies: [] }));
        await s.transport.poll('channel', undefined, { ...hints, rootMessageIds: ['tracked-99', 'tracked-98', 'tracked-99'] });
        const replyCalls = s.callTool.mock.calls.filter(([name]) => name === 'ListChannelMessageReplies');
        expect(s.callTool).toHaveBeenCalledTimes(2);
        expect(replyCalls.map(([, args]) => args.messageId)).toEqual(['tracked-99', 'tracked-98']);
        expect(discovered).toEqual([]);
        await s.transport.poll('channel', undefined, { ...hints, reconcile: true });
        expect(discovered).toEqual(visible.map(message => message.id));
    });
    it('known-thread reads bypass slow channel scans, finish reply pagination and retain root backfill', async () => {
        const s = setup(['tracked']);
        Object.assign(s.transport, { rootPages: new Map([['channel', 'older-roots']]) });
        s.callTool.mockImplementation(async (name, args) => {
            if (name === 'ListChannelMessages') throw new Error('Channel scan must not gate a known-thread wake');
            return result(args.nextLink ? { replies: [root('reply-two', '2026-01-01T00:00:02Z')] }
                : { replies: [root('reply-one')], hasMoreResults: true, nextLink: 'next-replies' });
        });
        const read = await s.transport.poll('channel', 'previous-head', { ...hints, rootMessageIds: ['tracked'] });
        expect(read.messages.map(msg => msg.messageId)).toEqual(['reply-one', 'reply-two']);
        expect(read.nextSince).toBe('previous-head');
        expect(s.callTool).toHaveBeenCalledTimes(2);
        expect(s.callTool.mock.calls.every(([name]) => name === 'ListChannelMessageReplies')).toBe(true);
        s.transport.commitNotificationRead('channel');
        s.callTool.mockClear();
        s.callTool.mockImplementation(async name => result(name === 'ListChannelMessages'
            ? { messages: [root('visible')] } : { replies: [] }));
        await s.transport.poll('channel', undefined, { ...hints, reconcile: true });
        expect(s.callTool.mock.calls.some(([name, args]) => name === 'ListChannelMessages'
            && args.nextLink === 'older-roots')).toBe(true);
    });
    it('only treats discovered roots as known in their own channel', async () => {
        const s = setup([]);
        s.callTool.mockImplementation(async (name, args) => result(name === 'ListChannelMessages'
            ? args.nextLink ? { messages: [root('archived')] }
                : { messages: [root('visible')], hasMoreResults: true, nextLink: 'older-roots' }
            : { replies: [] }));
        await s.transport.poll('channel', undefined, { ...hints, reconcile: true });
        s.transport.commitNotificationRead('channel');
        s.callTool.mockClear();
        await s.transport.poll('channel', undefined, { ...hints, rootMessageIds: ['archived'] });
        expect(s.callTool).toHaveBeenCalledOnce();
        expect(s.callTool.mock.calls[0][0]).toBe('ListChannelMessageReplies');
        s.callTool.mockClear();
        await s.transport.poll('another-channel', undefined, { ...hints, rootMessageIds: ['archived'] });
        expect(s.callTool.mock.calls[0][0]).toBe('ListChannelMessages');
    });
    it.each([false, true])('requires both enabled thread reads and advertised reply support (enabled=%s)', async enabled => {
        const s = setup(['tracked']);
        Object.assign(s.transport, {
            pollChannelReplies: () => enabled,
            _availableTools: enabled ? [] : ['ListChannelMessageReplies'],
        });
        await s.transport.poll('channel', undefined, { ...hints, rootMessageIds: ['tracked'] });
        expect(s.callTool).toHaveBeenCalledOnce();
        expect(s.callTool.mock.calls[0][0]).toBe('ListChannelMessages');
    });
    it('targeted reply failures and cancellation do not fabricate messages or run a root scan', async () => {
        const s = setup(['tracked']);
        s.callTool.mockRejectedValueOnce(new McpHttpError(429, 'limited', 90_000));
        await expect(s.transport.poll('channel', undefined, { ...hints, rootMessageIds: ['tracked'] }))
            .rejects.toMatchObject({ status: 429, retryAfterMs: 90_000 });
        expect(s.callTool).toHaveBeenCalledOnce();
        s.callTool.mockClear();
        const controller = new AbortController();
        controller.abort();
        await expect(s.transport.poll('channel', undefined, {
            ...hints, rootMessageIds: ['tracked'], signal: controller.signal,
        })).rejects.toThrow();
        expect(s.callTool).not.toHaveBeenCalled();
    });
    it.each(['read', 'admission'])('retries the full scan after incomplete %s, even when the next hint is known', async failure => {
        const s = setup(['tracked']);
        if (failure === 'read') {
            s.callTool.mockRejectedValueOnce(new Error('Reader temporarily unavailable'));
            await expect(s.transport.poll('channel', undefined, { ...hints, reconcile: true })).rejects.toThrow();
        } else {
            await s.transport.poll('channel', undefined, { ...hints, reconcile: true });
        }
        s.callTool.mockClear();
        const retried = await s.transport.poll('channel', undefined, { ...hints, rootMessageIds: ['tracked'] });
        expect(s.callTool.mock.calls[0][0]).toBe('ListChannelMessages');
        expect(s.callTool.mock.calls.filter(([name]) => name === 'ListChannelMessageReplies')
            .map(([, args]) => args.messageId)).toEqual(['tracked', 'visible']);
        expect(retried.messages.some(msg => msg.messageId === 'visible')).toBe(true);
        s.transport.commitNotificationRead('channel');
        s.callTool.mockClear();
        await s.transport.poll('channel', undefined, { ...hints, rootMessageIds: ['tracked'] });
        expect(s.callTool).toHaveBeenCalledOnce();
        expect(s.callTool.mock.calls[0][0]).toBe('ListChannelMessageReplies');
    });
    it.each([
        { rootMessageIds: [], reconcile: true },
        { rootMessageIds: [], reconcile: false },
        { rootMessageIds: ['unknown'], reconcile: false },
    ])('fallback, missing-parent and unknown-root hints reconcile every known thread: %j', async readHints => {
        const tracked = Array.from({ length: 20 }, (_, i) => `tracked-${i}`);
        const visible = Array.from({ length: 50 }, (_, i) => root(`visible-${i}`));
        const s = setup(tracked);
        s.callTool.mockImplementation(async name => result(name === 'ListChannelMessages'
            ? { messages: visible } : { replies: [] }));
        await s.transport.poll('channel', undefined, readHints);
        const replyCalls = s.callTool.mock.calls.filter(([name]) => name === 'ListChannelMessageReplies');
        expect(replyCalls).toHaveLength(70);
        expect(s.callTool).toHaveBeenCalledTimes(71);
        expect(new Set(replyCalls.map(([, args]) => args.messageId))).toEqual(new Set([...tracked, ...visible.map(message => message.id)]));
    });
    it.each([false, true])('root head uses chronological sort rather than provider order (reversed=%s)', async reversed => {
        const s = setup([]);
        const roots = [
            root('old', '2026-01-01T00:00:00Z'),
            root('newest', '2026-01-01T00:00:02Z'),
            root('middle', '2026-01-01T00:00:01Z'),
        ];
        s.callTool.mockImplementation(async name => result(name === 'ListChannelMessages'
            ? { messages: reversed ? [...roots].reverse() : roots } : { replies: [] }));
        const page = await s.transport.listChannelRootPage('channel');
        expect(page.roots.map(message => message.messageId)).toEqual(['old', 'middle', 'newest']);
        await s.transport.poll('channel', undefined, hints);
        s.transport.commitNotificationRead('channel');
        s.callTool.mockClear();
        s.callTool.mockImplementation(async (name, args) => result(name === 'ListChannelMessages'
            ? args.nextLink ? { messages: [root('old')] }
                : { messages: [roots[1]], hasMoreResults: true, nextLink: 'old-page' }
            : { replies: [] }));
        await s.transport.poll('channel', undefined, hints);
        // Backfill is complete, so an extra page means the head incorrectly chose the older root.
        expect(s.callTool.mock.calls.filter(([name, args]) => name === 'ListChannelMessages' && args.nextLink)).toHaveLength(0);
    });
    it('reconciliation reads every bound thread, not just a rotating batch', async () => {
        const s = setup();
        await s.transport.poll('channel', undefined, { ...hints, reconcile: true });
        const readRoots = s.callTool.mock.calls.filter(([name]) => name === 'ListChannelMessageReplies').map(([, args]) => args.messageId);
        for (let i = 0; i < 10; i++) expect(readRoots).toContain(`tracked-${i}`);
    });
    it('an unknown reply root safely reconciles known threads without trusting the hint as a root binding', async () => {
        const s = setup();
        await s.transport.poll('channel', undefined, { ...hints, rootMessageIds: ['unknown-root'] });
        const readRoots = s.callTool.mock.calls.filter(([name]) => name === 'ListChannelMessageReplies').map(([, args]) => args.messageId);
        expect(readRoots).not.toContain('unknown-root');
        expect(readRoots).toContain('tracked-9');
    });
    it('reply pagination completes in the same scan with no partial admission', async () => {
        const s = setup([]);
        s.callTool.mockImplementation(async (name, args) => result(name === 'ListChannelMessages'
            ? { messages: [root('visible')] }
            : args.nextLink ? { replies: [root('reply-two')] }
                : { replies: [root('reply-one')], hasMoreResults: true, nextLink: 'reply-page' }));
        const read = await s.transport.poll('channel', undefined, hints);
        expect(read.messages.map(msg => msg.messageId)).toEqual(['visible', 'reply-one', 'reply-two']);
        expect(s.callTool.mock.calls.at(-1)?.[1]).toMatchObject({ nextLink: 'reply-page', messageId: 'visible' });
    });
    it('root pages catch up to last successful head and retain head after a failed page', async () => {
        const s = setup([]);
        await s.transport.poll('channel', undefined, hints);
        s.transport.commitNotificationRead('channel');
        s.callTool.mockImplementation(async (name, args) => {
            if (name !== 'ListChannelMessages') return result({ replies: [] });
            if (args.nextLink) throw new McpHttpError(429, 'limited', 90_000);
            return result({ messages: [root('new')], hasMoreResults: true, nextLink: 'older' });
        });
        await expect(s.transport.poll('channel', undefined, hints)).rejects.toBeInstanceOf(McpHttpError);
        s.callTool.mockImplementation(async (name, args) => result(name === 'ListChannelMessages'
            ? args.nextLink ? { messages: [root('visible')] }
                : { messages: [root('new')], hasMoreResults: true, nextLink: 'older' }
            : { replies: [] }));
        const read = await s.transport.poll('channel', undefined, hints);
        expect(read.messages.map(msg => msg.messageId)).toContain('visible');
        expect(read.messages.map(msg => msg.messageId)).toContain('new');
    });
    it('rejects repeated pagination cursors and malformed reply data', async () => {
        const s = setup([]);
        s.callTool.mockImplementation(async (name) => result(name === 'ListChannelMessages'
            ? { messages: [root('visible')] } : { replies: [], hasMoreResults: true, nextLink: 'same' }));
        await expect(s.transport.poll('channel', undefined, hints)).rejects.toThrow('pagination limit');
        s.callTool.mockImplementation(async name => result(name === 'ListChannelMessages'
            ? { messages: [root('visible')] } : { replies: {} }));
        await expect(s.transport.poll('channel', undefined, hints)).rejects.toThrow('Invalid Teams message list');
    });
    it('does not commit a read head before the owning consumer admits it', async () => {
        const s = setup([]);
        await s.transport.poll('channel', undefined, hints);
        s.transport.commitNotificationRead('channel');
        s.callTool.mockImplementation(async (name, args) => result(name === 'ListChannelMessages'
            ? args.nextLink ? { messages: [root('visible')] }
                : { messages: [root('new')], hasMoreResults: true, nextLink: 'older' }
            : { replies: [] }));
        await s.transport.poll('channel', undefined, hints);
        // Omit commit to simulate failed admission; retry still needs the older page.
        s.callTool.mockClear();
        await s.transport.poll('channel', undefined, hints);
        expect(s.callTool.mock.calls.some(([name, args]) => name === 'ListChannelMessages' && args.nextLink === 'older')).toBe(true);
    });
    it('passes cancellation through root and reply reads', async () => {
        const s = setup([]);
        const controller = new AbortController();
        s.callTool.mockImplementation(async name => {
            if (name === 'ListChannelMessageReplies') controller.abort();
            return result(name === 'ListChannelMessages' ? { messages: [root('visible')] }
                : { replies: [], hasMoreResults: true, nextLink: 'next' });
        });
        await expect(s.transport.poll('channel', undefined, { ...hints, signal: controller.signal })).rejects.toThrow();
        expect((s.callTool.mock.calls[0] as any)[2]).toBeInstanceOf(AbortSignal);
    });
    it('off retains top five and rotating five thread reads', async () => {
        const s = setup();
        await s.transport.poll('channel');
        expect(s.callTool.mock.calls[0][1].top).toBe(5);
        const readRoots = s.callTool.mock.calls.filter(([name]) => name === 'ListChannelMessageReplies').map(([, args]) => args.messageId);
        expect(readRoots).not.toContain('tracked-9');
    });
});

describe('notification-authoritative Graph pagination', () => {
    const client = () => new GraphClient({ bearerToken: 'test-reader-token', teamId: 'team', channelId: 'channel' });
    it('pages until the timestamp boundary using same-origin links', async () => {
        const fetch = vi.spyOn(globalThis, 'fetch')
            .mockResolvedValueOnce(new Response(JSON.stringify({ value: [root('new', '2026-01-01T00:01:00Z')],
                '@odata.nextLink': 'https://graph.microsoft.com/v1.0/next' })))
            .mockResolvedValueOnce(new Response(JSON.stringify({ value: [root('boundary', '2026-01-01T00:00:00Z')],
                '@odata.nextLink': 'https://graph.microsoft.com/v1.0/ignored' })));
        try {
            expect((await client().listChannelMessages({ top: 50, pageSince: '2026-01-01T00:00:00Z' })).map(msg => msg.id))
                .toEqual(['new', 'boundary']);
            expect(fetch).toHaveBeenCalledTimes(2);
        } finally { fetch.mockRestore(); }
    });
    it('does not forward reader credentials to foreign pagination origins', async () => {
        const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({
            value: [root('new')], '@odata.nextLink': 'https://example.test/steal',
        })));
        try {
            await expect(client().listChannelMessages({ pageSince: '2025-01-01T00:00:00Z' })).rejects.toThrow('invalid message');
            expect(fetch).toHaveBeenCalledOnce();
        } finally { fetch.mockRestore(); }
    });
    it('does not mistake an edited older root for a catch-up boundary', async () => {
        const fetch = vi.spyOn(globalThis, 'fetch')
            .mockResolvedValueOnce(new Response(JSON.stringify({ value: [{
                ...root('edited', '2025-01-01T00:00:00Z'), lastModifiedDateTime: '2026-01-02T00:00:00Z',
            }], '@odata.nextLink': 'https://graph.microsoft.com/v1.0/next' })))
            .mockResolvedValueOnce(new Response(JSON.stringify({ value: [root('new')] })));
        try {
            const messages = await client().listChannelMessages({ pageSince: '2026-01-01T00:00:00Z' });
            expect(messages.map(message => message.id)).toEqual(['edited', 'new']);
            expect(fetch).toHaveBeenCalledTimes(2);
        } finally { fetch.mockRestore(); }
    });
    it('surfaces safe GET throttling with Retry-After and no provider body', async () => {
        const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('private provider response', {
            status: 429, headers: { 'Retry-After': '90' },
        }));
        try {
            await expect(client().listChannelMessages()).rejects.toMatchObject({
                status: 429, retryAfterMs: 90_000, message: 'Graph API GET 429',
            });
        } finally { fetch.mockRestore(); }
    });
});
