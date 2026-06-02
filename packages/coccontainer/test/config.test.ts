/**
 * Tests for config module.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resolveConfig, getDefaultDataDir } from '../src/config';
import * as path from 'path';
import * as os from 'os';

vi.mock('fs', async (importOriginal) => {
    const actual = await importOriginal<typeof import('fs')>();
    return {
        ...actual,
        existsSync: (p: string) => {
            if (String(p).includes('config.yaml')) return false;
            return actual.existsSync(p);
        },
    };
});

describe('config', () => {
    it('should return defaults when no overrides', () => {
        const config = resolveConfig();
        expect(config.serve.port).toBe(5000);
        expect(config.serve.host).toBe('127.0.0.1');
        expect(config.healthCheckIntervalMs).toBe(30_000);
    });

    it('should apply overrides', () => {
        const config = resolveConfig({
            serve: { port: 6000, host: '0.0.0.0' },
            healthCheckIntervalMs: 10_000,
        });
        expect(config.serve.port).toBe(6000);
        expect(config.serve.host).toBe('0.0.0.0');
        expect(config.healthCheckIntervalMs).toBe(10_000);
    });

    it('should have default data dir in home', () => {
        const dir = getDefaultDataDir();
        expect(dir).toBe(path.join(os.homedir(), '.coccontainer'));
    });

    it('should default whatsapp to disabled', () => {
        const config = resolveConfig();
        expect(config.messaging.whatsapp.enabled).toBe(false);
        expect(config.messaging.whatsapp.userName).toBe('CoC');
        expect(config.messaging.whatsapp.sessionDir).toContain('whatsapp-session');
    });

    it('should apply whatsapp overrides', () => {
        const config = resolveConfig({
            messaging: {
                whatsapp: {
                    enabled: true,
                    groupJid: 'test-group@g.us',
                    defaultAgentId: 'agent-123',
                },
            },
        });
        expect(config.messaging.whatsapp.enabled).toBe(true);
        expect(config.messaging.whatsapp.groupJid).toBe('test-group@g.us');
        expect(config.messaging.whatsapp.defaultAgentId).toBe('agent-123');
        expect(config.messaging.whatsapp.userName).toBe('CoC');
    });

    it('should default teams to disabled', () => {
        const config = resolveConfig();
        expect(config.messaging.teams.enabled).toBe(false);
        expect(config.messaging.teams.botName).toBe('CoC');
        expect(config.messaging.teams.pollIntervalMs).toBe(3000);
        expect(config.messaging.teams.mcpServerUrl).toContain('agent365.svc.cloud.microsoft');
    });

    it('should apply teams overrides', () => {
        const config = resolveConfig({
            messaging: {
                teams: {
                    enabled: true,
                    mcpServerUrl: 'https://test.mcp/server',
                    channelId: 'ch-123',
                    botName: 'MyBot',
                    pollIntervalMs: 5000,
                    defaultAgentId: 'agent-456',
                },
            },
        });
        expect(config.messaging.teams.enabled).toBe(true);
        expect(config.messaging.teams.mcpServerUrl).toBe('https://test.mcp/server');
        expect(config.messaging.teams.channelId).toBe('ch-123');
        expect(config.messaging.teams.botName).toBe('MyBot');
        expect(config.messaging.teams.pollIntervalMs).toBe(5000);
        expect(config.messaging.teams.defaultAgentId).toBe('agent-456');
    });
});
