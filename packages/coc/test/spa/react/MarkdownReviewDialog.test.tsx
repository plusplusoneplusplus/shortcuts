/**
 * Tests for MarkdownReviewDialog minimize feature.
 */
/* @vitest-environment jsdom */

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act, cleanup } from '@testing-library/react';
import { MarkdownReviewDialog } from '../../../src/server/spa/client/react/processes/MarkdownReviewDialog';

/* ── Mocks required by MarkdownReviewEditor (used inside the dialog) ── */

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

vi.mock('../../../src/server/spa/client/react/hooks/useMarkdownPreview', () => ({
    useMarkdownPreview: ({ content }: { content: string }) => ({
        html: content ? `<p>${content}</p>` : '',
    }),
}));

vi.mock('@plusplusoneplusplus/pipeline-core/editor/anchor', () => ({
    createAnchorData: vi.fn(),
    DEFAULT_ANCHOR_MATCH_CONFIG: {},
}));

vi.mock('../../../src/server/spa/client/react/utils/document-context', () => ({
    extractDocumentContext: vi.fn(() => ({ surroundingLines: '', nearestHeading: null, allHeadings: [] })),
}));

vi.mock('../../../src/server/spa/client/react/context/ToastContext', () => ({
    useGlobalToast: () => ({ addToast: vi.fn(), removeToast: vi.fn(), toasts: [] }),
}));

vi.mock('../../../src/server/spa/client/react/shared/SourceEditor', () => ({
    SourceEditor: ({ content, onChange }: { content: string; onChange: (v: string) => void }) => (
        <textarea data-testid="source-editor" value={content} onChange={(e) => onChange(e.target.value)} />
    ),
}));

vi.mock('../../../src/server/spa/client/react/utils/config', () => ({
    getApiBase: () => '',
}));

function setupFetch(content = '# Hello') {
    const fetchSpy = vi.fn().mockImplementation((input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/tasks/content') || url.includes('/files/preview')) {
            return Promise.resolve({
                ok: true,
                status: 200,
                json: async () => ({ content }),
                text: async () => JSON.stringify({ content }),
            } as Response);
        }
        return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({ comments: [] }),
            text: async () => '{}',
        } as Response);
    });
    (global as any).fetch = fetchSpy;
    return fetchSpy;
}

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

describe('MarkdownReviewDialog', () => {
    beforeEach(() => {
        setupFetch();
    });

    it('renders nothing when open=false', () => {
        const { container } = render(
            <MarkdownReviewDialog
                open={false}
                onClose={vi.fn()}
                wsId="ws1"
                filePath="test.md"
                displayPath="/workspace/test.md"
                fetchMode="tasks"
            />
        );
        expect(container.innerHTML).toBe('');
    });

    it('renders nothing when wsId is null', () => {
        const { container } = render(
            <MarkdownReviewDialog
                open={true}
                onClose={vi.fn()}
                wsId={null}
                filePath="test.md"
                displayPath="/workspace/test.md"
                fetchMode="tasks"
            />
        );
        expect(container.innerHTML).toBe('');
    });

    it('renders nothing when filePath is null', () => {
        const { container } = render(
            <MarkdownReviewDialog
                open={true}
                onClose={vi.fn()}
                wsId="ws1"
                filePath={null}
                displayPath={null}
                fetchMode="tasks"
            />
        );
        expect(container.innerHTML).toBe('');
    });

    it('shows the file title when open', async () => {
        render(
            <MarkdownReviewDialog
                open={true}
                onClose={vi.fn()}
                wsId="ws1"
                filePath="plan.md"
                displayPath="/workspace/.vscode/tasks/coc/plan.md"
                fetchMode="tasks"
            />
        );
        // title should be the basename
        expect(document.body.textContent).toContain('plan.md');
    });

    it('renders minimize button when onMinimize is provided', () => {
        render(
            <MarkdownReviewDialog
                open={true}
                onClose={vi.fn()}
                onMinimize={vi.fn()}
                wsId="ws1"
                filePath="test.md"
                displayPath="/workspace/test.md"
                fetchMode="tasks"
            />
        );
        const btn = document.querySelector('[data-testid="markdown-review-minimize-btn"]');
        expect(btn).not.toBeNull();
        expect(btn!.getAttribute('aria-label')).toBe('Minimize');
    });

    it('does not render minimize button when onMinimize is not provided', () => {
        render(
            <MarkdownReviewDialog
                open={true}
                onClose={vi.fn()}
                wsId="ws1"
                filePath="test.md"
                displayPath="/workspace/test.md"
                fetchMode="tasks"
            />
        );
        const btn = document.querySelector('[data-testid="markdown-review-minimize-btn"]');
        expect(btn).toBeNull();
    });

    it('clicking minimize button calls onMinimize with a number', async () => {
        const onMinimize = vi.fn();
        render(
            <MarkdownReviewDialog
                open={true}
                onClose={vi.fn()}
                onMinimize={onMinimize}
                wsId="ws1"
                filePath="test.md"
                displayPath="/workspace/test.md"
                fetchMode="tasks"
            />
        );
        const btn = document.querySelector('[data-testid="markdown-review-minimize-btn"]') as HTMLElement;
        fireEvent.click(btn);
        expect(onMinimize).toHaveBeenCalledOnce();
        expect(typeof onMinimize.mock.calls[0][0]).toBe('number');
    });

    it('onMinimize receives scrollTop=0 by default (no scrolling occurred)', () => {
        const onMinimize = vi.fn();
        render(
            <MarkdownReviewDialog
                open={true}
                onClose={vi.fn()}
                onMinimize={onMinimize}
                wsId="ws1"
                filePath="test.md"
                displayPath="/workspace/test.md"
                fetchMode="tasks"
            />
        );
        const btn = document.querySelector('[data-testid="markdown-review-minimize-btn"]') as HTMLElement;
        fireEvent.click(btn);
        expect(onMinimize).toHaveBeenCalledWith(0);
    });

    it('clicking close button calls onClose', () => {
        const onClose = vi.fn();
        render(
            <MarkdownReviewDialog
                open={true}
                onClose={onClose}
                wsId="ws1"
                filePath="test.md"
                displayPath="/workspace/test.md"
                fetchMode="tasks"
            />
        );
        // Find the close button (aria-label="Close")
        const closeBtn = document.querySelector('[aria-label="Close"]') as HTMLElement;
        fireEvent.click(closeBtn);
        expect(onClose).toHaveBeenCalledOnce();
    });

    it('close button does not call onMinimize', () => {
        const onMinimize = vi.fn();
        const onClose = vi.fn();
        render(
            <MarkdownReviewDialog
                open={true}
                onClose={onClose}
                onMinimize={onMinimize}
                wsId="ws1"
                filePath="test.md"
                displayPath="/workspace/test.md"
                fetchMode="tasks"
            />
        );
        const closeBtn = document.querySelector('[aria-label="Close"]') as HTMLElement;
        fireEvent.click(closeBtn);
        expect(onClose).toHaveBeenCalledOnce();
        expect(onMinimize).not.toHaveBeenCalled();
    });

    it('Escape key closes instead of minimizing when onMinimize is provided', () => {
        const onClose = vi.fn();
        const onMinimize = vi.fn();
        render(
            <MarkdownReviewDialog
                open={true}
                onClose={onClose}
                onMinimize={onMinimize}
                wsId="ws1"
                filePath="test.md"
                displayPath="/workspace/test.md"
                fetchMode="tasks"
            />
        );
        fireEvent.keyDown(document, { key: 'Escape' });
        expect(onClose).toHaveBeenCalledOnce();
        expect(onMinimize).not.toHaveBeenCalled();
    });

    it('Escape key calls onClose when onMinimize is not provided', () => {
        const onClose = vi.fn();
        render(
            <MarkdownReviewDialog
                open={true}
                onClose={onClose}
                wsId="ws1"
                filePath="test.md"
                displayPath="/workspace/test.md"
                fetchMode="tasks"
            />
        );
        fireEvent.keyDown(document, { key: 'Escape' });
        expect(onClose).toHaveBeenCalledOnce();
    });
});
