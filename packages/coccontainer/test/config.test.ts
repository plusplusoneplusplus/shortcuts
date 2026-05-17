/**
 * Tests for config module.
 */

import { describe, it, expect } from 'vitest';
import { resolveConfig, getDefaultDataDir } from '../src/config';
import * as path from 'path';
import * as os from 'os';

describe('config', () => {
    it('should return defaults when no overrides', () => {
        const config = resolveConfig();
        expect(config.serve.port).toBe(5000);
        expect(config.serve.host).toBe('localhost');
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

    it('should default whatsapp to enabled', () => {
        const config = resolveConfig();
        expect(config.messaging.whatsapp.enabled).toBe(true);
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
});
