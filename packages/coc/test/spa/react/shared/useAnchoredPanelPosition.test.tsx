/**
 * Tests for useAnchoredPanelPosition — the fixed-viewport positioning used by the
 * portaled quota / notification popouts so they escape the sidebar column's
 * overflow clip and stay fully on-screen.
 */

import { useRef } from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
    useAnchoredPanelPosition,
    type AnchoredPanelPlacement,
} from '../../../../src/server/spa/client/react/shared/useAnchoredPanelPosition';

type Rect = { top: number; left: number; width: number; height: number };

function rect({ top, left, width, height }: Rect): DOMRect {
    return {
        top,
        left,
        width,
        height,
        right: left + width,
        bottom: top + height,
        x: left,
        y: top,
        toJSON: () => ({}),
    } as DOMRect;
}

/**
 * Renders the hook with trigger/panel elements whose getBoundingClientRect is
 * stubbed via callback refs (which run before layout effects, so the hook reads
 * the stubbed rects on its first pass). The computed position is surfaced on the
 * panel's data attributes.
 */
function Harness({
    placement,
    triggerRect,
    panelRect,
}: {
    placement: AnchoredPanelPlacement;
    triggerRect: DOMRect;
    panelRect: DOMRect;
}) {
    const triggerRef = useRef<HTMLDivElement | null>(null);
    const panelRef = useRef<HTMLDivElement | null>(null);
    const pos = useAnchoredPanelPosition({ open: true, placement, triggerRef, panelRef });
    return (
        <>
            <div
                ref={el => {
                    triggerRef.current = el;
                    if (el) el.getBoundingClientRect = () => triggerRect;
                }}
            />
            <div
                data-testid="panel"
                data-top={pos.top}
                data-left={pos.left}
                ref={el => {
                    panelRef.current = el;
                    if (el) el.getBoundingClientRect = () => panelRect;
                }}
            />
        </>
    );
}

function readPos() {
    const panel = screen.getByTestId('panel');
    return {
        top: Number(panel.getAttribute('data-top')),
        left: Number(panel.getAttribute('data-left')),
    };
}

describe('useAnchoredPanelPosition', () => {
    // jsdom viewport defaults: innerWidth 1024, innerHeight 768.

    it('placement "down": right-aligns to the trigger and opens below', () => {
        render(
            <Harness
                placement="down"
                triggerRect={rect({ top: 100, left: 800, width: 60, height: 30 })}
                panelRect={rect({ top: 0, left: 0, width: 340, height: 400 })}
            />,
        );
        // left = trigger.right (860) - panel.width (340) = 520; top = trigger.bottom (130) + gap (4) = 134
        expect(readPos()).toEqual({ top: 134, left: 520 });
    });

    it('placement "up": left-aligns to the trigger and opens above', () => {
        render(
            <Harness
                placement="up"
                triggerRect={rect({ top: 700, left: 20, width: 60, height: 30 })}
                panelRect={rect({ top: 0, left: 0, width: 340, height: 400 })}
            />,
        );
        // left = trigger.left (20); top = trigger.top (700) - panel.height (400) - gap (4) = 296
        expect(readPos()).toEqual({ top: 296, left: 20 });
    });

    it('clamps horizontally so a wide panel never overflows the right viewport edge', () => {
        render(
            <Harness
                placement="up"
                triggerRect={rect({ top: 700, left: 900, width: 60, height: 30 })}
                panelRect={rect({ top: 0, left: 0, width: 340, height: 400 })}
            />,
        );
        // left-align would put it at 900 (900+340=1240 > 1024-8) → clamp to 1024-340-8 = 676
        expect(readPos().left).toBe(676);
    });

    it('flips a "up" panel below the trigger when there is not enough room above', () => {
        render(
            <Harness
                placement="up"
                triggerRect={rect({ top: 10, left: 20, width: 60, height: 30 })}
                panelRect={rect({ top: 0, left: 0, width: 340, height: 400 })}
            />,
        );
        // Above would be 10-400-4 = -394 (< margin) → flip below: trigger.bottom (40) + gap (4) = 44
        expect(readPos().top).toBe(44);
    });
});
