// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { selectionPillPosition } from '../../../../../src/server/spa/client/react/shared/monaco/MonacoSelectionAttachPill';

const layout = { width: 500, height: 300, contentLeft: 40, contentWidth: 450 };
const size = { width: 150, height: 0 };
const at = (top: number, left = 120) => ({ top, left, height: 18 });

describe('selectionPillPosition', () => {
    it('keeps the default placement below a fully visible end, hiding otherwise (diff editors)', () => {
        expect(selectionPillPosition(null, at(60), layout, size, false)).toEqual({ left: 120, top: 80, maxWidth: 452 });
        for (const end of [null, at(-5), at(262), at(900), at(60, -1), at(60, 491)]) {
            expect(selectionPillPosition(at(0), end, layout, size, false)).toBeNull();
        }
    });

    it('flips above an end line with no room below and pins to the bottom when the end is off-screen', () => {
        expect(selectionPillPosition(at(0), at(60), layout, size, true)).toEqual({ left: 120, top: 80, maxWidth: 452 });
        expect(selectionPillPosition(at(0), at(262), layout, size, true)?.top).toBe(232);
        expect(selectionPillPosition(at(-500), at(900), layout, size, true)?.top).toBe(268);
        expect(selectionPillPosition(at(290), at(295), layout, size, true)?.top).toBe(268);
        // A long line clamps to the visible width instead of hiding.
        expect(selectionPillPosition(at(0), at(60, 2000), layout, size, true)?.left).toBe(342);
    });

    it('hides when no selected line is on screen', () => {
        expect(selectionPillPosition(at(-500), at(-30), layout, size, true)).toBeNull();
        expect(selectionPillPosition(at(310), at(400), layout, size, true)).toBeNull();
        expect(selectionPillPosition(at(0), null, layout, size, true)).toBeNull();
    });
});
