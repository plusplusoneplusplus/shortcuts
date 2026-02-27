/**
 * Tests for TaskPreview — verifies the close button is rendered inside the
 * MarkdownReviewEditor toolbar (compacted layout, no separate header row).
 */
/* @vitest-environment jsdom */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import React from 'react';
import type { ReactNode } from 'react';
import { AppProvider } from '../../../src/server/spa/client/react/context/AppContext';
import { QueueProvider } from '../../../src/server/spa/client/react/context/QueueContext';
import { ToastProvider } from '../../../src/server/spa/client/react/context/ToastContext';
import { TaskProvider } from '../../../src/server/spa/client/react/context/TaskContext';
import { TaskPreview } from '../../../src/server/spa/client/react/tasks/TaskPreview';

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
    }),
}));

vi.mock('../../../src/server/spa/client/react/hooks/useMarkdownPreview', () => ({
    useMarkdownPreview: ({ content }: { content: string }) => ({
        html: content ? `<p>${content}</p>` : '',
    }),
}));

vi.mock('@plusplusoneplusplus/pipeline-core/editor/anchor', () => ({
    createAnchorData: vi.fn(() => ({ text: '', prefixLines: [], suffixLines: [] })),
    DEFAULT_ANCHOR_MATCH_CONFIG: {},
}));

vi.mock('../../../src/server/spa/client/react/utils/document-context', () => ({
    extractDocumentContext: vi.fn(() => ({ surroundingLines: '', nearestHeading: null, allHeadings: [] })),
}));

function mockJsonResponse(body: any): Response {
    return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) } as any;
}

function Wrap({ children }: { children: ReactNode }) {
    return (
        <AppProvider>
            <QueueProvider>
                <ToastProvider value={{ addToast: vi.fn(), removeToast: vi.fn(), toasts: [] }}>
                    <TaskProvider>
                        {children}
                    </TaskProvider>
                </ToastProvider>
            </QueueProvider>
        </AppProvider>
    );
}

describe('TaskPreview', () => {
    beforeEach(() => {
        (global as any).fetch = vi.fn().mockImplementation((input: RequestInfo | URL) => {
            const url = String(input);
            if (url.includes('/tasks/content?')) return Promise.resolve(mockJsonResponse({ content: '# Title' }));
            if (url.includes('/comment-counts/')) return Promise.resolve(mockJsonResponse({ counts: {} }));
            if (url.includes('/comments/')) return Promise.resolve(mockJsonResponse({ comments: [] }));
            return Promise.resolve(mockJsonResponse({}));
        });
    });

    afterEach(() => { vi.restoreAllMocks(); });

    it('renders close button inside the mode-toggle toolbar', async () => {
        render(<Wrap><TaskPreview wsId="ws1" filePath="test.md" /></Wrap>);
        await waitFor(() => { expect(document.querySelector('#task-preview-body')).toBeTruthy(); });

        const closeBtn = screen.getByTestId('task-preview-close');
        expect(closeBtn).toBeTruthy();
        // Close button should be inside the .mode-toggle bar (compacted layout)
        expect(closeBtn.closest('.mode-toggle')).toBeTruthy();
    });

    it('does not render a separate header row with border', async () => {
        const { container } = render(<Wrap><TaskPreview wsId="ws1" filePath="test.md" /></Wrap>);
        await waitFor(() => { expect(document.querySelector('#task-preview-body')).toBeTruthy(); });

        const outerCol = container.querySelector('.flex.flex-col');
        expect(outerCol).toBeTruthy();
        const firstChild = outerCol!.children[0];
        expect(firstChild.className).not.toContain('border-b');
    });

    it('opens in source mode when initialViewMode is "source"', async () => {
        render(<Wrap><TaskPreview wsId="ws1" filePath="test.md" initialViewMode="source" /></Wrap>);
        await waitFor(() => { expect(screen.getByText('Source')).toBeTruthy(); });
        expect(screen.getByText('Source').className).toContain('active');
        expect(screen.getByText('Preview').className).not.toContain('active');
    });

    it('updates URL hash with ?mode=source when switching to source', async () => {
        const replaceSpy = vi.spyOn(history, 'replaceState');
        location.hash = '#repos/ws1/tasks/test.md';
        render(<Wrap><TaskPreview wsId="ws1" filePath="test.md" /></Wrap>);
        await waitFor(() => { expect(document.querySelector('#task-preview-body')).toBeTruthy(); });

        await act(async () => { fireEvent.click(screen.getByText('Source')); });
        expect(replaceSpy).toHaveBeenCalledWith(null, '', '#repos/ws1/tasks/test.md?mode=source');
    });

    it('removes ?mode param when switching back to preview', async () => {
        const replaceSpy = vi.spyOn(history, 'replaceState');
        location.hash = '#repos/ws1/tasks/test.md?mode=source';
        render(<Wrap><TaskPreview wsId="ws1" filePath="test.md" initialViewMode="source" /></Wrap>);
        await waitFor(() => { expect(screen.getByText('Source')).toBeTruthy(); });

        await act(async () => { fireEvent.click(screen.getByText('Preview')); });
        expect(replaceSpy).toHaveBeenCalledWith(null, '', '#repos/ws1/tasks/test.md');
    });
});
