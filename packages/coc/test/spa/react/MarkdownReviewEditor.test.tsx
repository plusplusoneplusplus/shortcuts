/**
 * Tests for shared MarkdownReviewEditor rendering behavior.
 */
/* @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import React from 'react';
import { MarkdownReviewEditor } from '../../../src/server/spa/client/react/shared/MarkdownReviewEditor';
import { DASHBOARD_AI_COMMANDS } from '../../../src/server/spa/client/react/shared/ai-commands';

/* ── Mock useTaskComments ── */
const mockAddComment = vi.fn();
const mockAskAI = vi.fn();
const mockDeleteComment = vi.fn();
const mockUpdateComment = vi.fn();
const mockResolveComment = vi.fn();
const mockUnresolveComment = vi.fn();
const mockClearAiError = vi.fn();

vi.mock('../../../src/server/spa/client/react/hooks/useTaskComments', () => ({
    useTaskComments: () => ({
        comments: [],
        loading: false,
        addComment: mockAddComment,
        updateComment: mockUpdateComment,
        deleteComment: mockDeleteComment,
        resolveComment: mockResolveComment,
        unresolveComment: mockUnresolveComment,
        askAI: mockAskAI,
        aiLoadingIds: new Set(),
        aiErrors: new Map(),
        clearAiError: mockClearAiError,
    }),
}));

/* ── Mock useMarkdownPreview ── */
vi.mock('../../../src/server/spa/client/react/hooks/useMarkdownPreview', () => ({
    useMarkdownPreview: ({ content }: { content: string }) => ({
        html: content ? `<p>${content}</p>` : '',
    }),
}));

/* ── Mock anchor creation (avoid real DOM traversal) ── */
vi.mock('@plusplusoneplusplus/pipeline-core/editor/anchor', () => ({
    createAnchorData: vi.fn(() => ({ text: 'anchor-text', prefixLines: [], suffixLines: [] })),
    DEFAULT_ANCHOR_MATCH_CONFIG: {},
}));

/* ── Mock extractDocumentContext ── */
vi.mock('../../../src/server/spa/client/react/utils/document-context', () => ({
    extractDocumentContext: vi.fn(() => ({ surroundingLines: 'ctx', nearestHeading: null, allHeadings: [] })),
}));

function mockJsonResponse(body: any, ok = true, status = 200): Response {
    return {
        ok,
        status,
        json: async () => body,
        text: async () => JSON.stringify(body),
    } as any;
}

function setupFetchSpy() {
    const fetchSpy = vi.fn();
    (global as any).fetch = fetchSpy;
    fetchSpy.mockImplementation((input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/tasks/content?')) {
            return Promise.resolve(mockJsonResponse({ content: '# Hello\nSome content here' }));
        }
        if (url.includes('/comment-counts/')) {
            return Promise.resolve(mockJsonResponse({ counts: {} }));
        }
        if (url.includes('/comments/')) {
            return Promise.resolve(mockJsonResponse({ comments: [] }));
        }
        return Promise.resolve(mockJsonResponse({}));
    });
    return fetchSpy;
}

/** Simulate having a text selection by setting savedSelection state via mouseup. */
function simulateTextSelection(previewEl: HTMLElement) {
    const textNode = previewEl.childNodes[0]?.childNodes?.[0] ?? previewEl.childNodes[0];
    if (!textNode) throw new Error('No text node found in preview');

    const range = document.createRange();
    range.setStart(textNode, 0);
    range.setEnd(textNode, Math.min(5, (textNode.textContent?.length ?? 0)));

    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);

    // Fire mouseup to trigger savedSelection update
    fireEvent.mouseUp(document);
}

describe('MarkdownReviewEditor', () => {
    let fetchSpy: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        fetchSpy = setupFetchSpy();
        mockAddComment.mockReset();
        mockAskAI.mockReset();
        mockAddComment.mockResolvedValue({ id: 'new-comment-1', comment: '', category: 'question' });
        mockAskAI.mockResolvedValue(undefined);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('renders markdown headings without status bar and without empty comment sidebar', async () => {
        fetchSpy.mockImplementation((input: RequestInfo | URL) => {
            const url = String(input);
            if (url.includes('/tasks/content?')) {
                return Promise.resolve(mockJsonResponse({
                    content: '# Heading One\n## Heading Two\n\n```ts\nconst a = 1;\n```',
                }));
            }
            if (url.includes('/comment-counts/')) {
                return Promise.resolve(mockJsonResponse({ counts: {} }));
            }
            if (url.includes('/comments/')) {
                return Promise.resolve(mockJsonResponse({ comments: [] }));
            }
            return Promise.resolve(mockJsonResponse({}));
        });

        render(
            <MarkdownReviewEditor
                wsId="ws1"
                filePath="feature/example.md"
                fetchMode="tasks"
            />
        );

        await waitFor(() => {
            expect(document.querySelector('#task-preview-body')).toBeTruthy();
        });

        expect(screen.queryByTestId('markdown-review-status-bar')).toBeNull();
        expect(screen.queryByTestId('comment-sidebar')).toBeNull();
    });

    it('falls back to workspace file preview in auto mode', async () => {
        fetchSpy.mockImplementation((input: RequestInfo | URL) => {
            const url = String(input);
            if (url.includes('/tasks/content?')) {
                return Promise.resolve(mockJsonResponse({ error: 'not found' }, false, 404));
            }
            if (url.includes('/files/preview?') && url.includes('lines=0')) {
                return Promise.resolve(mockJsonResponse({
                    lines: ['# From Files API', 'Body line'],
                }));
            }
            if (url.includes('/comment-counts/')) {
                return Promise.resolve(mockJsonResponse({ counts: {} }));
            }
            if (url.includes('/comments/')) {
                return Promise.resolve(mockJsonResponse({ comments: [] }));
            }
            return Promise.resolve(mockJsonResponse({}));
        });

        render(
            <MarkdownReviewEditor
                wsId="ws1"
                filePath="/Users/test/project/README.md"
                fetchMode="auto"
            />
        );

        await waitFor(() => {
            expect(document.querySelector('#task-preview-body')).toBeTruthy();
        });

        expect(fetchSpy).toHaveBeenCalledWith(
            expect.stringContaining('/files/preview?')
        );
    });

    // ── Context menu AI submenu tests ──

    describe('context menu Ask AI submenu', () => {
        async function renderAndWaitForContent() {
            const result = render(
                <MarkdownReviewEditor wsId="ws1" filePath="test.md" fetchMode="tasks" />
            );
            await waitFor(() => {
                expect(document.querySelector('#task-preview-body')).toBeTruthy();
            });
            return result;
        }

        function openContextMenu() {
            const preview = document.querySelector('#task-preview-body')!;
            fireEvent.contextMenu(preview, { clientX: 100, clientY: 100 });
        }

        it('renders "Ask AI" submenu item when selection exists', async () => {
            await renderAndWaitForContent();
            const preview = document.querySelector('#task-preview-body')! as HTMLElement;
            simulateTextSelection(preview);
            openContextMenu();

            const menu = screen.getByTestId('context-menu');
            expect(menu).toBeTruthy();
            // Should have the Ask AI button with submenu arrow
            const askAiItem = screen.getByText('Ask AI');
            expect(askAiItem).toBeTruthy();
        });

        it('renders "Ask AI" as disabled when there is no selection', async () => {
            await renderAndWaitForContent();
            // Don't simulate selection
            openContextMenu();

            const menu = screen.getByTestId('context-menu');
            expect(menu).toBeTruthy();
            // "Ask AI" item should be present but disabled
            const askAiButton = screen.getByText('Ask AI').closest('button');
            expect(askAiButton).toBeTruthy();
            expect(askAiButton!.disabled).toBe(true);
        });

        it('renders separator between "Add comment" and "Ask AI"', async () => {
            await renderAndWaitForContent();
            openContextMenu();

            // separator item has role="separator"
            const separator = document.querySelector('[data-testid="context-menu"] [role="separator"]');
            expect(separator).toBeTruthy();
        });

        it('submenu children contains all non-isCustomInput commands plus "Custom..."', async () => {
            await renderAndWaitForContent();
            const preview = document.querySelector('#task-preview-body')! as HTMLElement;
            simulateTextSelection(preview);
            openContextMenu();

            // Hover over Ask AI to open submenu
            const askAiItem = screen.getByText('Ask AI').closest('[data-testid]')!;
            fireEvent.mouseEnter(askAiItem);

            await waitFor(() => {
                // Each non-custom command should appear
                const nonCustomCommands = DASHBOARD_AI_COMMANDS.filter(c => !c.isCustomInput);
                for (const cmd of nonCustomCommands) {
                    const expectedLabel = `${cmd.icon ?? ''} ${cmd.label}`.trim();
                    expect(screen.getByText(expectedLabel)).toBeTruthy();
                }
                // Plus the Custom... entry
                expect(screen.getByText('💬 Custom...')).toBeTruthy();
            });
        });

        it('clicking a preset command calls addComment with correct label then askAI with commandId', async () => {
            await renderAndWaitForContent();
            const preview = document.querySelector('#task-preview-body')! as HTMLElement;
            simulateTextSelection(preview);
            openContextMenu();

            // Open submenu
            const askAiItem = screen.getByText('Ask AI').closest('[data-testid]')!;
            fireEvent.mouseEnter(askAiItem);

            const clarifyCmd = DASHBOARD_AI_COMMANDS.find(c => c.id === 'clarify')!;
            const label = `${clarifyCmd.icon ?? ''} ${clarifyCmd.label}`.trim();

            await waitFor(() => {
                expect(screen.getByText(label)).toBeTruthy();
            });

            await act(async () => {
                fireEvent.click(screen.getByText(label));
            });

            expect(mockAddComment).toHaveBeenCalledWith(
                expect.objectContaining({
                    comment: 'Clarify',
                    category: 'question',
                })
            );

            expect(mockAskAI).toHaveBeenCalledWith(
                'new-comment-1',
                expect.objectContaining({ commandId: 'clarify' })
            );
        });

        it('clicking "Custom..." prompts user and calls addComment then askAI with customQuestion', async () => {
            const promptSpy = vi.spyOn(window, 'prompt').mockReturnValue('What does this mean?');

            await renderAndWaitForContent();
            const preview = document.querySelector('#task-preview-body')! as HTMLElement;
            simulateTextSelection(preview);
            openContextMenu();

            // Open submenu
            const askAiItem = screen.getByText('Ask AI').closest('[data-testid]')!;
            fireEvent.mouseEnter(askAiItem);

            await waitFor(() => {
                expect(screen.getByText('💬 Custom...')).toBeTruthy();
            });

            await act(async () => {
                fireEvent.click(screen.getByText('💬 Custom...'));
            });

            expect(promptSpy).toHaveBeenCalled();
            expect(mockAddComment).toHaveBeenCalledWith(
                expect.objectContaining({
                    comment: 'What does this mean?',
                    category: 'question',
                })
            );
            expect(mockAskAI).toHaveBeenCalledWith(
                'new-comment-1',
                expect.objectContaining({ customQuestion: 'What does this mean?' })
            );

            promptSpy.mockRestore();
        });

        it('cancelling the custom prompt does not call addComment or askAI', async () => {
            const promptSpy = vi.spyOn(window, 'prompt').mockReturnValue(null);

            await renderAndWaitForContent();
            const preview = document.querySelector('#task-preview-body')! as HTMLElement;
            simulateTextSelection(preview);
            openContextMenu();

            // Open submenu
            const askAiItem = screen.getByText('Ask AI').closest('[data-testid]')!;
            fireEvent.mouseEnter(askAiItem);

            await waitFor(() => {
                expect(screen.getByText('💬 Custom...')).toBeTruthy();
            });

            await act(async () => {
                fireEvent.click(screen.getByText('💬 Custom...'));
            });

            expect(promptSpy).toHaveBeenCalled();
            expect(mockAddComment).not.toHaveBeenCalled();
            expect(mockAskAI).not.toHaveBeenCalled();

            promptSpy.mockRestore();
        });

        it('context menu closes before addComment is awaited', async () => {
            // Make addComment hang to verify menu closes first
            let resolveAddComment: (v: any) => void;
            mockAddComment.mockReturnValue(new Promise(r => { resolveAddComment = r; }));

            await renderAndWaitForContent();
            const preview = document.querySelector('#task-preview-body')! as HTMLElement;
            simulateTextSelection(preview);
            openContextMenu();

            expect(screen.getByTestId('context-menu')).toBeTruthy();

            // Open submenu and click
            const askAiItem = screen.getByText('Ask AI').closest('[data-testid]')!;
            fireEvent.mouseEnter(askAiItem);

            const clarifyCmd = DASHBOARD_AI_COMMANDS.find(c => c.id === 'clarify')!;
            const label = `${clarifyCmd.icon ?? ''} ${clarifyCmd.label}`.trim();

            await waitFor(() => {
                expect(screen.getByText(label)).toBeTruthy();
            });

            // Click but don't resolve addComment yet
            act(() => {
                fireEvent.click(screen.getByText(label));
            });

            // Context menu should be gone even though addComment hasn't resolved
            expect(screen.queryByTestId('context-menu')).toBeNull();

            // Clean up: resolve the pending promise
            await act(async () => {
                resolveAddComment!({ id: 'new-comment-1', comment: 'Clarify', category: 'question' });
            });
        });
    });
});
