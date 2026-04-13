/**
 * Tests for task status dropdown in MarkdownReviewEditor.
 */
/* @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import React from 'react';
import { MarkdownReviewEditor, parseFrontmatterStatus } from '../../../src/server/spa/client/react/shared/MarkdownReviewEditor';

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
vi.mock('@plusplusoneplusplus/forge/editor/anchor', () => ({
    createAnchorData: vi.fn(() => ({ text: '', prefixLines: [], suffixLines: [] })),
    DEFAULT_ANCHOR_MATCH_CONFIG: {},
}));

/* ── Mock extractDocumentContext ── */
vi.mock('../../../src/server/spa/client/react/utils/document-context', () => ({
    extractDocumentContext: vi.fn(() => ({ surroundingLines: '', nearestHeading: null, allHeadings: [] })),
}));

/* ── Mock useGlobalToast ── */
const mockAddToast = vi.fn();
vi.mock('../../../src/server/spa/client/react/context/ToastContext', () => ({
    useGlobalToast: () => ({ addToast: mockAddToast, removeToast: vi.fn(), toasts: [] }),
}));

/* ── Mock useApp ── */
vi.mock('../../../src/server/spa/client/react/context/AppContext', () => ({
    useApp: () => ({ state: { workspaces: [] }, dispatch: vi.fn() }),
}));

vi.mock('../../../src/server/spa/client/react/context/QueueContext', () => ({
    useQueue: () => ({ state: {}, dispatch: vi.fn() }),
}));

function mockJsonResponse(body: any, ok = true, status = 200): Response {
    return {
        ok,
        status,
        json: async () => body,
        text: async () => JSON.stringify(body),
    } as any;
}

describe('parseFrontmatterStatus', () => {
    it('extracts status from frontmatter', () => {
        expect(parseFrontmatterStatus('---\nstatus: pending\n---\n# Title')).toBe('pending');
    });

    it('extracts in-progress status', () => {
        expect(parseFrontmatterStatus('---\ntitle: Test\nstatus: in-progress\n---\n')).toBe('in-progress');
    });

    it('returns undefined when no frontmatter', () => {
        expect(parseFrontmatterStatus('# Just a heading')).toBeUndefined();
    });

    it('returns undefined when frontmatter has no status', () => {
        expect(parseFrontmatterStatus('---\ntitle: Test\n---\n# Title')).toBeUndefined();
    });

    it('trims whitespace from status value', () => {
        expect(parseFrontmatterStatus('---\nstatus:   done  \n---\n')).toBe('done');
    });

    it('handles \\r\\n line endings', () => {
        expect(parseFrontmatterStatus('---\r\nstatus: future\r\n---\r\n# Title')).toBe('future');
    });
});

describe('MarkdownReviewEditor – task status dropdown', () => {
    let fetchSpy: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        fetchSpy = vi.fn();
        (global as any).fetch = fetchSpy;
        mockAddToast.mockReset();
        Element.prototype.scrollTo = vi.fn();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    function setupFetch(content: string) {
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
    }

    it('renders status dropdown when fetchMode is tasks', async () => {
        setupFetch('---\nstatus: pending\n---\n# Task');

        render(
            <MarkdownReviewEditor wsId="ws1" filePath="task.md" fetchMode="tasks" />
        );

        await waitFor(() => {
            const select = screen.getByTestId('task-status-select') as HTMLSelectElement;
            expect(select.value).toBe('pending');
        });
    });

    it('renders status dropdown for .md files even when fetchMode is auto', async () => {
        setupFetch('---\nstatus: pending\n---\n# Task');

        render(
            <MarkdownReviewEditor wsId="ws1" filePath="task.md" fetchMode="auto" />
        );

        await waitFor(() => {
            const select = screen.getByTestId('task-status-select') as HTMLSelectElement;
            expect(select.value).toBe('pending');
        });
    });

    it('shows placeholder when no status in frontmatter', async () => {
        setupFetch('# No frontmatter');

        render(
            <MarkdownReviewEditor wsId="ws1" filePath="task.md" fetchMode="tasks" />
        );

        await waitFor(() => {
            expect(screen.getByTestId('task-status-select')).toBeTruthy();
        });

        const select = screen.getByTestId('task-status-select') as HTMLSelectElement;
        expect(select.value).toBe('');
    });

    it('renders all four status options', async () => {
        setupFetch('---\nstatus: done\n---\n# Task');

        render(
            <MarkdownReviewEditor wsId="ws1" filePath="task.md" fetchMode="tasks" />
        );

        await waitFor(() => {
            expect(screen.getByTestId('task-status-select')).toBeTruthy();
        });

        const select = screen.getByTestId('task-status-select') as HTMLSelectElement;
        const options = Array.from(select.options);
        const values = options.map(o => o.value).filter(v => v !== '');
        expect(values).toEqual(['pending', 'in-progress', 'done', 'future']);
    });

    it('calls PATCH API on status change (optimistic update)', async () => {
        setupFetch('---\nstatus: pending\n---\n# Task');

        render(
            <MarkdownReviewEditor wsId="ws1" filePath="task.md" fetchMode="tasks" />
        );

        await waitFor(() => {
            expect(screen.getByTestId('task-status-select')).toBeTruthy();
        });

        const select = screen.getByTestId('task-status-select') as HTMLSelectElement;

        await act(async () => {
            fireEvent.change(select, { target: { value: 'done' } });
        });

        // Optimistic: UI updates immediately
        expect(select.value).toBe('done');

        // Verify the PATCH call was made
        const patchCall = fetchSpy.mock.calls.find(
            ([url, opts]: [string, RequestInit]) =>
                typeof url === 'string' &&
                url.includes('/workspaces/ws1/tasks') &&
                !url.includes('/tasks/content') &&
                !url.includes('/tasks/comments') &&
                opts?.method === 'PATCH'
        );
        expect(patchCall).toBeTruthy();
        const body = JSON.parse(patchCall![1].body as string);
        expect(body).toEqual({ path: 'task.md', status: 'done' });
    });

    it('rolls back status and shows toast on API failure', async () => {
        setupFetch('---\nstatus: pending\n---\n# Task');

        render(
            <MarkdownReviewEditor wsId="ws1" filePath="task.md" fetchMode="tasks" />
        );

        await waitFor(() => {
            expect(screen.getByTestId('task-status-select')).toBeTruthy();
        });

        // Make the PATCH call fail
        fetchSpy.mockImplementation((input: RequestInfo | URL, opts?: RequestInit) => {
            const url = String(input);
            if (opts?.method === 'PATCH' && url.includes('/workspaces/') && !url.includes('/tasks/content')) {
                return Promise.resolve(mockJsonResponse({ error: 'fail' }, false, 500));
            }
            if (url.includes('/tasks/content?')) {
                return Promise.resolve(mockJsonResponse({ content: '---\nstatus: pending\n---\n# Task' }));
            }
            if (url.includes('/comment-counts/')) {
                return Promise.resolve(mockJsonResponse({ counts: {} }));
            }
            if (url.includes('/comments/')) {
                return Promise.resolve(mockJsonResponse({ comments: [] }));
            }
            return Promise.resolve(mockJsonResponse({}));
        });

        const select = screen.getByTestId('task-status-select') as HTMLSelectElement;

        await act(async () => {
            fireEvent.change(select, { target: { value: 'done' } });
        });

        // Wait for the API call to resolve and rollback
        await waitFor(() => {
            expect(select.value).toBe('pending');
        });

        expect(mockAddToast).toHaveBeenCalledWith('Failed to update status', 'error');
    });

    it('dispatches tasks-changed event on successful update', async () => {
        setupFetch('---\nstatus: pending\n---\n# Task');

        render(
            <MarkdownReviewEditor wsId="ws1" filePath="task.md" fetchMode="tasks" />
        );

        await waitFor(() => {
            expect(screen.getByTestId('task-status-select')).toBeTruthy();
        });

        const eventSpy = vi.fn();
        window.addEventListener('tasks-changed', eventSpy);

        // Make the PATCH succeed
        fetchSpy.mockImplementation((input: RequestInfo | URL, opts?: RequestInit) => {
            const url = String(input);
            if (opts?.method === 'PATCH' && url.includes('/workspaces/') && !url.includes('/tasks/content')) {
                return Promise.resolve(mockJsonResponse({ path: 'task.md', status: 'done' }));
            }
            if (url.includes('/tasks/content?')) {
                return Promise.resolve(mockJsonResponse({ content: '---\nstatus: pending\n---\n# Task' }));
            }
            if (url.includes('/comment-counts/')) {
                return Promise.resolve(mockJsonResponse({ counts: {} }));
            }
            if (url.includes('/comments/')) {
                return Promise.resolve(mockJsonResponse({ comments: [] }));
            }
            return Promise.resolve(mockJsonResponse({}));
        });

        const select = screen.getByTestId('task-status-select') as HTMLSelectElement;

        await act(async () => {
            fireEvent.change(select, { target: { value: 'done' } });
        });

        await waitFor(() => {
            expect(eventSpy).toHaveBeenCalled();
        });

        window.removeEventListener('tasks-changed', eventSpy);
    });

    it('syncs status when rawContent changes', async () => {
        setupFetch('---\nstatus: pending\n---\n# Task');

        const { rerender } = render(
            <MarkdownReviewEditor wsId="ws1" filePath="task.md" fetchMode="tasks" />
        );

        await waitFor(() => {
            const select = screen.getByTestId('task-status-select') as HTMLSelectElement;
            expect(select.value).toBe('pending');
        });

        // Now change the file path to trigger a reload with different status
        setupFetch('---\nstatus: done\n---\n# Other Task');

        rerender(
            <MarkdownReviewEditor wsId="ws1" filePath="other-task.md" fetchMode="tasks" />
        );

        await waitFor(() => {
            const select = screen.getByTestId('task-status-select') as HTMLSelectElement;
            expect(select.value).toBe('done');
        });
    });
});
