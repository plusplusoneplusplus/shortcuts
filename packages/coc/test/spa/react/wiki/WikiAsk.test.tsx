/**
 * Unit tests for WikiAsk component.
 * Covers SSE streaming, keyboard shortcuts, message handling, and session continuity.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { WikiAsk } from '../../../../src/server/spa/client/react/wiki/WikiAsk';

vi.mock('../../../../src/server/spa/client/react/hooks/ui/useBreakpoint', () => ({
    useBreakpoint: vi.fn(() => ({ isMobile: false, isTablet: false, isDesktop: true, breakpoint: 'desktop' })),
}));

import { useBreakpoint } from '../../../../src/server/spa/client/react/hooks/ui/useBreakpoint';

const defaultProps = { wikiId: 'wiki-1', wikiName: 'Test Wiki', currentComponentId: null };

/** Build a mock fetch that returns a minimal SSE stream ending with `done`. */
function mockStreamingFetch(chunks: string[] = [], sessionId = 's1') {
    const allChunks = [
        ...chunks,
        `data: {"type":"done","fullResponse":"Response text","sessionId":"${sessionId}"}\n\n`,
    ];
    const encoder = new TextEncoder();
    let idx = 0;
    const mockReader = {
        read: vi.fn().mockImplementation(() => {
            if (idx < allChunks.length) {
                return Promise.resolve({ done: false, value: encoder.encode(allChunks[idx++]) });
            }
            return Promise.resolve({ done: true, value: undefined });
        }),
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        body: { getReader: () => mockReader },
    }));
    return mockReader;
}

beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        body: { getReader: () => ({ read: vi.fn().mockResolvedValue({ done: true, value: undefined }) }) },
    }));
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe('WikiAsk — rendering', () => {
    it('renders a textarea and Send button', () => {
        render(<WikiAsk {...defaultProps} />);
        expect(document.getElementById('wiki-ask-textarea')).toBeTruthy();
        expect(document.getElementById('wiki-ask-widget-send')).toBeTruthy();
    });

    it('shows placeholder text in textarea', () => {
        render(<WikiAsk {...defaultProps} />);
        const textarea = document.getElementById('wiki-ask-textarea') as HTMLTextAreaElement;
        expect(textarea.placeholder).toBe('Ask a question…');
    });

    it('Send button is disabled when input is empty', () => {
        render(<WikiAsk {...defaultProps} />);
        const btn = document.getElementById('wiki-ask-widget-send') as HTMLButtonElement;
        expect(btn.disabled).toBe(true);
    });

    it('Send button is enabled when input has text', () => {
        render(<WikiAsk {...defaultProps} />);
        const textarea = document.getElementById('wiki-ask-textarea') as HTMLTextAreaElement;
        fireEvent.change(textarea, { target: { value: 'hello' } });
        const btn = document.getElementById('wiki-ask-widget-send') as HTMLButtonElement;
        expect(btn.disabled).toBe(false);
    });
});

describe('WikiAsk — keyboard shortcuts', () => {
    it('Ctrl+I toggles expanded state', () => {
        render(<WikiAsk {...defaultProps} />);
        const widget = document.getElementById('wiki-ask-widget')!;
        expect(widget.className).not.toContain('expanded');

        fireEvent.keyDown(window, { key: 'i', ctrlKey: true });
        expect(widget.className).toContain('expanded');

        fireEvent.keyDown(window, { key: 'i', ctrlKey: true });
        expect(widget.className).not.toContain('expanded');
    });

    it('Meta+I (Cmd+I) also toggles expanded state', () => {
        render(<WikiAsk {...defaultProps} />);
        const widget = document.getElementById('wiki-ask-widget')!;

        fireEvent.keyDown(window, { key: 'i', metaKey: true });
        expect(widget.className).toContain('expanded');
    });

    it('Escape collapses the panel', () => {
        render(<WikiAsk {...defaultProps} />);
        const widget = document.getElementById('wiki-ask-widget')!;

        // Expand first
        fireEvent.keyDown(window, { key: 'i', ctrlKey: true });
        expect(widget.className).toContain('expanded');

        // Collapse with Escape
        fireEvent.keyDown(window, { key: 'Escape' });
        expect(widget.className).not.toContain('expanded');
    });

    it('focusing the textarea expands the panel', () => {
        render(<WikiAsk {...defaultProps} />);
        const widget = document.getElementById('wiki-ask-widget')!;
        const textarea = document.getElementById('wiki-ask-textarea')!;

        fireEvent.focus(textarea);
        expect(widget.className).toContain('expanded');
    });

    it('removes keydown listener on unmount', () => {
        const spy = vi.spyOn(window, 'removeEventListener');
        const { unmount } = render(<WikiAsk {...defaultProps} />);
        unmount();
        expect(spy).toHaveBeenCalledWith('keydown', expect.any(Function));
    });
});

describe('WikiAsk — message handling', () => {
    it('appends user message immediately on Send button click', async () => {
        mockStreamingFetch();
        render(<WikiAsk {...defaultProps} />);
        const textarea = document.getElementById('wiki-ask-textarea') as HTMLTextAreaElement;
        fireEvent.change(textarea, { target: { value: 'What is the auth module?' } });
        fireEvent.click(document.getElementById('wiki-ask-widget-send')!);

        await waitFor(() => {
            expect(screen.getByText('What is the auth module?')).toBeTruthy();
        });
    });

    it('appends user message on Enter key press', async () => {
        mockStreamingFetch();
        render(<WikiAsk {...defaultProps} />);
        const textarea = document.getElementById('wiki-ask-textarea') as HTMLTextAreaElement;
        fireEvent.change(textarea, { target: { value: 'Explain routing' } });
        fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });

        await waitFor(() => {
            expect(screen.getByText('Explain routing')).toBeTruthy();
        });
    });

    it('does NOT send on Shift+Enter', () => {
        render(<WikiAsk {...defaultProps} />);
        const textarea = document.getElementById('wiki-ask-textarea') as HTMLTextAreaElement;
        fireEvent.change(textarea, { target: { value: 'multiline' } });
        fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: true });

        expect(fetch).not.toHaveBeenCalled();
    });

    it('appends assistant message after successful SSE stream', async () => {
        mockStreamingFetch([
            'data: {"type":"chunk","content":"Hello "}\n\n',
        ]);
        render(<WikiAsk {...defaultProps} />);
        const textarea = document.getElementById('wiki-ask-textarea') as HTMLTextAreaElement;
        fireEvent.change(textarea, { target: { value: 'hi' } });
        fireEvent.click(document.getElementById('wiki-ask-widget-send')!);

        await waitFor(() => {
            expect(screen.getByText('Response text')).toBeTruthy();
        });
    });

    it('appends error message when fetch returns non-ok response', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: false,
            status: 500,
            json: () => Promise.resolve({ error: 'Internal error' }),
        }));

        render(<WikiAsk {...defaultProps} />);
        const textarea = document.getElementById('wiki-ask-textarea') as HTMLTextAreaElement;
        fireEvent.change(textarea, { target: { value: 'test' } });
        fireEvent.click(document.getElementById('wiki-ask-widget-send')!);

        await waitFor(() => {
            expect(screen.getByText(/Error:.*Internal error/)).toBeTruthy();
        });
    });

    it('appends error message when fetch throws a network error', async () => {
        vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network failure')));

        render(<WikiAsk {...defaultProps} />);
        const textarea = document.getElementById('wiki-ask-textarea') as HTMLTextAreaElement;
        fireEvent.change(textarea, { target: { value: 'test' } });
        fireEvent.click(document.getElementById('wiki-ask-widget-send')!);

        await waitFor(() => {
            expect(screen.getByText(/Error:.*Network failure/)).toBeTruthy();
        });
    });
});

describe('WikiAsk — Send button streaming state', () => {
    it('Send button is disabled while streaming', async () => {
        // Use a reader that never resolves to keep streaming=true
        let resolveRead!: (v: any) => void;
        const pendingRead = new Promise(r => { resolveRead = r; });
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: true,
            body: { getReader: () => ({ read: vi.fn().mockReturnValue(pendingRead) }) },
        }));

        render(<WikiAsk {...defaultProps} />);
        const textarea = document.getElementById('wiki-ask-textarea') as HTMLTextAreaElement;
        fireEvent.change(textarea, { target: { value: 'slow question' } });
        fireEvent.click(document.getElementById('wiki-ask-widget-send')!);

        // After send the textarea should be disabled (streaming=true)
        await waitFor(() => {
            const ta = document.getElementById('wiki-ask-textarea') as HTMLTextAreaElement;
            expect(ta.disabled).toBe(true);
        });

        // Clean up: resolve the pending read
        resolveRead({ done: true, value: undefined });
    });
});

describe('WikiAsk — session continuity', () => {
    it('passes sessionId in subsequent requests', async () => {
        mockStreamingFetch([], 'session-abc');
        render(<WikiAsk {...defaultProps} />);

        // First message
        const textarea = document.getElementById('wiki-ask-textarea') as HTMLTextAreaElement;
        fireEvent.change(textarea, { target: { value: 'first question' } });
        fireEvent.click(document.getElementById('wiki-ask-widget-send')!);

        // Wait for first request to complete and sessionId to be stored
        await waitFor(() => {
            expect(screen.getByText('first question')).toBeTruthy();
        });

        // Set up second mock
        mockStreamingFetch([], 'session-abc');

        await waitFor(() => {
            // After streaming completes, textarea should be enabled again
            const ta = document.getElementById('wiki-ask-textarea') as HTMLTextAreaElement;
            expect(ta.disabled).toBe(false);
        });

        // Second message
        fireEvent.change(textarea, { target: { value: 'second question' } });
        fireEvent.click(document.getElementById('wiki-ask-widget-send')!);

        await waitFor(() => {
            expect(screen.getByText('second question')).toBeTruthy();
        });

        // Second fetch should include sessionId
        const calls = (fetch as ReturnType<typeof vi.fn>).mock.calls;
        const secondCall = calls[calls.length - 1];
        const body = JSON.parse(secondCall[1].body as string);
        expect(body.sessionId).toBe('session-abc');
    });
});

describe('WikiAsk — isMobile layout', () => {
    it('applies mobile padding class when isMobile is true', () => {
        (useBreakpoint as ReturnType<typeof vi.fn>).mockReturnValue({
            isMobile: true, isTablet: false, isDesktop: false, breakpoint: 'mobile',
        });
        render(<WikiAsk {...defaultProps} />);
        const inputArea = document.querySelector('[data-testid="wiki-ask-input-area"]') as HTMLElement;
        expect(inputArea.className).toContain('pb-');
    });

    it('does not apply mobile padding when isMobile is false', () => {
        (useBreakpoint as ReturnType<typeof vi.fn>).mockReturnValue({
            isMobile: false, isTablet: false, isDesktop: true, breakpoint: 'desktop',
        });
        render(<WikiAsk {...defaultProps} />);
        const inputArea = document.querySelector('[data-testid="wiki-ask-input-area"]') as HTMLElement;
        expect(inputArea.className).not.toContain('pb-[calc');
    });
});
