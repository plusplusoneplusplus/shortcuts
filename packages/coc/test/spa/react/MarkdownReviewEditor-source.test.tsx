/**
 * Tests for MarkdownReviewEditor source-mode editing and save behavior.
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

/* ── Mock useApp ── */
vi.mock('../../../src/server/spa/client/react/context/AppContext', () => ({
    useApp: () => ({ state: { workspaces: [] }, dispatch: vi.fn() }),
}));

const RAW_CONTENT = '# Hello\nSome content here';

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
    return fetchSpy;
}

async function renderAndWait() {
    const result = render(
        <MarkdownReviewEditor wsId="ws1" filePath="test.md" fetchMode="tasks" />
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

describe('MarkdownReviewEditor source mode', () => {
    let fetchSpy: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        fetchSpy = setupFetchSpy();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('source mode renders SourceEditor', async () => {
        await renderAndWait();
        await switchToSource();

        expect(screen.getByTestId('source-editor')).toBeTruthy();
        expect(document.querySelector('#task-preview-body')).toBeNull();
    });

    it('review mode does not render SourceEditor', async () => {
        await renderAndWait();

        expect(screen.queryByTestId('source-editor')).toBeNull();
        expect(document.querySelector('#task-preview-body')).toBeTruthy();
    });

    it('save button hidden when not dirty', async () => {
        await renderAndWait();
        await switchToSource();

        expect(screen.queryByText('Save')).toBeNull();
    });

    it('save button appears when dirty', async () => {
        await renderAndWait();
        await switchToSource();

        const textarea = screen.getByTestId('source-editor') as HTMLTextAreaElement;
        await act(async () => {
            fireEvent.change(textarea, { target: { value: RAW_CONTENT + '\nedited' } });
        });

        expect(screen.getByText('Save')).toBeTruthy();
    });

    it('save button dispatches PATCH', async () => {
        await renderAndWait();
        await switchToSource();

        const textarea = screen.getByTestId('source-editor') as HTMLTextAreaElement;
        const edited = RAW_CONTENT + '\nedited';
        await act(async () => {
            fireEvent.change(textarea, { target: { value: edited } });
        });

        // Setup PATCH response
        fetchSpy.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
            const url = String(input);
            if (init?.method === 'PATCH' && url.includes('/tasks/content')) {
                return Promise.resolve(mockJsonResponse({ path: 'test.md', updated: true }));
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
            fireEvent.click(screen.getByText('Save'));
        });

        const patchCall = fetchSpy.mock.calls.find(
            (c: any[]) => c[1]?.method === 'PATCH'
        );
        expect(patchCall).toBeTruthy();
        expect(patchCall![0]).toContain('/workspaces/ws1/tasks/content');
        const body = JSON.parse(patchCall![1].body);
        expect(body.path).toBe('test.md');
        expect(body.content).toBe(edited);
    });

    it('successful save clears dirty state', async () => {
        await renderAndWait();
        await switchToSource();

        const textarea = screen.getByTestId('source-editor') as HTMLTextAreaElement;
        await act(async () => {
            fireEvent.change(textarea, { target: { value: RAW_CONTENT + '\nedited' } });
        });

        expect(screen.getByText('Save')).toBeTruthy();

        fetchSpy.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
            const url = String(input);
            if (init?.method === 'PATCH') {
                return Promise.resolve(mockJsonResponse({ updated: true }));
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
            fireEvent.click(screen.getByText('Save'));
        });

        // After save, rawContent = editedContent, so isDirty becomes false
        expect(screen.queryByText('Save')).toBeNull();
    });

    it('successful save dispatches tasks-changed event', async () => {
        await renderAndWait();
        await switchToSource();

        const textarea = screen.getByTestId('source-editor') as HTMLTextAreaElement;
        await act(async () => {
            fireEvent.change(textarea, { target: { value: RAW_CONTENT + '\nnew' } });
        });

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

        const dispatchSpy = vi.spyOn(window, 'dispatchEvent');

        await act(async () => {
            fireEvent.click(screen.getByText('Save'));
        });

        const tasksChangedEvent = dispatchSpy.mock.calls.find(
            (c: any[]) => c[0] instanceof CustomEvent && c[0].type === 'tasks-changed'
        );
        expect(tasksChangedEvent).toBeTruthy();
        expect((tasksChangedEvent![0] as CustomEvent).detail.wsId).toBe('ws1');
    });

    it('failed save shows error', async () => {
        await renderAndWait();
        await switchToSource();

        const textarea = screen.getByTestId('source-editor') as HTMLTextAreaElement;
        await act(async () => {
            fireEvent.change(textarea, { target: { value: RAW_CONTENT + '\nfail' } });
        });

        fetchSpy.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
            if (init?.method === 'PATCH') {
                return Promise.resolve(mockJsonResponse({ error: 'Server error' }, false, 500));
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

        // Error message should be displayed
        await waitFor(() => {
            const errorEl = document.querySelector('.text-\\[\\#f14c4c\\]');
            expect(errorEl).toBeTruthy();
        });
    });

    it('Ctrl+S triggers save when dirty', async () => {
        await renderAndWait();
        await switchToSource();

        const textarea = screen.getByTestId('source-editor') as HTMLTextAreaElement;
        const edited = RAW_CONTENT + '\nctrl-s';
        await act(async () => {
            fireEvent.change(textarea, { target: { value: edited } });
        });

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
            fireEvent.keyDown(document, { key: 's', ctrlKey: true });
        });

        const patchCall = fetchSpy.mock.calls.find(
            (c: any[]) => c[1]?.method === 'PATCH'
        );
        expect(patchCall).toBeTruthy();
    });

    it('Cmd+S triggers save when dirty (macOS)', async () => {
        await renderAndWait();
        await switchToSource();

        const textarea = screen.getByTestId('source-editor') as HTMLTextAreaElement;
        await act(async () => {
            fireEvent.change(textarea, { target: { value: RAW_CONTENT + '\ncmd-s' } });
        });

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
            fireEvent.keyDown(document, { key: 's', metaKey: true });
        });

        const patchCall = fetchSpy.mock.calls.find(
            (c: any[]) => c[1]?.method === 'PATCH'
        );
        expect(patchCall).toBeTruthy();
    });

    it('Ctrl+S does nothing when not dirty', async () => {
        await renderAndWait();
        await switchToSource();

        // Don't edit — content matches rawContent, so not dirty
        await act(async () => {
            fireEvent.keyDown(document, { key: 's', ctrlKey: true });
        });

        const patchCall = fetchSpy.mock.calls.find(
            (c: any[]) => c[1]?.method === 'PATCH'
        );
        expect(patchCall).toBeUndefined();
    });

    it('switching to source initializes editedContent from rawContent', async () => {
        await renderAndWait();
        await switchToSource();

        const textarea = screen.getByTestId('source-editor') as HTMLTextAreaElement;
        expect(textarea.value).toBe(RAW_CONTENT);
    });

    it('save button disabled while saving', async () => {
        await renderAndWait();
        await switchToSource();

        const textarea = screen.getByTestId('source-editor') as HTMLTextAreaElement;
        await act(async () => {
            fireEvent.change(textarea, { target: { value: RAW_CONTENT + '\nslow' } });
        });

        // Make PATCH hang
        let resolvePatch: (v: Response) => void;
        fetchSpy.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
            if (init?.method === 'PATCH') {
                return new Promise<Response>((resolve) => { resolvePatch = resolve; });
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

        // Click save — don't await
        act(() => {
            fireEvent.click(screen.getByText('Save'));
        });

        // During in-flight, button should show "Saving…" and be disabled
        await waitFor(() => {
            const btn = screen.getByText('Saving…');
            expect(btn).toBeTruthy();
            expect((btn as HTMLButtonElement).disabled).toBe(true);
        });

        // Resolve to clean up
        await act(async () => {
            resolvePatch!(mockJsonResponse({ updated: true }) as Response);
        });
    });
});
