/**
 * Tests for McpOauthManager (in-memory store of pending OAuth requests).
 */

import { describe, it, expect } from 'vitest';
import { McpOauthManager, DEFAULT_MCP_OAUTH_TTL_MS } from '../../../src/server/mcp-oauth/mcp-oauth-manager';

describe('McpOauthManager', () => {
    it('uses requestId as stable id when supplied', () => {
        const mgr = new McpOauthManager();
        const entry = mgr.addPending({
            requestId: 'req-1',
            serverName: 'github',
            serverUrl: 'https://example.com/mcp',
        });
        expect(entry.id).toBe('req-1');
        expect(entry.status).toBe('pending');
        expect(mgr.getPending('req-1')).toEqual(entry);
    });

    it('generates a uuid when requestId is missing', () => {
        const mgr = new McpOauthManager();
        const entry = mgr.addPending({ serverName: 'a', serverUrl: 'b' });
        expect(entry.id).toMatch(/[0-9a-f-]{8,}/);
    });

    it('preserves createdAt across re-registration but updates updatedAt', () => {
        let now = 1_000;
        const mgr = new McpOauthManager({ now: () => now });
        const first = mgr.addPending({ requestId: 'r', serverName: 's', serverUrl: 'u' });
        expect(first.createdAt).toBe(1_000);
        now = 2_500;
        const second = mgr.addPending({
            requestId: 'r',
            serverName: 's',
            serverUrl: 'u',
            authorizationUrl: 'https://login',
            processId: 'proc-1',
            workspaceId: 'ws-1',
        });
        expect(second.createdAt).toBe(1_000);
        expect(second.updatedAt).toBe(2_500);
        expect(second.authorizationUrl).toBe('https://login');
        expect(second.processId).toBe('proc-1');
        expect(second.workspaceId).toBe('ws-1');
    });

    it('filters listPending by status / processId / workspaceId', () => {
        const mgr = new McpOauthManager();
        mgr.addPending({ requestId: 'a', serverName: 's', serverUrl: 'u', processId: 'p1', workspaceId: 'w1' });
        mgr.addPending({ requestId: 'b', serverName: 's', serverUrl: 'u', processId: 'p2', workspaceId: 'w1' });
        mgr.resolve('b', 'completed');
        expect(mgr.listPending().length).toBe(2);
        expect(mgr.listPending({ status: 'pending' }).map(e => e.id)).toEqual(['a']);
        expect(mgr.listPending({ status: 'completed' }).map(e => e.id)).toEqual(['b']);
        expect(mgr.listPending({ processId: 'p2' }).map(e => e.id)).toEqual(['b']);
        expect(mgr.listPending({ workspaceId: 'w1' }).map(e => e.id).sort()).toEqual(['a', 'b']);
    });

    it('resolve records status and optional error', () => {
        const mgr = new McpOauthManager();
        mgr.addPending({ requestId: 'x', serverName: 's', serverUrl: 'u' });
        const ok = mgr.resolve('x', 'failed', 'denied');
        expect(ok?.status).toBe('failed');
        expect(ok?.error).toBe('denied');
        expect(mgr.resolve('missing', 'completed')).toBeUndefined();
    });

    it('remove returns false when entry is missing', () => {
        const mgr = new McpOauthManager();
        expect(mgr.remove('nope')).toBe(false);
        mgr.addPending({ requestId: 'k', serverName: 's', serverUrl: 'u' });
        expect(mgr.remove('k')).toBe(true);
        expect(mgr.getPending('k')).toBeUndefined();
    });

    it('sweepExpired drops entries older than ttl', () => {
        let now = 0;
        const mgr = new McpOauthManager({ ttlMs: 1_000, now: () => now });
        mgr.addPending({ requestId: 'old', serverName: 's', serverUrl: 'u' });
        now = 5_000;
        mgr.addPending({ requestId: 'new', serverName: 's', serverUrl: 'u' });
        expect(mgr.listPending().map(e => e.id)).toEqual(['new']);
    });

    it('clear empties the store', () => {
        const mgr = new McpOauthManager();
        mgr.addPending({ requestId: '1', serverName: 's', serverUrl: 'u' });
        mgr.addPending({ requestId: '2', serverName: 's', serverUrl: 'u' });
        mgr.clear();
        expect(mgr.listPending()).toEqual([]);
    });

    it('exports DEFAULT_MCP_OAUTH_TTL_MS at 10 minutes', () => {
        expect(DEFAULT_MCP_OAUTH_TTL_MS).toBe(10 * 60 * 1000);
    });

    it('stores originalMessage and originalTurnIndex', () => {
        const mgr = new McpOauthManager();
        const entry = mgr.addPending({
            requestId: 'r1',
            serverName: 'srv',
            serverUrl: 'u',
            originalMessage: 'What is the weather?',
            originalTurnIndex: 3,
        });
        expect(entry.originalMessage).toBe('What is the weather?');
        expect(entry.originalTurnIndex).toBe(3);
    });

    it('preserves originalMessage on re-registration', () => {
        const mgr = new McpOauthManager();
        mgr.addPending({
            requestId: 'r1',
            serverName: 'srv',
            serverUrl: 'u',
            originalMessage: 'hello',
            originalTurnIndex: 1,
        });
        const refreshed = mgr.addPending({
            requestId: 'r1',
            serverName: 'srv',
            serverUrl: 'u',
        });
        expect(refreshed.originalMessage).toBe('hello');
        expect(refreshed.originalTurnIndex).toBe(1);
    });
});
