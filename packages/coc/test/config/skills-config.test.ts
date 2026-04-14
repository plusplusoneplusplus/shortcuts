/**
 * Tests for skills.autoUpdate config option.
 */

import { describe, it, expect } from 'vitest';
import { resolveConfig, mergeConfig, DEFAULT_CONFIG } from '../../src/config';

describe('skills config', () => {
    it('defaults to autoUpdate: true', () => {
        const config = resolveConfig(undefined, undefined);
        expect(config.skills.autoUpdate).toBe(true);
    });

    it('can be disabled via override', () => {
        const config = mergeConfig(DEFAULT_CONFIG, { skills: { autoUpdate: false } });
        expect(config.skills.autoUpdate).toBe(false);
    });

    it('preserves autoUpdate: true when explicitly set', () => {
        const config = mergeConfig(DEFAULT_CONFIG, { skills: { autoUpdate: true } });
        expect(config.skills.autoUpdate).toBe(true);
    });
});
