// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useTextPaste, CLIENT_PASTE_THRESHOLD } from '../../../src/server/spa/client/react/hooks/useTextPaste';

function createMockPasteEvent(text: string): React.ClipboardEvent {
    const preventDefault = vi.fn();
    return {
        clipboardData: {
            getData: (type: string) => type === 'text/plain' ? text : '',
        },
        preventDefault,
    } as unknown as React.ClipboardEvent;
}

describe('useTextPaste', () => {
    it('returns null paste state initially', () => {
        const { result } = renderHook(() => useTextPaste());
        expect(result.current.pastedContent).toBeNull();
        expect(result.current.charCount).toBe(0);
        expect(result.current.previewLines).toEqual([]);
    });

    it('detects paste exceeding threshold', () => {
        const { result } = renderHook(() => useTextPaste());
        const largeText = 'x'.repeat(CLIENT_PASTE_THRESHOLD + 100);
        const event = createMockPasteEvent(largeText);

        act(() => {
            result.current.addFromPaste(event);
        });

        expect(result.current.pastedContent).toBe(largeText);
        expect(result.current.charCount).toBe(largeText.length);
    });

    it('calls preventDefault on large paste to keep input clean', () => {
        const { result } = renderHook(() => useTextPaste());
        const largeText = 'x'.repeat(CLIENT_PASTE_THRESHOLD + 100);
        const event = createMockPasteEvent(largeText);

        act(() => {
            result.current.addFromPaste(event);
        });

        expect(event.preventDefault).toHaveBeenCalled();
    });

    it('does not call preventDefault on small paste', () => {
        const { result } = renderHook(() => useTextPaste());
        const shortText = 'hello world';
        const event = createMockPasteEvent(shortText);

        act(() => {
            result.current.addFromPaste(event);
        });

        expect(event.preventDefault).not.toHaveBeenCalled();
    });

    it('ignores paste under threshold', () => {
        const { result } = renderHook(() => useTextPaste());
        const shortText = 'hello world';
        const event = createMockPasteEvent(shortText);

        act(() => {
            result.current.addFromPaste(event);
        });

        expect(result.current.pastedContent).toBeNull();
        expect(result.current.charCount).toBe(0);
    });

    it('provides first 3 lines as preview', () => {
        const { result } = renderHook(() => useTextPaste());
        const lines = ['line one', 'line two', 'line three', 'line four', 'line five'];
        const largeText = lines.join('\n') + '\n' + 'x'.repeat(CLIENT_PASTE_THRESHOLD);
        const event = createMockPasteEvent(largeText);

        act(() => {
            result.current.addFromPaste(event);
        });

        expect(result.current.previewLines).toHaveLength(3);
        expect(result.current.previewLines[0]).toBe('line one');
        expect(result.current.previewLines[1]).toBe('line two');
        expect(result.current.previewLines[2]).toBe('line three');
    });

    it('truncates long preview lines at 120 chars', () => {
        const { result } = renderHook(() => useTextPaste());
        const longLine = 'a'.repeat(200);
        const largeText = longLine + '\n' + 'x'.repeat(CLIENT_PASTE_THRESHOLD);
        const event = createMockPasteEvent(largeText);

        act(() => {
            result.current.addFromPaste(event);
        });

        expect(result.current.previewLines[0]).toHaveLength(121); // 120 + '…'
        expect(result.current.previewLines[0]).toMatch(/…$/);
    });

    it('clearPaste resets all state', () => {
        const { result } = renderHook(() => useTextPaste());
        const largeText = 'x'.repeat(CLIENT_PASTE_THRESHOLD + 100);
        const event = createMockPasteEvent(largeText);

        act(() => {
            result.current.addFromPaste(event);
        });
        expect(result.current.pastedContent).not.toBeNull();

        act(() => {
            result.current.clearPaste();
        });

        expect(result.current.pastedContent).toBeNull();
        expect(result.current.charCount).toBe(0);
        expect(result.current.previewLines).toEqual([]);
    });

    it('respects custom threshold', () => {
        const { result } = renderHook(() => useTextPaste(100));
        const text = 'x'.repeat(101);
        const event = createMockPasteEvent(text);

        act(() => {
            result.current.addFromPaste(event);
        });

        expect(result.current.pastedContent).toBe(text);
        expect(result.current.charCount).toBe(101);
    });

    it('respects custom preview line count', () => {
        const { result } = renderHook(() => useTextPaste(10, 2));
        const text = 'line1\nline2\nline3\nline4\n' + 'x'.repeat(20);
        const event = createMockPasteEvent(text);

        act(() => {
            result.current.addFromPaste(event);
        });

        expect(result.current.previewLines).toHaveLength(2);
    });

    it('ignores paste with no text data', () => {
        const { result } = renderHook(() => useTextPaste());
        const event = createMockPasteEvent('');

        act(() => {
            result.current.addFromPaste(event);
        });

        expect(result.current.pastedContent).toBeNull();
    });

    it('exports CLIENT_PASTE_THRESHOLD matching server threshold', () => {
        expect(CLIENT_PASTE_THRESHOLD).toBe(16384);
    });
});
