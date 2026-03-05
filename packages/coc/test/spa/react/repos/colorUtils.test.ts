/**
 * Unit tests for resolveAutoColor utility.
 */
import { describe, it, expect } from 'vitest';
import { resolveAutoColor } from '../../../../src/server/spa/client/react/repos/colorUtils';

const PALETTE = [
    { label: 'Blue', value: '#0078d4' },
    { label: 'Green', value: '#107c10' },
    { label: 'Orange', value: '#d83b01' },
    { label: 'Purple', value: '#b4009e' },
    { label: 'Teal', value: '#008272' },
];

describe('resolveAutoColor', () => {
    it('returns the first palette color when no repos exist', () => {
        expect(resolveAutoColor([], PALETTE)).toBe('#0078d4');
    });

    it('returns an unused color when some are used', () => {
        const used = ['#0078d4', '#107c10'];
        const result = resolveAutoColor(used, PALETTE);
        expect(result).toBe('#d83b01');
    });

    it('returns the least-used color when all are taken', () => {
        // Blue used 3x, Green 1x, rest 1x → Green tied at 1 with others but Green is first tie
        const used = ['#0078d4', '#0078d4', '#0078d4', '#107c10', '#d83b01', '#b4009e', '#008272'];
        const result = resolveAutoColor(used, PALETTE);
        // Green, Orange, Purple, Teal all have count 1; Blue has 3.
        // Least-used is any of the count-1 colors; by palette order the first is Green.
        expect(result).toBe('#107c10');
    });

    it('tie-breaks by palette order (first palette entry wins)', () => {
        // All colors unused → should pick the first
        expect(resolveAutoColor([], PALETTE)).toBe(PALETTE[0].value);
    });

    it('ignores colors not in the palette', () => {
        const used = ['#unknown', '#ffffff'];
        expect(resolveAutoColor(used, PALETTE)).toBe('#0078d4');
    });

    it('handles a single-entry palette', () => {
        const singlePalette = [{ label: 'Blue', value: '#0078d4' }];
        expect(resolveAutoColor(['#0078d4', '#0078d4'], singlePalette)).toBe('#0078d4');
    });

    it('returns empty string for an empty palette', () => {
        expect(resolveAutoColor(['#0078d4'], [])).toBe('');
    });

    it('picks the color with fewest uses when counts differ', () => {
        // Orange used 0 times, others used once
        const used = ['#0078d4', '#107c10', '#b4009e', '#008272'];
        expect(resolveAutoColor(used, PALETTE)).toBe('#d83b01');
    });
});
