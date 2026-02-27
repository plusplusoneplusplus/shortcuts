/**
 * Tests for MarkdownReviewEditor unsaved-changes guards and dirty indicator.
 */
/* @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import React from 'react';
import { MarkdownReviewEditor } from '../../../src/server/spa/client/react/shared/MarkdownReviewEditor';

/* ── Mock useTaskComments ── */
vi.mock('../../../src/server/spa/client/react/hooks/useTaskComments', () => ({
    useTaskComments: () => ({
        comments: [],
        loading: false,
        addComment: vi.fn(),
        updateComment: vi.fn(),
        deleteComment: vi.fn(),
        resolveComment: vi.fn(),
        unresolveComment: vi.fn(),
        askAI: vi.fn(),
        aiLoadingIds: new Set(),
        aiErrors: new Map(),
        clearAiError: vi.fn(),
        resolveWithAI: vi.fn(),
        fixWithAI: vi.fn(),
        copyResolvePrompt: vi.fn(),
        resolving: false,
        resolvingCommentId: null,
        refresh: vi.fn(),
    }),
}));

/* ── Mock useMarkdownPreview ── */
vi.mock('../../../src/server/spa/client/react/hooks/useMarkdownPreview', () => ({
    useMarkdownPreview: ({ content }: { content: string }) => ({
        html: content ? `<p>${content}</p>` : '',
    }),
}));

/* ── Mock anchor creation ── */
vi.mock('@plusplusoneplusplus/pipeline-core/editor/anchor', () => ({
    createAnchorData: vi.fn(),
    DEFAULT_ANCHOR_MATCH_CONFIG: {},
}));

/* ── Mock extractDocumentContext ── */
vi.mock('../../../src/server/spa/client/react/utils/document-context', () => ({
    extractDocumentContext: vi.fn(() => ({ surroundingLines: 'ctx', nearestHeading: null, allHeadings: [] })),
}));

/* ── Mock useGlobalToast ── */
vi.mock('../../../src/server/spa/client/react/context/ToastContext', () => ({
    useGlobalToast: () => ({ addToast: vi.fn(), removeToast: vi.fn(), toasts: [] }),
}));

/* ── Mock SourceEditor as a simple textarea ── */
vi.mock('../../../src/server/spa/client/react/shared/SourceEditor', () => ({
    SourceEditor: ({ content, onChange }: { content: string; onChange: (v: string) => void }) => (
        <textarea
            data-testid="source-editor"
            value={content}
            onChange={(e) => onChange(e.target.value)}
        />
    ),
}));

/* ── Mock getApiBase ── */
vi.mock('../../../src/server/spa/client/react/utils/config', () => ({
    getApiBase: () => '',
}));

const RAW_CONTENT = '# Hello\nSome content here';
const RAW_CONTENT_2 = '# Second file\nDifferent content';

function mockJsonResponse(body: any, ok = true, status = 200): Response {
    return {
        ok,
        status,
        json: async () => body,
        text: async () => JSON.stringify(body),
    } as any;
}

function setupFetchSpy(content = RAW_CONTENT) {
    const fetchSpy = vi.fn();
    (global as any).fetch = fetchSpy;
    fetchSpy.mockImplementation((input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/tasks/content?')) {
            return Promise.resolve(mockJsonResponse({ content }));
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

async function renderAndWait(props?: Partial<{ wsId: string; filePath: string; fetchMode: 'tasks' | 'auto' }>) {
    const result = render(
        <MarkdownReviewEditor wsId={props?.wsId ?? 'ws1'} filePath={props?.filePath ?? 'test.md'} fetchMode={props?.fetchMode ?? 'tasks'} />
    );
    await waitFor(() => {
        expect(document.querySelector('#task-preview-body') || document.querySelector('[data-testid="source-editor"]')).toBeTruthy();
    });
    return result;
}

async function switchToSource() {
    await act(async () => {
        fireEvent.click(screen.getByText('Source'));
    });
}

async function makeDirty() {
    const textarea = screen.getByTestId('source-editor') as HTMLTextAreaElement;
    await act(async () => {
        fireEvent.change(textarea, { target: { value: RAW_CONTENT + '\nedited' } });
    });
}

describe('MarkdownReviewEditor guards', () => {
    let fetchSpy: ReturnType<typeof vi.fn>;
    let confirmSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        fetchSpy = setupFetchSpy();
        confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    // ── Mode-switch guard ──

    describe('mode-switch guard', () => {
        it('switching to Preview with dirty content shows confirm', async () => {
            await renderAndWait();
            await switchToSource();
            await makeDirty();

            confirmSpy.mockReturnValue(false);
            await act(async () => {
                fireEvent.click(screen.getByText('Preview'));
            });

            expect(confirmSpy).toHaveBeenCalledWith('You have unsaved changes. Discard and switch to Preview?');
        });

        it('confirm accepted discards changes and switches mode', async () => {
            await renderAndWait();
            await switchToSource();
            await makeDirty();

            confirmSpy.mockReturnValue(true);
            await act(async () => {
                fireEvent.click(screen.getByText('Preview'));
            });

            // Should have switched to preview mode
            expect(document.querySelector('#task-preview-body')).toBeTruthy();
            expect(screen.queryByTestId('source-editor')).toBeNull();
            // Preview button should be active
            expect(screen.getByText('Preview').className).toContain('active');
        });

        it('confirm cancelled stays in source mode', async () => {
            await renderAndWait();
            await switchToSource();
            await makeDirty();

            confirmSpy.mockReturnValue(false);
            await act(async () => {
                fireEvent.click(screen.getByText('Preview'));
            });

            // Should still be in source mode
            expect(screen.getByTestId('source-editor')).toBeTruthy();
            expect(document.querySelector('#task-preview-body')).toBeNull();
        });
    });

    // ── Modified indicator ──

    describe('modified indicator', () => {
        it('modified indicator visible when dirty', async () => {
            await renderAndWait();
            await switchToSource();
            await makeDirty();

            const sourceBtn = screen.getByText('Source ●');
            expect(sourceBtn).toBeTruthy();
            expect(sourceBtn.getAttribute('aria-label')).toBe('Source (modified)');
        });

        it('modified indicator not visible when clean', async () => {
            await renderAndWait();
            await switchToSource();

            const sourceBtn = screen.getByText('Source');
            expect(sourceBtn).toBeTruthy();
            expect(sourceBtn.textContent).toBe('Source');
            expect(sourceBtn.getAttribute('aria-label')).toBeNull();
        });
    });

    // ── beforeunload guard ──

    describe('beforeunload guard', () => {
        it('beforeunload handler set when dirty', async () => {
            const addSpy = vi.spyOn(window, 'addEventListener');

            await renderAndWait();
            await switchToSource();
            await makeDirty();

            const beforeunloadCalls = addSpy.mock.calls.filter(c => c[0] === 'beforeunload');
            expect(beforeunloadCalls.length).toBeGreaterThanOrEqual(1);
        });

        it('beforeunload handler removed when clean', async () => {
            const removeSpy = vi.spyOn(window, 'removeEventListener');

            await renderAndWait();
            await switchToSource();
            await makeDirty();

            // Save to clear dirty state
            fetchSpy.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
                if (init?.method === 'PATCH') {
                    return Promise.resolve(mockJsonResponse({ updated: true }));
                }
                const url = String(input);
                if (url.includes('/tasks/content?')) {
                    return Promise.resolve(mockJsonResponse({ content: RAW_CONTENT }));
                }
                if (url.includes('/comment-counts/')) {
                    return Promise.resolve(mockJsonResponse({ counts: {} }));
                }
                if (url.includes('/comments/')) {
                    return Promise.resolve(mockJsonResponse({ comments: [] }));
                }
                return Promise.resolve(mockJsonResponse({}));
            });

            await act(async () => {
                fireEvent.click(screen.getByText('Save'));
            });

            const removeBeforeunloadCalls = removeSpy.mock.calls.filter(c => c[0] === 'beforeunload');
            expect(removeBeforeunloadCalls.length).toBeGreaterThanOrEqual(1);
        });
    });

    // ── File-navigation guard ──

    describe('file-navigation guard', () => {
        it('file navigation with dirty content shows confirm', async () => {
            confirmSpy.mockReturnValue(true);
            const { rerender } = await renderAndWait();
            await switchToSource();
            await makeDirty();

            confirmSpy.mockClear();
            confirmSpy.mockReturnValue(true);

            await act(async () => {
                rerender(
                    <MarkdownReviewEditor wsId="ws1" filePath="new-file.md" fetchMode="tasks" />
                );
            });

            expect(confirmSpy).toHaveBeenCalledWith(
                'You have unsaved changes to the current file. Discard and load the new file?'
            );
        });

        it('file navigation confirm accepted loads new file', async () => {
            confirmSpy.mockReturnValue(true);
            const { rerender } = await renderAndWait();
            await switchToSource();
            await makeDirty();

            confirmSpy.mockClear();
            confirmSpy.mockReturnValue(true);

            // Update fetch to return different content for new file
            fetchSpy.mockImplementation((input: RequestInfo | URL) => {
                const url = String(input);
                if (url.includes('/tasks/content?') && url.includes('new-file.md')) {
                    return Promise.resolve(mockJsonResponse({ content: RAW_CONTENT_2 }));
                }
                if (url.includes('/tasks/content?')) {
                    return Promise.resolve(mockJsonResponse({ content: RAW_CONTENT }));
                }
                if (url.includes('/comment-counts/')) {
                    return Promise.resolve(mockJsonResponse({ counts: {} }));
                }
                if (url.includes('/comments/')) {
                    return Promise.resolve(mockJsonResponse({ comments: [] }));
                }
                return Promise.resolve(mockJsonResponse({}));
            });

            await act(async () => {
                rerender(
                    <MarkdownReviewEditor wsId="ws1" filePath="new-file.md" fetchMode="tasks" />
                );
            });

            // Fetch should have been called for the new file
            await waitFor(() => {
                const newFileFetch = fetchSpy.mock.calls.find(
                    (c: any[]) => String(c[0]).includes('new-file.md')
                );
                expect(newFileFetch).toBeTruthy();
            });
        });

        it('file navigation confirm cancelled keeps current content', async () => {
            confirmSpy.mockReturnValue(true);
            const { rerender } = await renderAndWait();
            await switchToSource();
            await makeDirty();

            const editedValue = RAW_CONTENT + '\nedited';
            const textarea = screen.getByTestId('source-editor') as HTMLTextAreaElement;
            expect(textarea.value).toBe(editedValue);

            confirmSpy.mockClear();
            confirmSpy.mockReturnValue(false);

            const fetchCountBefore = fetchSpy.mock.calls.length;

            await act(async () => {
                rerender(
                    <MarkdownReviewEditor wsId="ws1" filePath="new-file.md" fetchMode="tasks" />
                );
            });

            expect(confirmSpy).toHaveBeenCalled();
            // No new fetch should have been made for the new file
            const newFetchCalls = fetchSpy.mock.calls.slice(fetchCountBefore).filter(
                (c: any[]) => String(c[0]).includes('/tasks/content?')
            );
            expect(newFetchCalls.length).toBe(0);
        });
    });
});
