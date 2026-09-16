import { describe, expect, it } from 'vitest';
import { getDefaultSkillsToInstall } from '../../src/server/skills/default-skill-selection';

describe('getDefaultSkillsToInstall', () => {
    const defaults = ['delegate', 'cron', 'canvas', 'rethink'];

    it('keeps feature-backed defaults when their features are enabled', () => {
        expect(getDefaultSkillsToInstall(defaults, {
            cronEnabled: true,
            canvasEnabled: true,
        })).toEqual(defaults);
    });

    it('excludes each feature-backed default independently when disabled', () => {
        expect(getDefaultSkillsToInstall(defaults, {
            cronEnabled: false,
            canvasEnabled: true,
        })).toEqual(['delegate', 'canvas', 'rethink']);
        expect(getDefaultSkillsToInstall(defaults, {
            cronEnabled: true,
            canvasEnabled: false,
        })).toEqual(['delegate', 'cron', 'rethink']);
    });

    it('excludes both gated defaults when both features are disabled', () => {
        expect(getDefaultSkillsToInstall(defaults, {
            cronEnabled: false,
            canvasEnabled: false,
        })).toEqual(['delegate', 'rethink']);
    });
});
