/**
 * Read-Only System Message Constants Tests
 *
 * Verifies the READ_ONLY_SYSTEM_MESSAGE and READ_ONLY_MARKER constants
 * exported from the copilot-sdk-wrapper types module.
 */

import { describe, it, expect } from 'vitest';
import { READ_ONLY_SYSTEM_MESSAGE, READ_ONLY_MARKER } from '../src/copilot-sdk-wrapper/types';

describe('READ_ONLY_MARKER', () => {
    it('should be a non-empty string', () => {
        expect(typeof READ_ONLY_MARKER).toBe('string');
        expect(READ_ONLY_MARKER.length).toBeGreaterThan(0);
    });

    it('should be an HTML comment for reliable detection', () => {
        expect(READ_ONLY_MARKER).toMatch(/^<!--.*-->$/);
    });
});

describe('READ_ONLY_SYSTEM_MESSAGE', () => {
    it('should contain the marker for reliable filtering', () => {
        expect(READ_ONLY_SYSTEM_MESSAGE).toContain(READ_ONLY_MARKER);
    });

    it('should instruct read-only behavior', () => {
        expect(READ_ONLY_SYSTEM_MESSAGE).toContain('read-only mode');
        expect(READ_ONLY_SYSTEM_MESSAGE).toContain('MUST NOT');
    });

    it('should mention specific prohibited tools', () => {
        expect(READ_ONLY_SYSTEM_MESSAGE).toContain('edit_file');
        expect(READ_ONLY_SYSTEM_MESSAGE).toContain('create_file');
        expect(READ_ONLY_SYSTEM_MESSAGE).toContain('delete_file');
    });

    it('should allow the plan file exception', () => {
        expect(READ_ONLY_SYSTEM_MESSAGE).toContain('plan file');
    });

    it('should suggest switching modes', () => {
        expect(READ_ONLY_SYSTEM_MESSAGE).toContain('autopilot');
        expect(READ_ONLY_SYSTEM_MESSAGE).toContain('plan mode');
    });
});
