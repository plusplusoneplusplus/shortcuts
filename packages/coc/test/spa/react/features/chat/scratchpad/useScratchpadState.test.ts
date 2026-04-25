import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useScratchpadState } from '../../../../../../src/server/spa/client/react/features/chat/scratchpad/useScratchpadState';

function createContainerRef(clientHeight = 800): React.RefObject<HTMLElement> {
    return { current: { clientHeight } as HTMLElement };
}

describe('useScratchpadState', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    // --- Initial state ---

    it('returns default topHeightPct of 60 when localStorage is empty', () => {
        const { result } = renderHook(() => useScratchpadState(createContainerRef()));
        expect(result.current.topHeightPct).toBe(60);
        expect(result.current.isOpen).toBe(false);
        expect(result.current.expandMode).toBe('split');
        expect(result.current.linkedNotePath).toBeNull();
        expect(result.current.isDragging).toBe(false);
        expect(result.current.knownFiles).toEqual([]);
    });

    it('loads topHeightPct from localStorage and clamps to [15, 85]', () => {
        localStorage.setItem('coc.scratchpad.topHeightPct', '70');
        const { result } = renderHook(() => useScratchpadState(createContainerRef()));
        expect(result.current.topHeightPct).toBe(70);
    });

    it('clamps stored value below MIN_PCT to 15', () => {
        localStorage.setItem('coc.scratchpad.topHeightPct', '5');
        const { result } = renderHook(() => useScratchpadState(createContainerRef()));
        expect(result.current.topHeightPct).toBe(15);
    });

    it('clamps stored value above MAX_PCT to 85', () => {
        localStorage.setItem('coc.scratchpad.topHeightPct', '95');
        const { result } = renderHook(() => useScratchpadState(createContainerRef()));
        expect(result.current.topHeightPct).toBe(85);
    });

    it('falls back to 60 when localStorage has invalid value', () => {
        localStorage.setItem('coc.scratchpad.topHeightPct', 'not-a-number');
        const { result } = renderHook(() => useScratchpadState(createContainerRef()));
        expect(result.current.topHeightPct).toBe(60);
    });

    // --- open / close ---

    it('open() sets isOpen to true without changing topHeightPct', () => {
        localStorage.setItem('coc.scratchpad.topHeightPct', '70');
        const { result } = renderHook(() => useScratchpadState(createContainerRef()));
        expect(result.current.topHeightPct).toBe(70);

        act(() => { result.current.open(); });
        expect(result.current.isOpen).toBe(true);
        expect(result.current.topHeightPct).toBe(70);
    });

    it('open("path/to/note.md") also sets linkedNotePath', () => {
        const { result } = renderHook(() => useScratchpadState(createContainerRef()));
        act(() => { result.current.open('path/to/note.md'); });
        expect(result.current.isOpen).toBe(true);
        expect(result.current.linkedNotePath).toBe('path/to/note.md');
    });

    it('open("path/to/note.md") adds the path to knownFiles', () => {
        const { result } = renderHook(() => useScratchpadState(createContainerRef()));
        act(() => { result.current.open('path/to/note.md'); });
        expect(result.current.knownFiles).toEqual(['path/to/note.md']);
    });

    it('opening the same path twice does not add a duplicate to knownFiles', () => {
        const { result } = renderHook(() => useScratchpadState(createContainerRef()));
        act(() => { result.current.open('note.md'); });
        act(() => { result.current.open('note.md'); });
        expect(result.current.knownFiles).toEqual(['note.md']);
    });

    it('calling open() a second time does NOT reset expandMode to split', () => {
        const { result } = renderHook(() => useScratchpadState(createContainerRef()));

        // First open — resets expandMode to 'split'
        act(() => { result.current.open(); });
        expect(result.current.expandMode).toBe('split');

        // Change expand mode
        act(() => { result.current.setExpandMode('top'); });
        expect(result.current.expandMode).toBe('top');

        // Second open — should NOT reset expandMode
        act(() => { result.current.open(); });
        expect(result.current.expandMode).toBe('top');
    });

    it('close() sets isOpen to false', () => {
        const { result } = renderHook(() => useScratchpadState(createContainerRef()));
        act(() => { result.current.open(); });
        expect(result.current.isOpen).toBe(true);

        act(() => { result.current.close(); });
        expect(result.current.isOpen).toBe(false);
    });

    // --- setExpandMode ---

    it('setExpandMode("top") sets topHeightPct to 85 and expandMode to top', () => {
        const { result } = renderHook(() => useScratchpadState(createContainerRef()));
        act(() => { result.current.setExpandMode('top'); });
        expect(result.current.topHeightPct).toBe(85);
        expect(result.current.expandMode).toBe('top');
    });

    it('setExpandMode("bottom") sets topHeightPct to 15 and expandMode to bottom', () => {
        const { result } = renderHook(() => useScratchpadState(createContainerRef()));
        act(() => { result.current.setExpandMode('bottom'); });
        expect(result.current.topHeightPct).toBe(15);
        expect(result.current.expandMode).toBe('bottom');
    });

    it('setExpandMode("split") sets topHeightPct to 50 and expandMode to split', () => {
        const { result } = renderHook(() => useScratchpadState(createContainerRef()));
        act(() => { result.current.setExpandMode('split'); });
        expect(result.current.topHeightPct).toBe(50);
        expect(result.current.expandMode).toBe('split');
    });

    // --- setTopHeightPct clamping ---

    it('setTopHeightPct(10) clamps to 15', () => {
        const { result } = renderHook(() => useScratchpadState(createContainerRef()));
        act(() => { result.current.setTopHeightPct(10); });
        expect(result.current.topHeightPct).toBe(15);
    });

    it('setTopHeightPct(90) clamps to 85', () => {
        const { result } = renderHook(() => useScratchpadState(createContainerRef()));
        act(() => { result.current.setTopHeightPct(90); });
        expect(result.current.topHeightPct).toBe(85);
    });

    // --- Drag mechanism ---

    it('handleDividerMouseDown + simulated mousemove updates topHeightPct', () => {
        const containerRef = createContainerRef(1000);
        const { result } = renderHook(() => useScratchpadState(containerRef));

        // Start drag at clientY=600
        act(() => {
            result.current.handleDividerMouseDown({
                preventDefault: vi.fn(),
                clientY: 600,
            } as unknown as React.MouseEvent);
        });
        expect(result.current.isDragging).toBe(true);

        // Move mouse to clientY=700 (+100px = +10% of 1000px container)
        act(() => {
            document.dispatchEvent(new MouseEvent('mousemove', { clientY: 700 }));
        });

        // Default 60% + 10% delta = 70%
        expect(result.current.topHeightPct).toBe(70);
    });

    it('drag clamps topHeightPct to min/max bounds', () => {
        const containerRef = createContainerRef(1000);
        const { result } = renderHook(() => useScratchpadState(containerRef));

        act(() => {
            result.current.handleDividerMouseDown({
                preventDefault: vi.fn(),
                clientY: 600,
            } as unknown as React.MouseEvent);
        });

        // Move far down — would exceed 85%
        act(() => {
            document.dispatchEvent(new MouseEvent('mousemove', { clientY: 1500 }));
        });
        expect(result.current.topHeightPct).toBe(85);

        // Move far up — would go below 15%
        act(() => {
            document.dispatchEvent(new MouseEvent('mousemove', { clientY: -500 }));
        });
        expect(result.current.topHeightPct).toBe(15);
    });

    it('mouseup ends dragging and resets expandMode to split', () => {
        const containerRef = createContainerRef(1000);
        const { result } = renderHook(() => useScratchpadState(containerRef));

        act(() => { result.current.setExpandMode('top'); });
        expect(result.current.expandMode).toBe('top');

        act(() => {
            result.current.handleDividerMouseDown({
                preventDefault: vi.fn(),
                clientY: 600,
            } as unknown as React.MouseEvent);
        });

        act(() => {
            document.dispatchEvent(new MouseEvent('mouseup'));
        });

        expect(result.current.isDragging).toBe(false);
        expect(result.current.expandMode).toBe('split');
    });

    // --- localStorage persistence ---

    it('persists topHeightPct to localStorage when drag ends', () => {
        const containerRef = createContainerRef(1000);
        const { result } = renderHook(() => useScratchpadState(containerRef));

        act(() => {
            result.current.handleDividerMouseDown({
                preventDefault: vi.fn(),
                clientY: 600,
            } as unknown as React.MouseEvent);
        });

        act(() => {
            document.dispatchEvent(new MouseEvent('mousemove', { clientY: 700 }));
        });

        act(() => {
            document.dispatchEvent(new MouseEvent('mouseup'));
        });

        expect(localStorage.getItem('coc.scratchpad.topHeightPct')).toBe('70');
    });

    // --- setLinkedNotePath ---

    it('setLinkedNotePath updates linkedNotePath', () => {
        const { result } = renderHook(() => useScratchpadState(createContainerRef()));
        act(() => { result.current.setLinkedNotePath('new/note.md'); });
        expect(result.current.linkedNotePath).toBe('new/note.md');
    });

    it('setLinkedNotePath(null) clears linkedNotePath', () => {
        const { result } = renderHook(() => useScratchpadState(createContainerRef()));
        act(() => { result.current.setLinkedNotePath('note.md'); });
        act(() => { result.current.setLinkedNotePath(null); });
        expect(result.current.linkedNotePath).toBeNull();
    });

    // --- Drag with zero-height container ---

    it('ignores mousemove when container height is zero', () => {
        const containerRef = createContainerRef(0);
        const { result } = renderHook(() => useScratchpadState(containerRef));

        act(() => {
            result.current.handleDividerMouseDown({
                preventDefault: vi.fn(),
                clientY: 100,
            } as unknown as React.MouseEvent);
        });

        act(() => {
            document.dispatchEvent(new MouseEvent('mousemove', { clientY: 300 }));
        });

        // topHeightPct should remain at default since container height is 0
        expect(result.current.topHeightPct).toBe(60);
    });

    // --- Event listener cleanup ---

    it('cleans up event listeners when unmounted during drag', () => {
        const removeEventListenerSpy = vi.spyOn(document, 'removeEventListener');
        const containerRef = createContainerRef(800);
        const { result, unmount } = renderHook(() => useScratchpadState(containerRef));

        act(() => {
            result.current.handleDividerMouseDown({
                preventDefault: vi.fn(),
                clientY: 400,
            } as unknown as React.MouseEvent);
        });

        unmount();

        const removedEvents = removeEventListenerSpy.mock.calls.map(c => c[0]);
        expect(removedEvents).toContain('mousemove');
        expect(removedEvents).toContain('mouseup');

        removeEventListenerSpy.mockRestore();
    });

    // --- registerFiles ---

    it('registerFiles adds new paths to knownFiles', () => {
        const { result } = renderHook(() => useScratchpadState(createContainerRef()));
        act(() => { result.current.registerFiles(['a.md', 'b.md']); });
        expect(result.current.knownFiles).toEqual(['a.md', 'b.md']);
    });

    it('registerFiles does not add duplicate paths', () => {
        const { result } = renderHook(() => useScratchpadState(createContainerRef()));
        act(() => { result.current.registerFiles(['a.md', 'b.md']); });
        act(() => { result.current.registerFiles(['b.md', 'c.md']); });
        expect(result.current.knownFiles).toEqual(['a.md', 'b.md', 'c.md']);
    });

    it('registerFiles deduplicates case-insensitively', () => {
        const { result } = renderHook(() => useScratchpadState(createContainerRef()));
        act(() => { result.current.registerFiles(['Tasks/Note.md']); });
        act(() => { result.current.registerFiles(['tasks/note.md']); });
        expect(result.current.knownFiles).toHaveLength(1);
    });

    it('registerFiles preserves insertion order', () => {
        const { result } = renderHook(() => useScratchpadState(createContainerRef()));
        act(() => { result.current.registerFiles(['c.md', 'a.md', 'b.md']); });
        expect(result.current.knownFiles).toEqual(['c.md', 'a.md', 'b.md']);
    });

    it('registerFiles does not change linkedNotePath', () => {
        const { result } = renderHook(() => useScratchpadState(createContainerRef()));
        act(() => { result.current.open('active.md'); });
        act(() => { result.current.registerFiles(['other.md']); });
        expect(result.current.linkedNotePath).toBe('active.md');
    });

    it('open() and registerFiles() merge correctly without duplicates', () => {
        const { result } = renderHook(() => useScratchpadState(createContainerRef()));
        act(() => { result.current.open('first.md'); });
        act(() => { result.current.registerFiles(['first.md', 'second.md']); });
        expect(result.current.knownFiles).toEqual(['first.md', 'second.md']);
    });

    it('registerFiles with empty array is a no-op', () => {
        const { result } = renderHook(() => useScratchpadState(createContainerRef()));
        act(() => { result.current.registerFiles([]); });
        expect(result.current.knownFiles).toEqual([]);
    });

    // --- Layout support ---

    it('defaults layout to horizontal when not specified', () => {
        const { result } = renderHook(() => useScratchpadState(createContainerRef()));
        expect(result.current.layout).toBe('horizontal');
    });

    it('returns vertical layout when specified', () => {
        const { result } = renderHook(() => useScratchpadState(createContainerRef(), 'vertical'));
        expect(result.current.layout).toBe('vertical');
    });

    it('uses separate localStorage key for vertical layout', () => {
        localStorage.setItem('coc.scratchpad.leftWidthPct', '40');
        localStorage.setItem('coc.scratchpad.topHeightPct', '70');
        const { result } = renderHook(() => useScratchpadState(createContainerRef(), 'vertical'));
        expect(result.current.topHeightPct).toBe(40);
    });

    it('uses horizontal localStorage key for horizontal layout', () => {
        localStorage.setItem('coc.scratchpad.topHeightPct', '70');
        localStorage.setItem('coc.scratchpad.leftWidthPct', '40');
        const { result } = renderHook(() => useScratchpadState(createContainerRef(), 'horizontal'));
        expect(result.current.topHeightPct).toBe(70);
    });

    // --- Vertical layout: MIN_PCT_VERTICAL = 5 ---

    it('clamps stored value below MIN_PCT_VERTICAL to 5 in vertical layout', () => {
        localStorage.setItem('coc.scratchpad.leftWidthPct', '3');
        const { result } = renderHook(() => useScratchpadState(createContainerRef(), 'vertical'));
        expect(result.current.topHeightPct).toBe(5);
    });

    it('setTopHeightPct(3) clamps to 5 in vertical layout', () => {
        const { result } = renderHook(() => useScratchpadState(createContainerRef(), 'vertical'));
        act(() => { result.current.setTopHeightPct(3); });
        expect(result.current.topHeightPct).toBe(5);
    });

    it('setTopHeightPct(10) stays at 10 in vertical layout (above MIN_PCT_VERTICAL=5)', () => {
        const { result } = renderHook(() => useScratchpadState(createContainerRef(), 'vertical'));
        act(() => { result.current.setTopHeightPct(10); });
        expect(result.current.topHeightPct).toBe(10);
    });

    it('setTopHeightPct(10) clamps to MIN_PCT_HORIZONTAL=15 in horizontal layout', () => {
        const { result } = renderHook(() => useScratchpadState(createContainerRef(), 'horizontal'));
        act(() => { result.current.setTopHeightPct(10); });
        expect(result.current.topHeightPct).toBe(15);
    });

    it('setExpandMode("bottom") sets topHeightPct to 5 in vertical layout', () => {
        const { result } = renderHook(() => useScratchpadState(createContainerRef(), 'vertical'));
        act(() => { result.current.setExpandMode('bottom'); });
        expect(result.current.topHeightPct).toBe(5);
        expect(result.current.expandMode).toBe('bottom');
    });

    it('setExpandMode("bottom") still sets topHeightPct to 15 in horizontal layout', () => {
        const { result } = renderHook(() => useScratchpadState(createContainerRef(), 'horizontal'));
        act(() => { result.current.setExpandMode('bottom'); });
        expect(result.current.topHeightPct).toBe(15);
        expect(result.current.expandMode).toBe('bottom');
    });

    it('vertical drag clamps to MIN_PCT_VERTICAL=5 at lower bound', () => {
        const containerRef = { current: { clientWidth: 1000, clientHeight: 800 } as HTMLElement };
        const { result } = renderHook(() => useScratchpadState(containerRef, 'vertical'));

        act(() => {
            result.current.handleDividerMouseDown({
                preventDefault: vi.fn(),
                clientX: 600,
                clientY: 0,
            } as unknown as React.MouseEvent);
        });

        // Move far left — would go well below 5%
        act(() => {
            document.dispatchEvent(new MouseEvent('mousemove', { clientX: -500, clientY: 0 }));
        });
        expect(result.current.topHeightPct).toBe(5);
    });

    it('vertical drag uses clientX instead of clientY', () => {
        const containerRef = { current: { clientWidth: 1000, clientHeight: 800 } as HTMLElement };
        const { result } = renderHook(() => useScratchpadState(containerRef, 'vertical'));

        // Start drag at clientX=600
        act(() => {
            result.current.handleDividerMouseDown({
                preventDefault: vi.fn(),
                clientX: 600,
                clientY: 0,
            } as unknown as React.MouseEvent);
        });
        expect(result.current.isDragging).toBe(true);

        // Move mouse to clientX=700 (+100px = +10% of 1000px container width)
        act(() => {
            document.dispatchEvent(new MouseEvent('mousemove', { clientX: 700, clientY: 0 }));
        });

        // Default 60% + 10% delta = 70%
        expect(result.current.topHeightPct).toBe(70);
    });

    it('vertical drag persists to leftWidthPct localStorage key', () => {
        const containerRef = { current: { clientWidth: 1000, clientHeight: 800 } as HTMLElement };
        const { result } = renderHook(() => useScratchpadState(containerRef, 'vertical'));

        act(() => {
            result.current.handleDividerMouseDown({
                preventDefault: vi.fn(),
                clientX: 600,
                clientY: 0,
            } as unknown as React.MouseEvent);
        });

        act(() => {
            document.dispatchEvent(new MouseEvent('mousemove', { clientX: 700, clientY: 0 }));
        });

        act(() => {
            document.dispatchEvent(new MouseEvent('mouseup'));
        });

        expect(localStorage.getItem('coc.scratchpad.leftWidthPct')).toBe('70');
        expect(localStorage.getItem('coc.scratchpad.topHeightPct')).toBeNull();
    });
});
