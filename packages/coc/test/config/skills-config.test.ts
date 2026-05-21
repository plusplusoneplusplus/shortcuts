/**
 * Tests for skills.autoUpdate config option.
 */

import { describe, it, expect } from 'vitest';
import { resolveConfig, mergeConfig, DEFAULT_CONFIG, DEFAULT_BUNDLED_SKILLS } from '../../src/config';

describe('skills config', () => {
    it('defaults to autoUpdate: true', () => {
        const config = resolveConfig(undefined, undefined);
        expect(config.skills.autoUpdate).toBe(true);
    });

    it('includes terse replies in default bundled skills', () => {
        const config = resolveConfig(undefined, undefined);
        expect(DEFAULT_BUNDLED_SKILLS).toContain('terse-replies');
        expect(config.skills.defaultSkills).toContain('terse-replies');
    });

    it('includes for-each and map-reduce in default bundled skills', () => {
        const config = resolveConfig(undefined, undefined);
        expect(DEFAULT_BUNDLED_SKILLS).toContain('for-each');
        expect(DEFAULT_BUNDLED_SKILLS).toContain('map-reduce');
        expect(config.skills.defaultSkills).toContain('for-each');
        expect(config.skills.defaultSkills).toContain('map-reduce');
    });

    it('includes grill-me in default bundled skills', () => {
        const config = resolveConfig(undefined, undefined);
        expect(DEFAULT_BUNDLED_SKILLS).toContain('grill-me');
        expect(config.skills.defaultSkills).toContain('grill-me');
    });

    it('includes loop in default bundled skills', () => {
        const config = resolveConfig(undefined, undefined);
        expect(DEFAULT_BUNDLED_SKILLS).toContain('loop');
        expect(config.skills.defaultSkills).toContain('loop');
    });

    it('can be disabled via override', () => {
        const config = mergeConfig(DEFAULT_CONFIG, { skills: { autoUpdate: false } });
        expect(config.skills.autoUpdate).toBe(false);
    });

    it('preserves autoUpdate: true when explicitly set', () => {
        const config = mergeConfig(DEFAULT_CONFIG, { skills: { autoUpdate: true } });
        expect(config.skills.autoUpdate).toBe(true);
    });

    it('preserves explicit default skill overrides', () => {
        const config = mergeConfig(DEFAULT_CONFIG, { skills: { defaultSkills: [] } });
        expect(config.skills.defaultSkills).toEqual([]);
    });
});
