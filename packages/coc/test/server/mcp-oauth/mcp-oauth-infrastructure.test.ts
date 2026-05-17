/**
 * Tests for createMcpOauthInfrastructure.
 */

import { describe, it, expect } from 'vitest';
import { createMcpOauthInfrastructure } from '../../../src/server/mcp-oauth/mcp-oauth-infrastructure';

describe('createMcpOauthInfrastructure', () => {
    it('returns a manager and a working dispose hook', () => {
        const infra = createMcpOauthInfrastructure();
        expect(infra.manager).toBeDefined();
        infra.manager.addPending({ requestId: '1', serverName: 's', serverUrl: 'u' });
        expect(infra.manager.listPending().length).toBe(1);
        infra.dispose();
        expect(infra.manager.listPending().length).toBe(0);
    });

    it('passes ttlMs and now overrides through to the manager', () => {
        let now = 0;
        const infra = createMcpOauthInfrastructure({ ttlMs: 500, now: () => now });
        infra.manager.addPending({ requestId: '1', serverName: 's', serverUrl: 'u' });
        now = 2_000;
        expect(infra.manager.listPending()).toEqual([]);
    });
});
