/**
 * Tests for FilePreview component.
 *
 * Verifies:
 * - Row-based line rendering (not legacy pre+join)
 * - Word wrap styles on line content
 * - Markdown file detection and markdown rendering path
 * - Non-markdown files show line numbers
 * - Caching and error states
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react';
import { AppProvider } from '../../../src/server/spa/client/react/context/AppContext';
import { FilePreview } from '../../../src/server/spa/client/react/shared/FilePreview';

// ── Mocks ──────────────────────────────────────────────────────────────

const mockFetch = vi.fn();

beforeEach(() => {
    vi.restoreAllMocks();
    mockFetch.mockReset();
    // Provide a default response so AppProvider's /preferences fetch doesn't crash.
    mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });
    global.fetch = mockFetch;
});

afterEach(() => {
    vi.restoreAllMocks();
});

function renderFilePreview(props?: Partial<{ filePath: string; wsId: string }>) {
    return render(
        <AppProvider>
            <FilePreview
                filePath={props?.filePath ?? '/workspace/src/app.ts'}
                wsId={props?.wsId ?? 'ws-1'}
            >
                <span data-testid="trigger">file.ts</span>
            </FilePreview>
        </AppProvider>
    );
}

function mockPreviewResponse(overrides?: Partial<{
    path: string;
    fileName: string;
    lines: string[];
    totalLines: number;
    truncated: boolean;
    language: string;
}>) {
    // AppProvider fetches /preferences on mount — consume it first.
    mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) });
    mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
            path: '/workspace/src/app.ts',
            fileName: 'app.ts',
            lines: ['const a = 1;', 'const b = 2;', 'const c = 3;'],
            totalLines: 3,
            truncated: false,
            language: 'ts',
            ...overrides,
        }),
    });
}

function mockMarkdownPreviewResponse() {
    // AppProvider fetches /preferences on mount — consume it first.
    mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) });
    mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
            path: '/workspace/docs/README.md',
            fileName: 'README.md',
            lines: ['# Hello', '', 'This is a test.'],
            totalLines: 3,
            truncated: false,
            language: 'md',
        }),
    });
}

// ── Tests ──────────────────────────────────────────────────────────────

describe('FilePreview', () => {
    describe('rendering trigger', () => {
        it('renders children as trigger element', () => {
            renderFilePreview();
            expect(screen.getByTestId('trigger')).toBeDefined();
            expect(screen.getByTestId('trigger').textContent).toBe('file.ts');
        });

        it('does not render tooltip initially', () => {
            renderFilePreview();
            expect(document.querySelector('.file-preview-lines')).toBeNull();
        });
    });

    describe('non-markdown file preview (row-based rendering)', () => {
        it('renders row-based line structure on hover', async () => {
            mockPreviewResponse();
            renderFilePreview();

            await act(async () => {
                fireEvent.mouseEnter(screen.getByTestId('trigger'));
            });

            await waitFor(() => {
                const lines = document.querySelectorAll('.file-preview-line');
                expect(lines.length).toBe(3);
            });
        });

        it('renders line numbers for each row', async () => {
            mockPreviewResponse();
            renderFilePreview();

            await act(async () => {
                fireEvent.mouseEnter(screen.getByTestId('trigger'));
            });

            await waitFor(() => {
                const lineNumbers = document.querySelectorAll('.file-preview-line-number');
                expect(lineNumbers.length).toBe(3);
                expect(lineNumbers[0].textContent).toBe('1');
                expect(lineNumbers[1].textContent).toBe('2');
                expect(lineNumbers[2].textContent).toBe('3');
            });
        });

        it('renders line content for each row', async () => {
            mockPreviewResponse();
            renderFilePreview();

            await act(async () => {
                fireEvent.mouseEnter(screen.getByTestId('trigger'));
            });

            await waitFor(() => {
                const lineContents = document.querySelectorAll('.file-preview-line-content');
                expect(lineContents.length).toBe(3);
                expect(lineContents[0].textContent).toBe('const a = 1;');
                expect(lineContents[1].textContent).toBe('const b = 2;');
                expect(lineContents[2].textContent).toBe('const c = 3;');
            });
        });

        it('applies word-wrap styles to line content', async () => {
            mockPreviewResponse();
            renderFilePreview();

            await act(async () => {
                fireEvent.mouseEnter(screen.getByTestId('trigger'));
            });

            await waitFor(() => {
                const lineContent = document.querySelector('.file-preview-line-content') as HTMLElement;
                expect(lineContent).toBeDefined();
                expect(lineContent.style.whiteSpace).toBe('pre-wrap');
                expect(lineContent.style.overflowWrap).toBe('anywhere');
            });
        });

        it('does not use legacy pre+join rendering', async () => {
            mockPreviewResponse();
            renderFilePreview();

            await act(async () => {
                fireEvent.mouseEnter(screen.getByTestId('trigger'));
            });

            await waitFor(() => {
                // Should NOT have a <pre> with all lines joined
                const preElements = document.querySelectorAll('pre');
                for (const pre of preElements) {
                    expect(pre.textContent).not.toContain('const a = 1;\nconst b = 2;');
                }
                // Should have row-based rendering
                expect(document.querySelector('.file-preview-lines')).toBeDefined();
            });
        });

        it('handles empty lines without extra blank rows', async () => {
            mockPreviewResponse({
                lines: ['line1', '', 'line3'],
                totalLines: 3,
            });
            renderFilePreview();

            await act(async () => {
                fireEvent.mouseEnter(screen.getByTestId('trigger'));
            });

            await waitFor(() => {
                const lines = document.querySelectorAll('.file-preview-line');
                // Exactly 3 rows — no extra spacer rows
                expect(lines.length).toBe(3);
                const lineNumbers = document.querySelectorAll('.file-preview-line-number');
                expect(lineNumbers[1].textContent).toBe('2');
            });
        });

        it('line numbers are not selectable', async () => {
            mockPreviewResponse();
            renderFilePreview();

            await act(async () => {
                fireEvent.mouseEnter(screen.getByTestId('trigger'));
            });

            await waitFor(() => {
                const lineNumber = document.querySelector('.file-preview-line-number') as HTMLElement;
                expect(lineNumber.classList.contains('select-none')).toBe(true);
            });
        });
    });

    describe('markdown file preview', () => {
        it('detects markdown files by language field', async () => {
            mockMarkdownPreviewResponse();
            renderFilePreview({ filePath: '/workspace/docs/README.md' });

            await act(async () => {
                fireEvent.mouseEnter(screen.getByTestId('trigger'));
            });

            await waitFor(() => {
                // Markdown files use markdown-body class instead of file-preview-lines
                const markdownBody = document.querySelector('.markdown-body');
                expect(markdownBody).not.toBeNull();
                expect(document.querySelector('.file-preview-lines')).toBeNull();
            });
        });

        it('detects markdown files by file extension', async () => {
            // AppProvider fetches /preferences on mount — consume it first.
            mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) });
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({
                    path: '/workspace/docs/guide.markdown',
                    fileName: 'guide.markdown',
                    lines: ['# Guide', '', 'Content here.'],
                    totalLines: 3,
                    truncated: false,
                    language: 'plaintext',
                }),
            });
            renderFilePreview({ filePath: '/workspace/docs/guide.markdown' });

            await act(async () => {
                fireEvent.mouseEnter(screen.getByTestId('trigger'));
            });

            await waitFor(() => {
                expect(document.querySelector('.markdown-body')).not.toBeNull();
            });
        });

        it('renders markdown content through renderMarkdownToHtml', async () => {
            mockMarkdownPreviewResponse();
            renderFilePreview({ filePath: '/workspace/docs/README.md' });

            await act(async () => {
                fireEvent.mouseEnter(screen.getByTestId('trigger'));
            });

            await waitFor(() => {
                const markdownBody = document.querySelector('.markdown-body');
                expect(markdownBody).not.toBeNull();
                // renderMarkdownToHtml wraps lines in md-line divs
                expect(markdownBody!.innerHTML).toContain('data-line=');
            });
        });
    });

    describe('header and metadata', () => {
        it('displays file name in header', async () => {
            mockPreviewResponse();
            renderFilePreview();

            await act(async () => {
                fireEvent.mouseEnter(screen.getByTestId('trigger'));
            });

            await waitFor(() => {
                expect(screen.getByText('app.ts')).toBeDefined();
            });
        });

        it('displays line count', async () => {
            mockPreviewResponse();
            renderFilePreview();

            await act(async () => {
                fireEvent.mouseEnter(screen.getByTestId('trigger'));
            });

            await waitFor(() => {
                expect(screen.getByText('3 lines')).toBeDefined();
            });
        });

        it('shows truncation info when file is truncated', async () => {
            mockPreviewResponse({ truncated: true, totalLines: 500, lines: ['line1'] });
            renderFilePreview();

            await act(async () => {
                fireEvent.mouseEnter(screen.getByTestId('trigger'));
            });

            await waitFor(() => {
                expect(screen.getByText(/500 total/)).toBeDefined();
            });
        });
    });

    describe('error handling', () => {
        it('shows error message on fetch failure', async () => {
            // AppProvider fetches /preferences on mount — consume it first.
            mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) });
            mockFetch.mockResolvedValueOnce({
                ok: false,
                status: 404,
                json: () => Promise.resolve({ error: 'File not found' }),
            });
            renderFilePreview();

            await act(async () => {
                fireEvent.mouseEnter(screen.getByTestId('trigger'));
            });

            await waitFor(() => {
                expect(screen.getByText('Preview unavailable')).toBeDefined();
            });
        });
    });

    describe('mobile device (pointer: coarse)', () => {
        function mockCoarsePointer() {
            const original = window.matchMedia;
            window.matchMedia = vi.fn().mockImplementation((query: string) => ({
                matches: query === '(pointer: coarse)',
                media: query,
                onchange: null,
                addEventListener: vi.fn(),
                removeEventListener: vi.fn(),
                addListener: vi.fn(),
                removeListener: vi.fn(),
                dispatchEvent: vi.fn(),
            }));
            return () => { window.matchMedia = original; };
        }

        it('does not show tooltip on mouseEnter when pointer is coarse', async () => {
            const restore = mockCoarsePointer();
            try {
                mockPreviewResponse();
                renderFilePreview();

                await act(async () => {
                    fireEvent.mouseEnter(screen.getByTestId('trigger'));
                });

                // Tooltip should not appear
                await new Promise(r => setTimeout(r, 50));
                expect(document.querySelector('.file-preview-lines')).toBeNull();
                expect(document.querySelector('[class*="fixed z-50"]')).toBeNull();
            } finally {
                restore();
            }
        });

        it('does not fetch preview data on mouseEnter when pointer is coarse', async () => {
            const restore = mockCoarsePointer();
            try {
                mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) });
                renderFilePreview();

                await act(async () => {
                    fireEvent.mouseEnter(screen.getByTestId('trigger'));
                });

                await new Promise(r => setTimeout(r, 50));
                // Only the AppProvider preferences fetch should have been called, not the preview fetch
                const previewCalls = mockFetch.mock.calls.filter((c: any[]) =>
                    String(c[0]).includes('/files/preview')
                );
                expect(previewCalls.length).toBe(0);
            } finally {
                restore();
            }
        });
    });

    describe('tooltip visibility', () => {
        it('hides tooltip on mouse leave after delay', async () => {
            vi.useFakeTimers();
            mockPreviewResponse();
            renderFilePreview();

            // Trigger hover
            await act(async () => {
                fireEvent.mouseEnter(screen.getByTestId('trigger'));
            });

            // Resolve the fetch promise
            await act(async () => {
                await vi.runAllTimersAsync();
            });

            // Verify tooltip is visible
            expect(document.querySelector('.file-preview-lines')).not.toBeNull();

            // Trigger mouse leave
            act(() => {
                fireEvent.mouseLeave(screen.getByTestId('trigger'));
            });

            // Advance past the 200ms hide delay
            act(() => {
                vi.advanceTimersByTime(300);
            });

            expect(document.querySelector('.file-preview-lines')).toBeNull();
            vi.useRealTimers();
        });
    });
});
