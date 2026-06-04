/**
 * Tests for createMcpOauthInfrastructure.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createMcpOauthInfrastructure } from '../../../src/server/mcp-oauth/mcp-oauth-infrastructure';

describe('createMcpOauthInfrastructure', () => {
    it('returns a manager and a working dispose hook', () => {
        const infra = createMcpOauthInfrastructure();
        expect(infra.manager).toBeDefined();
        expect(infra.refreshTimer).toBeUndefined();
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

    describe('with autoRefresh', () => {
        let tmpHome: string;

        beforeEach(() => {
            tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-infra-autoref-'));
        });

        afterEach(() => {
            try { fs.rmSync(tmpHome, { recursive: true, force: true }); } catch { /* ignore */ }
        });

        it('starts a refresh timer when autoRefresh.enabled is true', () => {
            const infra = createMcpOauthInfrastructure({
                autoRefresh: { enabled: true, homeDir: tmpHome, intervalMs: 60_000, runOnStart: false },
            });
            try {
                expect(infra.refreshTimer).toBeDefined();
                expect(typeof infra.refreshTimer!.stop).toBe('function');
                expect(typeof infra.refreshTimer!.runNow).toBe('function');
            } finally {
                infra.dispose();
            }
        });

        it('does not start a refresh timer when autoRefresh is omitted', () => {
            const infra = createMcpOauthInfrastructure();
            expect(infra.refreshTimer).toBeUndefined();
            infra.dispose();
        });

        it('does not start a refresh timer when autoRefresh.enabled is false', () => {
            const infra = createMcpOauthInfrastructure({
                autoRefresh: { enabled: false, homeDir: tmpHome },
            });
            expect(infra.refreshTimer).toBeUndefined();
            infra.dispose();
        });

        it('dispose stops the refresh timer', async () => {
            const infra = createMcpOauthInfrastructure({
                autoRefresh: { enabled: true, homeDir: tmpHome, intervalMs: 60_000, runOnStart: false },
            });
            expect(infra.refreshTimer).toBeDefined();
            infra.dispose();
            // After dispose, runNow should still work (manager + cache are pure)
            // but no new ticks should fire — covered by the timer test suite.
            const result = await infra.refreshTimer!.runNow();
            expect(result.dedup.groups).toBe(0);
        });
    });
});

