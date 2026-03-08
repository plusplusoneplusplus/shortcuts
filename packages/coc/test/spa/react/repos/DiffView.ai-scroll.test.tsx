/**
 * Tests for AI wiring and sidebar click-to-scroll in diff views.
 *
 * Covers CommitDetail, BranchFileDiff, and WorkingTreeFileDiff.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

// --- Module mocks (hoisted by Vitest) ---

const mockAskAI = vi.fn().mockResolvedValue(undefined);
const mockClearAiError = vi.fn();
const mockUseDiffComments = vi.fn();

vi.mock('../../../../src/server/spa/client/react/hooks/useDiffComments', () => ({
    useDiffComments: (...args: any[]) => mockUseDiffComments(...args),
}));

vi.mock('../../../../src/server/spa/client/react/hooks/useApi', () => ({
    fetchApi: () => Promise.resolve({ diff: '+added line\n context' }),
}));

vi.mock('react-dom', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-dom')>();
    return { ...actual, createPortal: (children: React.ReactNode) => children };
});

vi.mock('../../../../src/server/spa/client/react/hooks/useBreakpoint', () => ({
    useBreakpoint: () => ({ isMobile: false }),
}));

// Mock UnifiedDiffViewer — renders a line element with data-diff-line-index for scroll targeting
vi.mock('../../../../src/server/spa/client/react/repos/UnifiedDiffViewer', () => ({
    UnifiedDiffViewer: ({ onAddComment, onCommentClick, comments, 'data-testid': testId }: any) => (
        <div data-testid={testId ?? 'mock-diff-viewer'} data-comment-count={String(comments?.length ?? 0)}>
            <div data-diff-line-index="5" data-testid="diff-line-5">line 5</div>
            <div data-diff-line-index="10" data-testid="diff-line-10">line 10</div>
            <button
                data-testid="trigger-comment-click"
                onClick={(e) => {
                    Object.defineProperty(e, 'currentTarget', {
                        value: { getBoundingClientRect: () => ({ top: 50, bottom: 70, left: 100, right: 200, width: 100, height: 20 }) },
                    });
                    onCommentClick?.({ id: 'c1', context: {}, selection: { diffLineStart: 5, diffLineEnd: 5 }, comment: 'test', status: 'open', createdAt: '', updatedAt: '', selectedText: '' }, e);
                }}
            >Click Comment</button>
        </div>
    ),
    HunkNavButtons: () => null,
}));

// Mock TruncatedPath (used in BranchFileDiff)
vi.mock('../../../../src/server/spa/client/react/shared', async (importOriginal) => {
    const actual = await importOriginal<Record<string, unknown>>();
    return {
        ...actual,
        TruncatedPath: ({ path, className }: { path: string; className?: string }) => (
            <span className={className}>{path}</span>
        ),
    };
});

import { CommitDetail } from '../../../../src/server/spa/client/react/repos/CommitDetail';
import { BranchFileDiff } from '../../../../src/server/spa/client/react/repos/BranchFileDiff';
import { WorkingTreeFileDiff } from '../../../../src/server/spa/client/react/repos/WorkingTreeFileDiff';

function makeHook(overrides: Record<string, unknown> = {}) {
    return {
        comments: [
            { id: 'c1', context: {}, selection: { diffLineStart: 5, diffLineEnd: 5 }, comment: 'test comment', status: 'open', createdAt: '', updatedAt: '', selectedText: 'foo' },
        ],
        loading: false,
        error: null,
        isEphemeral: false,
        addComment: vi.fn().mockResolvedValue({ id: 'new-c' }),
        updateComment: vi.fn().mockResolvedValue({}),
        deleteComment: vi.fn().mockResolvedValue(undefined),
        resolveComment: vi.fn().mockResolvedValue({}),
        unresolveComment: vi.fn().mockResolvedValue({}),
        askAI: mockAskAI,
        aiLoadingIds: new Set<string>(),
        aiErrors: new Map<string, string>(),
        clearAiError: mockClearAiError,
        resolving: false,
        resolvingCommentId: null,
        refresh: vi.fn(),
        runRelocation: vi.fn(),
        ...overrides,
    };
}

// ============================================================================
// CommitDetail — AI + Scroll
// ============================================================================

describe('CommitDetail — AI wiring and scroll', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockUseDiffComments.mockReturnValue(makeHook());
    });

    async function renderComponent() {
        await act(async () => {
            render(<CommitDetail workspaceId="ws1" hash="abc123" filePath="src/foo.ts" />);
        });
    }

    it('passes aiLoadingIds and aiErrors to CommentSidebar', async () => {
        const loadingIds = new Set(['c1']);
        const errors = new Map([['c1', 'AI failed']]);
        mockUseDiffComments.mockReturnValue(makeHook({ aiLoadingIds: loadingIds, aiErrors: errors }));
        await renderComponent();
        fireEvent.click(screen.getByTestId('toggle-comments-btn'));
        const sidebar = screen.getByTestId('comment-sidebar');
        expect(sidebar).toBeTruthy();
        // CommentCard shows an AI error banner when aiError is set
        expect(screen.getByTestId('ai-error-banner')).toBeTruthy();
    });

    it('passes aiLoading and aiError to CommentPopover', async () => {
        const loadingIds = new Set(['c1']);
        const errors = new Map([['c1', 'AI failed']]);
        mockUseDiffComments.mockReturnValue(makeHook({ aiLoadingIds: loadingIds, aiErrors: errors }));
        await renderComponent();
        const trigger = await screen.findByTestId('trigger-comment-click');
        await act(async () => { fireEvent.click(trigger); });
        expect(screen.getByTestId('comment-popover')).toBeTruthy();
    });

    it('sidebar onCommentClick scrolls to the diff line element', async () => {
        await renderComponent();
        fireEvent.click(screen.getByTestId('toggle-comments-btn'));
        const card = screen.getByTestId('comment-card-c1');
        expect(card).toBeTruthy();

        // Mock scrollIntoView on the target diff line element
        const lineEl = screen.getByTestId('diff-line-5');
        lineEl.scrollIntoView = vi.fn();

        await act(async () => { fireEvent.click(card); });

        expect(lineEl.scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'center' });
    });

    it('sidebar onCommentClick adds and removes highlight ring', async () => {
        vi.useFakeTimers();
        await renderComponent();
        fireEvent.click(screen.getByTestId('toggle-comments-btn'));

        const card = screen.getByTestId('comment-card-c1');
        const lineEl = screen.getByTestId('diff-line-5');
        lineEl.scrollIntoView = vi.fn();

        await act(async () => { fireEvent.click(card); });

        expect(lineEl.classList.contains('ring-2')).toBe(true);
        expect(lineEl.classList.contains('ring-yellow-400')).toBe(true);

        await act(async () => { vi.advanceTimersByTime(1500); });

        expect(lineEl.classList.contains('ring-2')).toBe(false);
        expect(lineEl.classList.contains('ring-yellow-400')).toBe(false);
        vi.useRealTimers();
    });
});

// ============================================================================
// BranchFileDiff — AI + Scroll
// ============================================================================

describe('BranchFileDiff — AI wiring and scroll', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockUseDiffComments.mockReturnValue(makeHook());
    });

    async function renderComponent() {
        await act(async () => {
            render(<BranchFileDiff workspaceId="ws1" filePath="src/foo.ts" />);
        });
    }

    it('passes aiLoadingIds and aiErrors to CommentSidebar', async () => {
        const loadingIds = new Set(['c1']);
        const errors = new Map([['c1', 'AI failed']]);
        mockUseDiffComments.mockReturnValue(makeHook({ aiLoadingIds: loadingIds, aiErrors: errors }));
        await renderComponent();
        fireEvent.click(screen.getByTestId('toggle-comments-btn'));
        expect(screen.getByTestId('comment-sidebar')).toBeTruthy();
        expect(screen.getByTestId('ai-error-banner')).toBeTruthy();
    });

    it('passes aiLoading and aiError to CommentPopover', async () => {
        const loadingIds = new Set(['c1']);
        const errors = new Map([['c1', 'AI failed']]);
        mockUseDiffComments.mockReturnValue(makeHook({ aiLoadingIds: loadingIds, aiErrors: errors }));
        await renderComponent();
        const trigger = await screen.findByTestId('trigger-comment-click');
        await act(async () => { fireEvent.click(trigger); });
        expect(screen.getByTestId('comment-popover')).toBeTruthy();
    });

    it('sidebar onCommentClick scrolls to the diff line element', async () => {
        await renderComponent();
        fireEvent.click(screen.getByTestId('toggle-comments-btn'));
        const card = screen.getByTestId('comment-card-c1');

        const lineEl = screen.getByTestId('diff-line-5');
        lineEl.scrollIntoView = vi.fn();

        await act(async () => { fireEvent.click(card); });

        expect(lineEl.scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'center' });
    });

    it('sidebar onCommentClick adds and removes highlight ring', async () => {
        vi.useFakeTimers();
        await renderComponent();
        fireEvent.click(screen.getByTestId('toggle-comments-btn'));

        const card = screen.getByTestId('comment-card-c1');
        const lineEl = screen.getByTestId('diff-line-5');
        lineEl.scrollIntoView = vi.fn();

        await act(async () => { fireEvent.click(card); });

        expect(lineEl.classList.contains('ring-2')).toBe(true);

        await act(async () => { vi.advanceTimersByTime(1500); });

        expect(lineEl.classList.contains('ring-2')).toBe(false);
        vi.useRealTimers();
    });
});

// ============================================================================
// WorkingTreeFileDiff — AI + Scroll
// ============================================================================

describe('WorkingTreeFileDiff — AI wiring and scroll', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockUseDiffComments.mockReturnValue(makeHook());
    });

    async function renderComponent() {
        await act(async () => {
            render(<WorkingTreeFileDiff workspaceId="ws1" filePath="src/foo.ts" stage="staged" />);
        });
    }

    it('passes aiLoadingIds and aiErrors to CommentSidebar', async () => {
        const loadingIds = new Set(['c1']);
        const errors = new Map([['c1', 'AI failed']]);
        mockUseDiffComments.mockReturnValue(makeHook({ aiLoadingIds: loadingIds, aiErrors: errors }));
        await renderComponent();
        fireEvent.click(screen.getByTestId('toggle-comments-btn'));
        expect(screen.getByTestId('comment-sidebar')).toBeTruthy();
        expect(screen.getByTestId('ai-error-banner')).toBeTruthy();
    });

    it('passes aiLoading and aiError to CommentPopover', async () => {
        const loadingIds = new Set(['c1']);
        const errors = new Map([['c1', 'AI failed']]);
        mockUseDiffComments.mockReturnValue(makeHook({ aiLoadingIds: loadingIds, aiErrors: errors }));
        await renderComponent();
        const trigger = await screen.findByTestId('trigger-comment-click');
        await act(async () => { fireEvent.click(trigger); });
        expect(screen.getByTestId('comment-popover')).toBeTruthy();
    });

    it('sidebar onCommentClick scrolls to the diff line element', async () => {
        await renderComponent();
        fireEvent.click(screen.getByTestId('toggle-comments-btn'));
        const card = screen.getByTestId('comment-card-c1');

        const lineEl = screen.getByTestId('diff-line-5');
        lineEl.scrollIntoView = vi.fn();

        await act(async () => { fireEvent.click(card); });

        expect(lineEl.scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'center' });
    });

    it('sidebar onCommentClick adds and removes highlight ring', async () => {
        vi.useFakeTimers();
        await renderComponent();
        fireEvent.click(screen.getByTestId('toggle-comments-btn'));

        const card = screen.getByTestId('comment-card-c1');
        const lineEl = screen.getByTestId('diff-line-5');
        lineEl.scrollIntoView = vi.fn();

        await act(async () => { fireEvent.click(card); });

        expect(lineEl.classList.contains('ring-2')).toBe(true);

        await act(async () => { vi.advanceTimersByTime(1500); });

        expect(lineEl.classList.contains('ring-2')).toBe(false);
        vi.useRealTimers();
    });
});
