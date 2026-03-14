/**
 * Tests for CommitDetail — diff comment integration.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

// --- Module mocks (hoisted by Vitest) ---

const mockAddComment = vi.fn();
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

// Mock UnifiedDiffViewer to expose controllable callback triggers
vi.mock('../../../../src/server/spa/client/react/repos/UnifiedDiffViewer', () => ({
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
}));

import { CommitDetail } from '../../../../src/server/spa/client/react/repos/CommitDetail';

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
        resolving: false,
        resolvingCommentId: null,
        refresh: vi.fn(),
        ...overrides,
    };
}

describe('CommitDetail — comment integration', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockAddComment.mockResolvedValue({ id: 'new-c' });
        mockUseDiffComments.mockReturnValue(makeHook());
    });

    async function renderDetail(props: Record<string, unknown> = {}) {
        await act(async () => {
            render(<CommitDetail workspaceId="ws1" hash="abc123" {...(props as any)} />);
        });
    }

    // 1. No sidebar by default
    it('renders without sidebar by default', async () => {
        await renderDetail({ filePath: 'src/foo.ts' });
        expect(screen.queryByTestId('comment-sidebar')).toBeNull();
    });

    // 2. Sidebar toggle shows sidebar
    it('clicking toggle button shows comment sidebar', async () => {
        await renderDetail({ filePath: 'src/foo.ts' });
        fireEvent.click(screen.getByTestId('toggle-comments-btn'));
        expect(screen.getByTestId('comment-sidebar')).toBeTruthy();
    });

    // 2b. Sidebar toggle hides sidebar on second click
    it('clicking toggle button again hides comment sidebar', async () => {
        await renderDetail({ filePath: 'src/foo.ts' });
        const btn = screen.getByTestId('toggle-comments-btn');
        fireEvent.click(btn);
        expect(screen.getByTestId('comment-sidebar')).toBeTruthy();
        fireEvent.click(btn);
        expect(screen.queryByTestId('comment-sidebar')).toBeNull();
    });

    // Toggle button is present even when filePath is absent (commit-level comments)
    it('toggle button is present when filePath is absent', async () => {
        await renderDetail({});
        expect(screen.queryByTestId('toggle-comments-btn')).toBeTruthy();
    });

    // 3. Popup appears when onAddComment fires
    it('popup appears when UnifiedDiffViewer fires onAddComment', async () => {
        await renderDetail({ filePath: 'src/foo.ts' });
        const trigger = await screen.findByTestId('trigger-add-comment');
        await act(async () => { fireEvent.click(trigger); });
        expect(screen.getByTestId('inline-comment-popup')).toBeTruthy();
    });

    // 4. Popup submit calls addComment and closes popup
    it('popup submit calls addComment with correct args and closes popup', async () => {
        await renderDetail({ filePath: 'src/foo.ts' });
        const trigger = await screen.findByTestId('trigger-add-comment');
        await act(async () => { fireEvent.click(trigger); });

        const textarea = screen.getByTestId('comment-textarea');
        fireEvent.change(textarea, { target: { value: 'my comment' } });
        await act(async () => {
            fireEvent.click(screen.getByText(/Submit/));
        });

        expect(mockAddComment).toHaveBeenCalledWith(
            expect.objectContaining({ diffLineStart: 0 }),
            'selected text',
            'my comment',
            'general',
        );
        await waitFor(() => expect(screen.queryByTestId('inline-comment-popup')).toBeNull());
    });

    // 5. Popup cancel closes without saving
    it('popup cancel closes popup without calling addComment', async () => {
        await renderDetail({ filePath: 'src/foo.ts' });
        const trigger = await screen.findByTestId('trigger-add-comment');
        await act(async () => { fireEvent.click(trigger); });

        expect(screen.getByTestId('inline-comment-popup')).toBeTruthy();
        await act(async () => { fireEvent.click(screen.getByText('Cancel')); });
        expect(screen.queryByTestId('inline-comment-popup')).toBeNull();
        expect(mockAddComment).not.toHaveBeenCalled();
    });

    // 6. onCommentClick opens popover (not sidebar)
    it('onCommentClick opens popover at badge position', async () => {
        await renderDetail({ filePath: 'src/foo.ts' });
        expect(screen.queryByTestId('comment-popover')).toBeNull();
        const trigger = await screen.findByTestId('trigger-comment-click');
        await act(async () => { fireEvent.click(trigger); });
        expect(screen.getByTestId('comment-popover')).toBeTruthy();
    });

    // 6b. Popover close clears popover
    it('popover closes when onClose fires', async () => {
        await renderDetail({ filePath: 'src/foo.ts' });
        const trigger = await screen.findByTestId('trigger-comment-click');
        await act(async () => { fireEvent.click(trigger); });
        expect(screen.getByTestId('comment-popover')).toBeTruthy();
        const closeBtn = screen.getByTestId('popover-close');
        await act(async () => { fireEvent.click(closeBtn); });
        expect(screen.queryByTestId('comment-popover')).toBeNull();
    });

    // 6c. Popover shows comment body text
    it('popover shows comment body text', async () => {
        await renderDetail({ filePath: 'src/foo.ts' });
        const trigger = await screen.findByTestId('trigger-comment-click');
        await act(async () => { fireEvent.click(trigger); });
        expect(screen.getByTestId('popover-comment-body').textContent).toBe('test');
    });

    // 7. Comments are passed to UnifiedDiffViewer
    it('passes comments from useDiffComments to UnifiedDiffViewer', async () => {
        const twoComments = [
            { id: 'c1', context: {}, selection: { diffLineStart: 0, diffLineEnd: 0 }, comment: 'a', status: 'open', createdAt: '', updatedAt: '', selectedText: '' },
            { id: 'c2', context: {}, selection: { diffLineStart: 1, diffLineEnd: 1 }, comment: 'b', status: 'open', createdAt: '', updatedAt: '', selectedText: '' },
        ];
        mockUseDiffComments.mockReturnValue(makeHook({ comments: twoComments }));
        await renderDetail({ filePath: 'src/foo.ts' });
        const viewer = await screen.findByTestId('diff-content');
        expect(viewer.getAttribute('data-comment-count')).toBe('2');
    });
});
