/**
 * Tests for CommitDetail — diff comment integration.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

// --- Module mocks (hoisted by Vitest) ---

const mockAddComment = vi.fn();
const mockUseDiffComments = vi.fn();
const mockFetchApi = vi.fn();
const mockUseAllCommitComments = vi.fn();

vi.mock('../../../../src/server/spa/client/react/features/git/hooks/useDiffComments', () => ({
    useDiffComments: (...args: any[]) => mockUseDiffComments(...args),
}));

vi.mock('../../../../src/server/spa/client/react/features/git/hooks/useAllCommitComments', () => ({
    useAllCommitComments: (...args: any[]) => mockUseAllCommitComments(...args),
}));

vi.mock('../../../../src/server/spa/client/react/hooks/useApi', () => ({
    fetchApi: (path: string, options?: RequestInit) => mockFetchApi(path, options),
}));

vi.mock('react-dom', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-dom')>();
    return { ...actual, createPortal: (children: React.ReactNode) => children };
});

vi.mock('../../../../src/server/spa/client/react/hooks/ui/useBreakpoint', () => ({
    useBreakpoint: () => ({ isMobile: false }),
}));

vi.mock('../../../../src/server/spa/client/react/contexts/QueueContext', () => ({
    useQueue: () => ({ state: { dialogLaunchMode: 'default', dialogMode: 'task' }, dispatch: vi.fn() }),
}));

// Mock UnifiedDiffViewer to expose controllable callback triggers
vi.mock('../../../../src/server/spa/client/react/features/git/diff/UnifiedDiffViewer', () => ({
    UnifiedDiffViewer: ({ onAddComment, onCommentClick, comments, 'data-testid': testId }: any) => (
        <div data-testid={testId ?? 'mock-diff-viewer'} data-comment-count={String(comments?.length ?? 0)}>
            <button
                data-testid="trigger-add-comment"
                onClick={() => onAddComment?.(
                    { diffLineStart: 0, diffLineEnd: 0, side: 'context', oldLineStart: 1, oldLineEnd: 1, newLineStart: 1, newLineEnd: 1, startColumn: 0, endColumn: 5 },
                    'selected text',
                    { top: 100, left: 200 },
                )}
            >Add Comment</button>
            <button
                data-testid="trigger-comment-click"
                onClick={(e) => {
                    // Simulate getBoundingClientRect on currentTarget for popover positioning
                    Object.defineProperty(e, 'currentTarget', {
                        value: { getBoundingClientRect: () => ({ top: 50, bottom: 70, left: 100, right: 200, width: 100, height: 20 }) },
                    });
                    onCommentClick?.({ id: 'c1', context: {}, selection: {}, comment: 'test', status: 'open', createdAt: '', updatedAt: '', selectedText: '' }, e);
                }}
            >Click Comment</button>
        </div>
    ),
    HunkNavButtons: () => null,
    parseDiffFileList: () => [],
}));

vi.mock('../../../../src/server/spa/client/react/features/git/diff/useClassification', () => ({
    useClassification: () => ({
        state: { status: 'idle', activeFilters: new Set(), error: undefined, result: undefined },
        classify: vi.fn(),
        toggleFilter: vi.fn(),
        setFilters: vi.fn(),
        isFileDimmed: () => false,
        getFileBadge: () => undefined,
        getHunkClassification: () => null,
        provider: 'copilot',
        setProvider: vi.fn(),
        model: undefined,
        setModel: vi.fn(),
    }),
}));

vi.mock('../../../../src/server/spa/client/react/hooks/useAgentProviders', () => ({
    useAgentProviders: () => ({
        providers: [{ id: 'copilot', label: 'Copilot', enabled: true, available: true, locked: true }],
        loading: false,
        error: null,
        reload: vi.fn(),
        copilot: { id: 'copilot', label: 'Copilot', enabled: true, available: true, locked: true },
        codex: undefined,
    }),
}));

vi.mock('../../../../src/server/spa/client/react/hooks/useModels', () => ({
    useModels: () => ({ models: [], loading: false, error: null, reload: vi.fn() }),
}));

vi.mock('../../../../src/server/spa/client/react/features/git/commits/CommitChatPanel', () => ({
    CommitChatPanel: () => null,
}));

import { CommitDetail }from '../../../../src/server/spa/client/react/features/git/commits/CommitDetail';

function makeHook(overrides: Record<string, unknown> = {}) {
    return {
        comments: [],
        loading: false,
        error: null,
        isEphemeral: false,
        addComment: mockAddComment,
        updateComment: vi.fn().mockResolvedValue({}),
        deleteComment: vi.fn().mockResolvedValue(undefined),
        resolveComment: vi.fn().mockResolvedValue({}),
        unresolveComment: vi.fn().mockResolvedValue({}),
        askAI: vi.fn(),
        aiLoadingIds: new Set(),
        aiErrors: new Map(),
        clearAiError: vi.fn(),
        copyAllCommentsAsPrompt: vi.fn(),
        resolvingIds: new Set(),
        deletingIds: new Set(),

        refresh: vi.fn(),
        ...overrides,
    };
}

function makeAllCommitHook(overrides: Record<string, unknown> = {}) {
    return {
        comments: [],
        loading: false,
        resolveComment: vi.fn().mockResolvedValue(undefined),
        unresolveComment: vi.fn().mockResolvedValue(undefined),
        deleteComment: vi.fn().mockResolvedValue(undefined),
        updateComment: vi.fn().mockResolvedValue(undefined),
        copyAllCommentsAsPrompt: vi.fn(),
        ...overrides,
    };
}

describe('CommitDetail — comment integration', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockAddComment.mockResolvedValue({ id: 'new-c' });
        mockUseDiffComments.mockReturnValue(makeHook());
        mockUseAllCommitComments.mockReturnValue(makeAllCommitHook());
        mockFetchApi.mockResolvedValue({ diff: '+added line\n context', comments: [] });
    });

    async function renderDetail(props: Record<string, unknown> = {}) {
        await act(async () => {
            render(<CommitDetail workspaceId="ws1" hash="abc123" {...(props as any)} />);
        });
    }

    // 1. No sidebar by default
    it('renders without sidebar by default', async () => {
        await renderDetail({});
        expect(screen.queryByTestId('comment-sidebar')).toBeNull();
    });

    // 2. Sidebar toggle shows sidebar (commit-level)
    it('clicking toggle button shows comment sidebar', async () => {
        await renderDetail({});
        fireEvent.click(screen.getByTestId('toggle-comments-btn'));
        expect(screen.getByTestId('comment-sidebar')).toBeTruthy();
    });

    // 2b. Sidebar toggle hides sidebar on second click
    it('clicking toggle button again hides comment sidebar', async () => {
        await renderDetail({});
        const btn = screen.getByTestId('toggle-comments-btn');
        fireEvent.click(btn);
        expect(screen.getByTestId('comment-sidebar')).toBeTruthy();
        fireEvent.click(btn);
        expect(screen.queryByTestId('comment-sidebar')).toBeNull();
    });

    // Toggle button is always present
    it('toggle button is present', async () => {
        await renderDetail({});
        expect(screen.queryByTestId('toggle-comments-btn')).toBeTruthy();
    });

    // Regression: commit-level comment fetch must not produce double /api prefix.
    it('commit-level comment fetch passes correct args to useAllCommitComments', async () => {
        await renderDetail({});
        expect(mockUseAllCommitComments).toHaveBeenCalledWith('ws1', 'abc123');
    });

    // Regression: onCopyPrompt wired to commit-level CommentSidebar
    it('passes copyAllCommentsAsPrompt as onCopyPrompt to the commit-level sidebar', async () => {
        const mockCopy = vi.fn();
        const openComment = { id: 'c1', context: { filePath: 'src/foo.ts' }, selection: { diffLineStart: 0, diffLineEnd: 0 }, comment: 'test', status: 'open', createdAt: '', updatedAt: '', selectedText: '' };
        mockUseAllCommitComments.mockReturnValue(
            makeAllCommitHook({ comments: [openComment], copyAllCommentsAsPrompt: mockCopy })
        );
        await renderDetail({});
        fireEvent.click(screen.getByTestId('toggle-comments-btn'));
        const copyBtn = await screen.findByTitle('Copy all comments as prompt');
        await act(async () => { fireEvent.click(copyBtn); });
        expect(mockCopy).toHaveBeenCalledTimes(1);
    });
});
