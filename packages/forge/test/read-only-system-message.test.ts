/**
 * Read-Only System Message Constants Tests
 *
 * Verifies the READ_ONLY_SYSTEM_MESSAGE constant exported from the
 * copilot-sdk-wrapper types module.
 */

import { describe, expect, it } from 'vitest';
import { READ_ONLY_SYSTEM_MESSAGE } from '@plusplusoneplusplus/coc-agent-sdk';

describe('READ_ONLY_SYSTEM_MESSAGE', () => {
    it('should be a non-empty string', () => {
        expect(typeof READ_ONLY_SYSTEM_MESSAGE).toBe('string');
        expect(READ_ONLY_SYSTEM_MESSAGE.length).toBeGreaterThan(0);
    });

    it('should be wrapped in a coc-read-only-mode tag for reliable filtering', () => {
        expect(READ_ONLY_SYSTEM_MESSAGE).toContain('<coc-read-only-mode>');
        expect(READ_ONLY_SYSTEM_MESSAGE).toContain('</coc-read-only-mode>');
    });

    it('should instruct read-only behavior', () => {
        expect(READ_ONLY_SYSTEM_MESSAGE).toContain('read-only mode');
    });

    it('should allow the plan file exception', () => {
        expect(READ_ONLY_SYSTEM_MESSAGE).toContain('plan file');
    });

    it('should mention the attached note file exception', () => {
        expect(READ_ONLY_SYSTEM_MESSAGE).toContain('attached note file');
    });

    it('should suggest switching modes', () => {
        expect(READ_ONLY_SYSTEM_MESSAGE).toContain('autopilot');
        expect(READ_ONLY_SYSTEM_MESSAGE).toContain('plan mode');
    });
});
