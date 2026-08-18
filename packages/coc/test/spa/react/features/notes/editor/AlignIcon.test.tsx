/**
 * Tests for the alignment dropdown's drawn icons.
 *
 * The icon is the whole control's affordance — it is what the user reads in the
 * trigger and in every menu row — so the geometry is asserted directly: the
 * short rows have to actually sit left/centre/right, and justify has to have no
 * short rows at all. Getting that wrong renders four glyphs that look alike.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { AlignIcon } from '../../../../../../src/server/spa/client/react/features/notes/editor/toolbar/AlignIcon';
import { ALIGN_OPTIONS } from '../../../../../../src/server/spa/client/react/features/notes/editor/toolbar/formattingCommands';

afterEach(cleanup);

/** The `[x, width]` of every row, in document order. */
function bars(value: 'left' | 'center' | 'right' | 'justify') {
    render(<AlignIcon value={value} />);
    const svg = screen.getByTestId(`align-icon-${value}`);
    return Array.from(svg.querySelectorAll('rect')).map((rect) => [
        Number(rect.getAttribute('x')),
        Number(rect.getAttribute('width')),
    ] as [number, number]);
}

describe('AlignIcon', () => {
    it('draws an icon for every alignment the dropdown offers', () => {
        for (const option of ALIGN_OPTIONS) {
            render(<AlignIcon value={option.value} />);
            expect(screen.getByTestId(`align-icon-${option.value}`)).toBeDefined();
            cleanup();
        }
    });

    it('draws four rows per alignment', () => {
        for (const value of ['left', 'center', 'right', 'justify'] as const) {
            expect(bars(value)).toHaveLength(4);
            cleanup();
        }
    });

    it('left-aligns its short rows with the long ones', () => {
        const rows = bars('left');
        const [long, short] = [rows[0], rows[1]];
        expect(short[1]).toBeLessThan(long[1]);
        expect(short[0]).toBe(long[0]);
    });

    it('centres its short rows inside the long ones', () => {
        const rows = bars('center');
        const [long, short] = [rows[0], rows[1]];
        expect(short[1]).toBeLessThan(long[1]);
        // Equal slack on both sides is what makes the icon read as centred.
        const leftGap = short[0] - long[0];
        const rightGap = long[0] + long[1] - (short[0] + short[1]);
        expect(leftGap).toBeCloseTo(rightGap, 5);
        expect(leftGap).toBeGreaterThan(0);
    });

    it('right-aligns its short rows with the long ones', () => {
        const rows = bars('right');
        const [long, short] = [rows[0], rows[1]];
        expect(short[1]).toBeLessThan(long[1]);
        expect(short[0] + short[1]).toBe(long[0] + long[1]);
    });

    it('runs every justify row the full width', () => {
        const rows = bars('justify');
        for (const row of rows) {
            expect(row).toEqual(rows[0]);
        }
        // ...and wider than the short rows of the other three.
        cleanup();
        expect(rows[0][1]).toBeGreaterThan(bars('left')[1][1]);
    });

    it('stacks the rows top to bottom without overlapping', () => {
        render(<AlignIcon value="left" />);
        const ys = Array.from(screen.getByTestId('align-icon-left').querySelectorAll('rect'))
            .map((rect) => Number(rect.getAttribute('y')));
        const height = 1.5;
        for (let i = 1; i < ys.length; i++) {
            expect(ys[i]).toBeGreaterThanOrEqual(ys[i - 1] + height);
        }
    });

    it('inherits its color and hides itself from the accessibility tree', () => {
        render(<AlignIcon value="left" />);
        const svg = screen.getByTestId('align-icon-left');
        expect(svg.getAttribute('fill')).toBe('currentColor');
        expect(svg.getAttribute('aria-hidden')).toBe('true');
        expect(svg.getAttribute('focusable')).toBe('false');
    });

    it('passes extra classes through to the svg', () => {
        render(<AlignIcon value="right" className="opacity-50" />);
        expect(screen.getByTestId('align-icon-right').getAttribute('class')).toContain('opacity-50');
    });
});
