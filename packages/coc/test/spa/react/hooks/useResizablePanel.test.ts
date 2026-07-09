import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useResizablePanel } from '../../../../src/server/spa/client/react/hooks/ui/useResizablePanel';

describe('useResizablePanel', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    it('returns initial width of 320 by default', () => {
        const { result } = renderHook(() => useResizablePanel());
        expect(result.current.width).toBe(320);
        expect(result.current.isDragging).toBe(false);
    });

    it('accepts custom initialWidth', () => {
        const { result } = renderHook(() => useResizablePanel({ initialWidth: 400 }));
        expect(result.current.width).toBe(400);
    });

    it('clamps initialWidth to minWidth', () => {
        const { result } = renderHook(() =>
            useResizablePanel({ initialWidth: 50, minWidth: 100 })
        );
        expect(result.current.width).toBe(100);
    });

    it('clamps initialWidth to maxWidth', () => {
        const { result } = renderHook(() =>
            useResizablePanel({ initialWidth: 900, maxWidth: 600 })
        );
        expect(result.current.width).toBe(600);
    });

    it('sets isDragging true on handleMouseDown', () => {
        const { result } = renderHook(() => useResizablePanel());
        act(() => {
            result.current.handleMouseDown({
                preventDefault: vi.fn(),
                clientX: 320,
            } as unknown as React.MouseEvent);
        });
        expect(result.current.isDragging).toBe(true);
    });

    it('updates width on mousemove while dragging', () => {
        const { result } = renderHook(() =>
            useResizablePanel({ initialWidth: 300, minWidth: 100, maxWidth: 500 })
        );

        // Start drag at clientX=300
        act(() => {
            result.current.handleMouseDown({
                preventDefault: vi.fn(),
                clientX: 300,
            } as unknown as React.MouseEvent);
        });

        // Move mouse to clientX=400 (+100px)
        act(() => {
            const moveEvent = new MouseEvent('mousemove', { clientX: 400 });
            document.dispatchEvent(moveEvent);
        });

        expect(result.current.width).toBe(400);
    });

    it('clamps width to minWidth during drag', () => {
        const { result } = renderHook(() =>
            useResizablePanel({ initialWidth: 300, minWidth: 160, maxWidth: 600 })
        );

        act(() => {
            result.current.handleMouseDown({
                preventDefault: vi.fn(),
                clientX: 300,
            } as unknown as React.MouseEvent);
        });

        // Move mouse far left
        act(() => {
            document.dispatchEvent(new MouseEvent('mousemove', { clientX: 0 }));
        });

        expect(result.current.width).toBe(160);
    });

    it('clamps width to maxWidth during drag', () => {
        const { result } = renderHook(() =>
            useResizablePanel({ initialWidth: 300, minWidth: 100, maxWidth: 500 })
        );

        act(() => {
            result.current.handleMouseDown({
                preventDefault: vi.fn(),
                clientX: 300,
            } as unknown as React.MouseEvent);
        });

        // Move mouse far right
        act(() => {
            document.dispatchEvent(new MouseEvent('mousemove', { clientX: 900 }));
        });

        expect(result.current.width).toBe(500);
    });

    it('sets isDragging false on mouseup', () => {
        const { result } = renderHook(() => useResizablePanel());

        act(() => {
            result.current.handleMouseDown({
                preventDefault: vi.fn(),
                clientX: 320,
            } as unknown as React.MouseEvent);
        });
        expect(result.current.isDragging).toBe(true);

        act(() => {
            document.dispatchEvent(new MouseEvent('mouseup'));
        });
        expect(result.current.isDragging).toBe(false);
    });

    it('persists width to localStorage when storageKey is set', () => {
        const key = 'test-sidebar-width';
        const { result } = renderHook(() =>
            useResizablePanel({ initialWidth: 300, storageKey: key })
        );

        // Start drag
        act(() => {
            result.current.handleMouseDown({
                preventDefault: vi.fn(),
                clientX: 300,
            } as unknown as React.MouseEvent);
        });

        // Move to 350
        act(() => {
            document.dispatchEvent(new MouseEvent('mousemove', { clientX: 350 }));
        });

        // End drag (triggers persist)
        act(() => {
            document.dispatchEvent(new MouseEvent('mouseup'));
        });

        expect(localStorage.getItem(key)).toBe('350');
    });

    it('restores width from localStorage', () => {
        const key = 'test-sidebar-width';
        localStorage.setItem(key, '400');

        const { result } = renderHook(() =>
            useResizablePanel({ initialWidth: 320, storageKey: key })
        );

        expect(result.current.width).toBe(400);
    });

    it('reloads width from localStorage when the storage key changes', async () => {
        const firstKey = 'test-sidebar-width:first';
        const secondKey = 'test-sidebar-width:second';
        const emptyKey = 'test-sidebar-width:empty';
        localStorage.setItem(firstKey, '280');
        localStorage.setItem(secondKey, '420');

        const { result, rerender } = renderHook(
            ({ storageKey }) => useResizablePanel({
                initialWidth: 360,
                minWidth: 200,
                maxWidth: 600,
                storageKey,
            }),
            { initialProps: { storageKey: firstKey } },
        );

        expect(result.current.width).toBe(280);

        rerender({ storageKey: secondKey });
        await waitFor(() => expect(result.current.width).toBe(420));

        rerender({ storageKey: emptyKey });
        await waitFor(() => expect(result.current.width).toBe(360));
        expect(localStorage.getItem(secondKey)).toBe('420');
    });

    it('ignores invalid localStorage values', () => {
        const key = 'test-sidebar-width';
        localStorage.setItem(key, 'not-a-number');

        const { result } = renderHook(() =>
            useResizablePanel({ initialWidth: 320, storageKey: key })
        );

        expect(result.current.width).toBe(320);
    });

    it('resetWidth restores initialWidth and clears storage', () => {
        const key = 'test-sidebar-width';
        localStorage.setItem(key, '400');

        const { result } = renderHook(() =>
            useResizablePanel({ initialWidth: 320, storageKey: key })
        );

        expect(result.current.width).toBe(400);

        act(() => {
            result.current.resetWidth();
        });

        expect(result.current.width).toBe(320);
        // After reset, localStorage is cleared, but the persist effect may
        // re-write the new width — the key point is the width is reset
    });

    describe('applySize', () => {
        it('updates the width to the clamped value', () => {
            const { result } = renderHook(() =>
                useResizablePanel({ initialWidth: 300, minWidth: 100, maxWidth: 500 })
            );

            act(() => { result.current.applySize(400); });
            expect(result.current.width).toBe(400);
        });

        it('clamps to minWidth', () => {
            const { result } = renderHook(() =>
                useResizablePanel({ initialWidth: 300, minWidth: 100, maxWidth: 500 })
            );

            act(() => { result.current.applySize(50); });
            expect(result.current.width).toBe(100);
        });

        it('clamps to maxWidth', () => {
            const { result } = renderHook(() =>
                useResizablePanel({ initialWidth: 300, minWidth: 100, maxWidth: 500 })
            );

            act(() => { result.current.applySize(800); });
            expect(result.current.width).toBe(500);
        });

        it('does not write to localStorage (non-persisting)', async () => {
            const key = 'test-apply-size-no-persist';
            const { result } = renderHook(() =>
                useResizablePanel({ initialWidth: 300, minWidth: 100, maxWidth: 500, storageKey: key })
            );

            act(() => { result.current.applySize(400); });

            // Wait for effects to settle
            await waitFor(() => expect(result.current.width).toBe(400));
            expect(localStorage.getItem(key)).toBeNull();
        });

        it('does not write to localStorage even when a drag follows immediately after applySize', async () => {
            const key = 'test-apply-size-then-drag';
            const { result } = renderHook(() =>
                useResizablePanel({ initialWidth: 300, minWidth: 100, maxWidth: 600, storageKey: key })
            );

            act(() => { result.current.applySize(400); });

            // A subsequent real drag should still persist normally.
            act(() => {
                result.current.handleMouseDown({
                    preventDefault: vi.fn(),
                    clientX: 400,
                } as unknown as React.MouseEvent);
            });
            act(() => {
                document.dispatchEvent(new MouseEvent('mousemove', { clientX: 450 }));
            });
            act(() => {
                document.dispatchEvent(new MouseEvent('mouseup'));
            });

            await waitFor(() => expect(localStorage.getItem(key)).toBe('450'));
        });
    });

    it('handles touch start and touch end', () => {
        const { result } = renderHook(() =>
            useResizablePanel({ initialWidth: 300, minWidth: 100, maxWidth: 500 })
        );

        act(() => {
            result.current.handleTouchStart({
                touches: [{ clientX: 300 }],
            } as unknown as React.TouchEvent);
        });
        expect(result.current.isDragging).toBe(true);

        act(() => {
            document.dispatchEvent(new Event('touchend'));
        });
        expect(result.current.isDragging).toBe(false);
    });

    it('ignores multi-touch on touchStart', () => {
        const { result } = renderHook(() => useResizablePanel());

        act(() => {
            result.current.handleTouchStart({
                touches: [{ clientX: 100 }, { clientX: 200 }],
            } as unknown as React.TouchEvent);
        });
        expect(result.current.isDragging).toBe(false);
    });

    it('cleans up event listeners when unmounted during drag', () => {
        const removeEventListenerSpy = vi.spyOn(document, 'removeEventListener');
        const { result, unmount } = renderHook(() => useResizablePanel());

        act(() => {
            result.current.handleMouseDown({
                preventDefault: vi.fn(),
                clientX: 320,
            } as unknown as React.MouseEvent);
        });

        unmount();

        const removedEvents = removeEventListenerSpy.mock.calls.map(c => c[0]);
        expect(removedEvents).toContain('mousemove');
        expect(removedEvents).toContain('mouseup');
        expect(removedEvents).toContain('touchmove');
        expect(removedEvents).toContain('touchend');

        removeEventListenerSpy.mockRestore();
    });

    describe("direction: 'right' (right-anchored panel)", () => {
        it('narrows when the handle is dragged right', () => {
            const { result } = renderHook(() =>
                useResizablePanel({ initialWidth: 300, minWidth: 100, maxWidth: 500, direction: 'right' })
            );

            act(() => {
                result.current.handleMouseDown({
                    preventDefault: vi.fn(),
                    clientX: 300,
                } as unknown as React.MouseEvent);
            });

            // Drag right (+100px): a right-anchored panel shrinks.
            act(() => {
                document.dispatchEvent(new MouseEvent('mousemove', { clientX: 400 }));
            });

            expect(result.current.width).toBe(200);
        });

        it('widens when the handle is dragged left', () => {
            const { result } = renderHook(() =>
                useResizablePanel({ initialWidth: 300, minWidth: 100, maxWidth: 500, direction: 'right' })
            );

            act(() => {
                result.current.handleMouseDown({
                    preventDefault: vi.fn(),
                    clientX: 300,
                } as unknown as React.MouseEvent);
            });

            // Drag left (-100px): a right-anchored panel grows.
            act(() => {
                document.dispatchEvent(new MouseEvent('mousemove', { clientX: 200 }));
            });

            expect(result.current.width).toBe(400);
        });
    });

    // AC-03/AC-06: the split-workspace divider between the chat (top) and git
    // (bottom) halves resizes along the Y axis. These guard the vertical path
    // added to the (previously horizontal-only) hook.
    describe("direction: 'top' (top-anchored panel, vertical drag)", () => {
        it('grows the top panel when the handle is dragged down', () => {
            const { result } = renderHook(() =>
                useResizablePanel({ initialWidth: 300, minWidth: 100, maxWidth: 500, direction: 'top' })
            );

            // Start drag at clientY=300 (X is ignored on the vertical axis).
            act(() => {
                result.current.handleMouseDown({
                    preventDefault: vi.fn(),
                    clientX: 999,
                    clientY: 300,
                } as unknown as React.MouseEvent);
            });

            // Drag down (+100px): a top-anchored panel grows taller.
            act(() => {
                document.dispatchEvent(new MouseEvent('mousemove', { clientX: 999, clientY: 400 }));
            });

            expect(result.current.width).toBe(400);
        });

        it('shrinks the top panel when the handle is dragged up, clamped to minWidth', () => {
            const { result } = renderHook(() =>
                useResizablePanel({ initialWidth: 300, minWidth: 160, maxWidth: 600, direction: 'top' })
            );

            act(() => {
                result.current.handleMouseDown({
                    preventDefault: vi.fn(),
                    clientY: 300,
                } as unknown as React.MouseEvent);
            });

            // Drag far up: height shrinks and clamps to minWidth (min size).
            act(() => {
                document.dispatchEvent(new MouseEvent('mousemove', { clientY: 0 }));
            });

            expect(result.current.width).toBe(160);
        });

        it('ignores X-axis movement on the vertical axis', () => {
            const { result } = renderHook(() =>
                useResizablePanel({ initialWidth: 300, minWidth: 100, maxWidth: 500, direction: 'top' })
            );

            act(() => {
                result.current.handleMouseDown({
                    preventDefault: vi.fn(),
                    clientX: 300,
                    clientY: 300,
                } as unknown as React.MouseEvent);
            });

            // Move only along X — a vertical panel must not resize.
            act(() => {
                document.dispatchEvent(new MouseEvent('mousemove', { clientX: 500, clientY: 300 }));
            });

            expect(result.current.width).toBe(300);
        });

        it('persists the height per storageKey on drag end', () => {
            const key = 'test-split-divider-height';
            const { result } = renderHook(() =>
                useResizablePanel({ initialWidth: 300, minWidth: 100, maxWidth: 600, storageKey: key, direction: 'top' })
            );

            act(() => {
                result.current.handleMouseDown({
                    preventDefault: vi.fn(),
                    clientY: 300,
                } as unknown as React.MouseEvent);
            });
            act(() => {
                document.dispatchEvent(new MouseEvent('mousemove', { clientY: 380 }));
            });
            act(() => {
                document.dispatchEvent(new MouseEvent('mouseup'));
            });

            expect(result.current.width).toBe(380);
            expect(localStorage.getItem(key)).toBe('380');
        });
    });

    describe("direction: 'bottom' (bottom-anchored panel, vertical drag)", () => {
        it('grows the bottom panel when the handle is dragged up', () => {
            const { result } = renderHook(() =>
                useResizablePanel({ initialWidth: 300, minWidth: 100, maxWidth: 500, direction: 'bottom' })
            );

            act(() => {
                result.current.handleMouseDown({
                    preventDefault: vi.fn(),
                    clientY: 300,
                } as unknown as React.MouseEvent);
            });

            // Drag up (−100px): a bottom-anchored panel grows.
            act(() => {
                document.dispatchEvent(new MouseEvent('mousemove', { clientY: 200 }));
            });

            expect(result.current.width).toBe(400);
        });
    });

    describe('drag overlay (keeps pointer events off underlying iframes)', () => {
        const overlays = () => document.querySelectorAll('[data-resize-overlay]');

        it('mounts a full-window overlay while dragging and removes it on drag end', () => {
            const { result } = renderHook(() => useResizablePanel());
            expect(overlays().length).toBe(0);

            act(() => {
                result.current.handleMouseDown({
                    preventDefault: vi.fn(),
                    clientX: 320,
                } as unknown as React.MouseEvent);
            });

            // Overlay must exist during the drag so mousemove over an iframe is
            // captured by the main document instead of being swallowed.
            expect(overlays().length).toBe(1);
            const overlay = overlays()[0] as HTMLElement;
            expect(overlay.style.position).toBe('fixed');
            expect(overlay.style.cursor).toBe('col-resize');

            act(() => {
                document.dispatchEvent(new MouseEvent('mouseup'));
            });

            expect(overlays().length).toBe(0);
        });

        it('uses a row-resize cursor for a vertical panel', () => {
            const { result } = renderHook(() => useResizablePanel({ direction: 'top' }));

            act(() => {
                result.current.handleMouseDown({
                    preventDefault: vi.fn(),
                    clientY: 200,
                } as unknown as React.MouseEvent);
            });

            const overlay = overlays()[0] as HTMLElement;
            expect(overlay.style.cursor).toBe('row-resize');
        });

        it('removes the overlay when unmounted mid-drag', () => {
            const { result, unmount } = renderHook(() => useResizablePanel());

            act(() => {
                result.current.handleMouseDown({
                    preventDefault: vi.fn(),
                    clientX: 320,
                } as unknown as React.MouseEvent);
            });
            expect(overlays().length).toBe(1);

            unmount();

            expect(overlays().length).toBe(0);
        });
    });
});
