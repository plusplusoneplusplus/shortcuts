/**
 * Tests for useAnchoredPanelPosition — the fixed-viewport positioning used by the
 * portaled quota / notification popouts so they escape the sidebar column's
 * overflow clip and stay fully on-screen.
 */

import { useRef } from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
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
    constrainHeight = false,
    contentHeight,
}: {
    placement: AnchoredPanelPlacement;
    triggerRect: DOMRect;
    panelRect: DOMRect;
    constrainHeight?: boolean;
    contentHeight?: number;
}) {
    const triggerRef = useRef<HTMLDivElement | null>(null);
    const panelRef = useRef<HTMLDivElement | null>(null);
    const pos = useAnchoredPanelPosition({ open: true, placement, triggerRef, panelRef, constrainHeight });
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
                data-max-height={pos.maxHeight}
                data-max-width={pos.maxWidth}
                ref={el => {
                    panelRef.current = el;
                    if (el) {
                        el.getBoundingClientRect = () => panelRect;
                        Object.defineProperty(el, 'clientHeight', { configurable: true, value: panelRect.height });
                        Object.defineProperty(el, 'scrollHeight', { configurable: true, value: contentHeight ?? panelRect.height });
                    }
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
    afterEach(() => vi.unstubAllGlobals());
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

    it('limits tall content to the space below its anchor, not the whole viewport', () => {
        render(<Harness placement="down" constrainHeight contentHeight={1000}
            triggerRect={rect({ top: 100, left: 200, width: 60, height: 30 })}
            panelRect={rect({ top: 0, left: 0, width: 208, height: 400 })} />);
        expect(readPos()).toEqual({ top: 134, left: 52 });
        expect(screen.getByTestId('panel')).toHaveAttribute('data-max-height', '626');
        expect(screen.getByTestId('panel')).toHaveAttribute('data-max-width', '1008');
    });

    it('chooses the larger space above when neither side fits', () => {
        render(<Harness placement="down" constrainHeight contentHeight={1000}
            triggerRect={rect({ top: 500, left: 200, width: 60, height: 30 })}
            panelRect={rect({ top: 0, left: 0, width: 208, height: 200 })} />);
        expect(readPos()).toEqual({ top: 8, left: 52 });
        expect(screen.getByTestId('panel')).toHaveAttribute('data-max-height', '488');
    });

    it('uses visual viewport bounds and recomputes on zoom/keyboard resize and pan', () => {
        const viewport = Object.assign(new EventTarget(), {
            offsetLeft: 30, offsetTop: 50, width: 180, height: 300,
        });
        vi.stubGlobal('visualViewport', viewport);
        const remove = vi.spyOn(viewport, 'removeEventListener');
        const { unmount } = render(<Harness placement="down" constrainHeight contentHeight={1000}
            triggerRect={rect({ top: 100, left: 100, width: 60, height: 30 })}
            panelRect={rect({ top: 0, left: 0, width: 208, height: 200 })} />);
        const panel = screen.getByTestId('panel');
        expect(readPos()).toEqual({ top: 134, left: 38 });
        expect(panel).toHaveAttribute('data-max-height', '208');
        expect(panel).toHaveAttribute('data-max-width', '164');
        act(() => {
            viewport.height = 180;
            viewport.dispatchEvent(new Event('resize'));
        });
        expect(panel).toHaveAttribute('data-max-height', '88');
        act(() => {
            viewport.offsetTop = 150;
            viewport.dispatchEvent(new Event('scroll'));
        });
        expect(readPos().top).toBe(158);
        expect(panel).toHaveAttribute('data-max-height', '164');
        unmount();
        expect(remove).toHaveBeenCalledWith('resize', expect.any(Function));
        expect(remove).toHaveBeenCalledWith('scroll', expect.any(Function));
    });
});
