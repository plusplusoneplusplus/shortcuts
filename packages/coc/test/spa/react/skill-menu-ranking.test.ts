/**
 * Unit tests for the skill menu ranking helper.
 */

import { describe, it, expect } from 'vitest';
import { rankSkillsByRecency, MRU_SKILL_LIMIT } from '../../../src/server/spa/client/react/features/git/skill-menu-ranking';

describe('rankSkillsByRecency', () => {
    it('returns skills sorted by most-recent timestamp first', () => {
        const skills = [
            { name: 'alpha' },
            { name: 'beta' },
            { name: 'gamma' },
        ];
        const usageMap = {
            gamma: '2026-05-10T10:00:00.000Z',
            alpha: '2026-05-12T10:00:00.000Z',
            beta: '2026-05-11T10:00:00.000Z',
        };
        const result = rankSkillsByRecency(skills, usageMap);
        expect(result.map(s => s.name)).toEqual(['alpha', 'beta', 'gamma']);
    });

    it('puts timestamped skills before untimestamped ones', () => {
        const skills = [
            { name: 'unused-b' },
            { name: 'used' },
            { name: 'unused-a' },
        ];
        const usageMap = {
            used: '2026-05-10T10:00:00.000Z',
        };
        const result = rankSkillsByRecency(skills, usageMap);
        expect(result.map(s => s.name)).toEqual(['used', 'unused-a', 'unused-b']);
    });

    it('sorts untimestamped skills alphabetically case-insensitively', () => {
        const skills = [
            { name: 'Zeta' },
            { name: 'alpha' },
            { name: 'Beta' },
        ];
        const result = rankSkillsByRecency(skills, {});
        expect(result.map(s => s.name)).toEqual(['alpha', 'Beta', 'Zeta']);
    });

    it('handles empty skills array', () => {
        expect(rankSkillsByRecency([], {})).toEqual([]);
    });

    it('handles empty usage map — all skills alpha-sorted', () => {
        const skills = [
            { name: 'impl' },
            { name: 'draft' },
            { name: 'code-review' },
        ];
        const result = rankSkillsByRecency(skills, {});
        expect(result.map(s => s.name)).toEqual(['code-review', 'draft', 'impl']);
    });

    it('ignores stale usage entries for uninstalled skills', () => {
        const skills = [{ name: 'alpha' }, { name: 'beta' }];
        const usageMap = {
            removed: '2026-05-15T10:00:00.000Z',
            alpha: '2026-05-10T10:00:00.000Z',
        };
        const result = rankSkillsByRecency(skills, usageMap);
        expect(result.map(s => s.name)).toEqual(['alpha', 'beta']);
    });

    it('correctly tie-breaks mixed used/unused with many skills', () => {
        const skills = Array.from({ length: 8 }, (_, i) => ({ name: `skill-${String.fromCharCode(104 - i)}` }));
        // skill-h, skill-g, skill-f, skill-e, skill-d, skill-c, skill-b, skill-a
        const usageMap = {
            'skill-c': '2026-05-15T10:00:00.000Z',
            'skill-f': '2026-05-14T10:00:00.000Z',
            'skill-a': '2026-05-13T10:00:00.000Z',
        };
        const result = rankSkillsByRecency(skills, usageMap);
        // Used first (desc by timestamp): c, f, a
        // Then unused (alpha): b, d, e, g, h
        expect(result.map(s => s.name)).toEqual([
            'skill-c', 'skill-f', 'skill-a',
            'skill-b', 'skill-d', 'skill-e', 'skill-g', 'skill-h',
        ]);
    });
});

describe('MRU_SKILL_LIMIT', () => {
    it('is 5', () => {
        expect(MRU_SKILL_LIMIT).toBe(5);
    });
});
