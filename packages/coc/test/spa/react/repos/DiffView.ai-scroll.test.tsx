/**
 * Tests for AI wiring and sidebar click-to-scroll in diff views.
 *
 * Covers CommitDetail, FileDiffPanel, and WorkingTreeFileDiff.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

// --- Module mocks (hoisted by Vitest) ---

const mockAskAI = vi.fn().mockResolvedValue(undefined);
const mockClearAiError = vi.fn();
const mockUseDiffComments = vi.fn();

vi.mock('../../../../src/server/spa/client/react/features/git/hooks/useDiffComments', () => ({
    useDiffComments: (...args: any[]) => mockUseDiffComments(...args),
}));

const DIFF_BODY = { diff: '+added line\n context' };

vi.mock('../../../../src/server/spa/client/react/hooks/useApi', () => ({
    fetchApi: () => Promise.resolve(DIFF_BODY),
}));

// AC-07: FileDiffPanel fetches diffs via requestForWorkspace (cloneRegistry →
// getCocClientFor + stub.request); WorkingTreeFileDiff uses
// useCocClient(ws).git.getWorkingTreeFileDiff. One stub serves both, resolved
// for the default origin (local workspace).
const cocStub = {
    git: {
        getWorkingTreeFileDiff: () => Promise.resolve(DIFF_BODY),
    },
    request: () => Promise.resolve(DIFF_BODY),
};

vi.mock('../../../../src/server/spa/client/react/api/cocClient', () => ({
    getSpaCocClient: () => cocStub,
    getCocClientFor: () => cocStub,
    toSpaCocRequestOptions: (opts?: unknown) => opts,
    translateSpaCocClientError: (e: unknown) => { throw e; },
}));

vi.mock('react-dom', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-dom')>();
    return { ...actual, createPortal: (children: React.ReactNode) => children };
});

vi.mock('../../../../src/server/spa/client/react/hooks/ui/useBreakpoint', () => ({
    useBreakpoint: () => ({ isMobile: false }),
}));

// Mock UnifiedDiffViewer — renders a line element with data-diff-line-index for scroll targeting
vi.mock('../../../../src/server/spa/client/react/features/git/diff/UnifiedDiffViewer', () => ({
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

// Mock TruncatedPath (used in FileDiffPanel)
vi.mock('../../../../src/server/spa/client/react/ui', async (importOriginal) => {
    const actual = await importOriginal<Record<string, unknown>>();
    return {
        ...actual,
        TruncatedPath: ({ path, className }: { path: string; className?: string }) => (
            <span className={className}>{path}</span>
        ),
    };
});

vi.mock('../../../../src/server/spa/client/react/contexts/QueueContext', () => ({
    useQueue: () => ({ state: { dialogLaunchMode: 'default', dialogMode: 'task' }, dispatch: vi.fn() }),
}));

import { FileDiffPanel } from '../../../../src/server/spa/client/react/features/git/diff/FileDiffPanel';
import { WorkingTreeFileDiff } from '../../../../src/server/spa/client/react/features/git/working-tree/WorkingTreeFileDiff';

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
        resolvingIds: new Set<string>(),
        deletingIds: new Set<string>(),

        refresh: vi.fn(),
        runRelocation: vi.fn(),
        ...overrides,
    };
}

// ============================================================================
// FileDiffPanel — AI + Scroll (branch-range source)
// ============================================================================

describe('FileDiffPanel — AI wiring and scroll', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockUseDiffComments.mockReturnValue(makeHook());
    });

    const branchSource = {
        label: 'Branch diff',
        fileDiffUrl: (fp: string) => `/workspaces/ws1/git/branch-range/files/${encodeURIComponent(fp)}/diff`,
        fullDiffUrl: () => null,
        commentContext: (fp: string) => ({ repositoryId: 'ws1', filePath: fp, oldRef: 'branch-base', newRef: 'branch-head' }),
        files: [],
        chat: null,
        supportsTruncation: true,
        cacheKey: 'branch-range',
    };

    async function renderComponent() {
        await act(async () => {
            render(<FileDiffPanel workspaceId="ws1" filePath="src/foo.ts" source={branchSource} />);
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
