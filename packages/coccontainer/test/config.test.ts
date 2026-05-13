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
});
