/**
 * Tests for the `deriveEffort` pure function in effortUtils.
 *
 * Covers the derivation rules from the Reasoning-Effort Picker spec §4.2 / §5.1:
 *  - Returns the preferred effort when supported by the model.
 *  - Falls back to null when preferred is absent, unsupported, or the model
 *    explicitly opts out of reasoning.
 */
import { describe, it, expect } from 'vitest';
import { deriveEffort } from '../../../../src/server/spa/client/react/utils/effortUtils';

describe('deriveEffort', () => {
    it('returns the preferred effort when supported by the model', () => {
        expect(deriveEffort('high', ['low', 'medium', 'high'], true)).toBe('high');
    });

    it('returns preferred when supported list is empty (no restriction)', () => {
        expect(deriveEffort('medium', [], true)).toBe('medium');
    });

    it('returns preferred when supported list is undefined (unknown model)', () => {
        expect(deriveEffort('high', undefined, true)).toBe('high');
    });

    it('returns null when preferred is undefined', () => {
        expect(deriveEffort(undefined, ['low', 'medium', 'high'], true)).toBeNull();
    });

    it('returns null when preferred is not in the supported list (AC-3)', () => {
        // e.g. preference is 'xhigh' but model only supports low/medium/high
        expect(deriveEffort('xhigh', ['low', 'medium', 'high'], true)).toBeNull();
    });

    it('returns null when capabilitySupportsReasoning is false (disabled model)', () => {
        expect(deriveEffort('high', ['low', 'medium', 'high'], false)).toBeNull();
    });

    it('returns null when preferred is undefined and capabilitySupportsReasoning is false', () => {
        expect(deriveEffort(undefined, undefined, false)).toBeNull();
    });

    it('returns xhigh when supported and in list (AC-1)', () => {
        expect(deriveEffort('xhigh', ['low', 'medium', 'high', 'xhigh'], true)).toBe('xhigh');
    });

    it('returns null when supported list is non-empty and preferred not present', () => {
        expect(deriveEffort('high', ['low', 'medium'], true)).toBeNull();
    });

    it('returns preferred when supported list has one matching item', () => {
        expect(deriveEffort('low', ['low'], true)).toBe('low');
    });

    it('returns null when supported list has items but preferred does not match any', () => {
        expect(deriveEffort('high', ['low'], true)).toBeNull();
    });

    it('casts the result to EffortLevel — low', () => {
        const result = deriveEffort('low', undefined, true);
        expect(result).toBe('low');
    });

    it('casts the result to EffortLevel — medium', () => {
        const result = deriveEffort('medium', undefined, true);
        expect(result).toBe('medium');
    });
});
