/**
 * Tests for MarkdownReviewEditor refresh button behavior.
 */
/* @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import React from 'react';
import { MarkdownReviewEditor } from '../../../src/server/spa/client/react/shared/MarkdownReviewEditor';

/* ── Mock useTaskComments ── */
vi.mock('../../../src/server/spa/client/react/tasks/hooks/useTaskComments', () => ({
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
        refresh: vi.fn(),
        resolvingIds: new Set(),
        deletingIds: new Set(),
    }),
}));

/* ── Mock useMarkdownPreview ── */
vi.mock('../../../src/server/spa/client/react/hooks/ui/useMarkdownPreview', () => ({
    useMarkdownPreview: ({ content }: { content: string }) => ({
        html: content ? `<p>${content}</p>` : '',
    }),
}));

/* ── Mock anchor creation ── */
vi.mock('@plusplusoneplusplus/forge/editor/anchor', () => ({
    createAnchorData: vi.fn(),
    DEFAULT_ANCHOR_MATCH_CONFIG: {},
}));

/* ── Mock extractDocumentContext ── */
vi.mock('../../../src/server/spa/client/react/utils/document-context', () => ({
    extractDocumentContext: vi.fn(() => ({ surroundingLines: 'ctx', nearestHeading: null, allHeadings: [] })),
}));

/* ── Mock useGlobalToast ── */
vi.mock('../../../src/server/spa/client/react/contexts/ToastContext', () => ({
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
    isContainerMode: () => false,
    getApiBase: () => '',
    isRalphEnabled: () => false,
}));

/* ── Mock useApp ── */
vi.mock('../../../src/server/spa/client/react/contexts/AppContext', () => ({
    useApp: () => ({ state: { workspaces: [] }, dispatch: vi.fn() }),
}));

vi.mock('../../../src/server/spa/client/react/contexts/QueueContext', () => ({
    useQueue: () => ({ state: {}, dispatch: vi.fn() }),
}));

const RAW_CONTENT = '# Hello\nSome content here';
const UPDATED_CONTENT = '# Hello\nUpdated content after refresh';

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

describe('MarkdownReviewEditor refresh', () => {
    let fetchSpy: ReturnType<typeof vi.fn>;
    let confirmSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        fetchSpy = setupFetchSpy();
        confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('refresh button is rendered and visible by default', async () => {
        await renderAndWait();

        const btn = screen.getByTestId('markdown-review-refresh-btn');
        expect(btn).toBeTruthy();
        expect(btn.getAttribute('aria-label')).toBe('Refresh');
        expect(btn.textContent).toBe('↻');
    });

    it('refresh button is visible in source mode', async () => {
        await renderAndWait();
        await switchToSource();

        const btn = screen.getByTestId('markdown-review-refresh-btn');
        expect(btn).toBeTruthy();
    });

    it('clicking refresh re-fetches content', async () => {
        await renderAndWait();

        const initialFetchCount = fetchSpy.mock.calls.filter(
            (c: any) => String(c[0]).includes('/tasks/content?')
        ).length;

        await act(async () => {
            fireEvent.click(screen.getByTestId('markdown-review-refresh-btn'));
        });

        await waitFor(() => {
            const afterFetchCount = fetchSpy.mock.calls.filter(
                (c: any) => String(c[0]).includes('/tasks/content?')
            ).length;
            expect(afterFetchCount).toBeGreaterThan(initialFetchCount);
        });
    });

    it('after refresh, updated content is displayed', async () => {
        await renderAndWait();

        // Update the mock to return new content
        fetchSpy.mockImplementation((input: RequestInfo | URL) => {
            const url = String(input);
            if (url.includes('/tasks/content?')) {
                return Promise.resolve(mockJsonResponse({ content: UPDATED_CONTENT }));
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
            fireEvent.click(screen.getByTestId('markdown-review-refresh-btn'));
        });

        await waitFor(() => {
            const preview = document.querySelector('#task-preview-body');
            expect(preview?.innerHTML).toContain('Updated content after refresh');
        });
    });

    it('dirty-state guard: clicking refresh with unsaved changes shows confirmation', async () => {
        await renderAndWait();
        await switchToSource();
        await makeDirty();

        confirmSpy.mockReturnValue(false);
        await act(async () => {
            fireEvent.click(screen.getByTestId('markdown-review-refresh-btn'));
        });

        expect(confirmSpy).toHaveBeenCalledWith('You have unsaved changes. Discard and refresh?');
    });

    it('dirty-state guard: confirming discards changes and re-fetches', async () => {
        await renderAndWait();
        await switchToSource();
        await makeDirty();

        const fetchCountBefore = fetchSpy.mock.calls.filter(
            (c: any) => String(c[0]).includes('/tasks/content?')
        ).length;

        confirmSpy.mockReturnValue(true);
        await act(async () => {
            fireEvent.click(screen.getByTestId('markdown-review-refresh-btn'));
        });

        await waitFor(() => {
            const fetchCountAfter = fetchSpy.mock.calls.filter(
                (c: any) => String(c[0]).includes('/tasks/content?')
            ).length;
            expect(fetchCountAfter).toBeGreaterThan(fetchCountBefore);
        });
    });

    it('dirty-state guard: cancelling does not re-fetch', async () => {
        await renderAndWait();
        await switchToSource();
        await makeDirty();

        const fetchCountBefore = fetchSpy.mock.calls.filter(
            (c: any) => String(c[0]).includes('/tasks/content?')
        ).length;

        confirmSpy.mockReturnValue(false);
        await act(async () => {
            fireEvent.click(screen.getByTestId('markdown-review-refresh-btn'));
        });

        // Wait a tick and verify no new fetch was triggered
        await act(async () => {
            await new Promise(r => setTimeout(r, 50));
        });

        const fetchCountAfter = fetchSpy.mock.calls.filter(
            (c: any) => String(c[0]).includes('/tasks/content?')
        ).length;
        expect(fetchCountAfter).toBe(fetchCountBefore);
    });

    it('button is not disabled when content is loaded', async () => {
        await renderAndWait();

        const btn = screen.getByTestId('markdown-review-refresh-btn') as HTMLButtonElement;
        expect(btn.disabled).toBe(false);
    });

    it('keyboard shortcut Ctrl+Shift+R triggers refresh', async () => {
        await renderAndWait();

        const initialFetchCount = fetchSpy.mock.calls.filter(
            (c: any) => String(c[0]).includes('/tasks/content?')
        ).length;

        await act(async () => {
            fireEvent.keyDown(document, { key: 'R', ctrlKey: true, shiftKey: true });
        });

        await waitFor(() => {
            const afterFetchCount = fetchSpy.mock.calls.filter(
                (c: any) => String(c[0]).includes('/tasks/content?')
            ).length;
            expect(afterFetchCount).toBeGreaterThan(initialFetchCount);
        });
    });

    it('keyboard shortcut Cmd+Shift+R triggers refresh (macOS)', async () => {
        await renderAndWait();

        const initialFetchCount = fetchSpy.mock.calls.filter(
            (c: any) => String(c[0]).includes('/tasks/content?')
        ).length;

        await act(async () => {
            fireEvent.keyDown(document, { key: 'R', metaKey: true, shiftKey: true });
        });

        await waitFor(() => {
            const afterFetchCount = fetchSpy.mock.calls.filter(
                (c: any) => String(c[0]).includes('/tasks/content?')
            ).length;
            expect(afterFetchCount).toBeGreaterThan(initialFetchCount);
        });
    });

    it('refresh button has correct title with keyboard shortcut hint', async () => {
        await renderAndWait();

        const btn = screen.getByTestId('markdown-review-refresh-btn');
        expect(btn.getAttribute('title')).toBe('Refresh (Ctrl+Shift+R)');
    });
});
