/**
 * E2e smoke tests for CommitDetail diff commenting integration.
 *
 * Verifies that CommitDetail wires UnifiedDiffViewer, useDiffComments,
 * InlineCommentPopup, and CommentSidebar together with correct data-testid
 * attributes and callback flows.
 *
 * Uses source-level analysis for structural assertions and mocked rendering
 * for the key interaction flows.
 */

// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

// ============================================================================
// Source paths
// ============================================================================

const COMMIT_DETAIL_PATH = path.resolve(
    __dirname, '../../../src/server/spa/client/react/repos/CommitDetail.tsx'
);

// ============================================================================
// Module mocks (hoisted)
// ============================================================================

const mockAddComment = vi.fn();
const mockUseDiffComments = vi.fn();

vi.mock('../../../src/server/spa/client/react/hooks/useDiffComments', () => ({
    useDiffComments: (...args: any[]) => mockUseDiffComments(...args),
}));

vi.mock('../../../src/server/spa/client/react/hooks/useApi', () => ({
    fetchApi: () => Promise.resolve({ diff: '@@ -1,2 +1,3 @@\n ctx\n+added\n-removed\n ctx2' }),
}));

vi.mock('react-dom', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-dom')>();
    return { ...actual, createPortal: (children: React.ReactNode) => children };
});

vi.mock('../../../src/server/spa/client/react/hooks/useBreakpoint', () => ({
    useBreakpoint: () => ({ isMobile: false }),
}));

vi.mock('../../../src/server/spa/client/react/repos/UnifiedDiffViewer', () => ({
    UnifiedDiffViewer: ({ onAddComment, onCommentClick, comments, 'data-testid': testId }: any) =>
        React.createElement('div', { 'data-testid': testId ?? 'mock-diff-viewer', 'data-comment-count': String(comments?.length ?? 0) },
            React.createElement('button', {
                'data-testid': 'trigger-add-comment',
                onClick: () => onAddComment?.(
                    { diffLineStart: 1, diffLineEnd: 1, side: 'added', oldLineStart: 0, oldLineEnd: 0, newLineStart: 1, newLineEnd: 1, startColumn: 0, endColumn: 5 },
                    'selected text',
                    { top: 100, left: 200 },
                ),
            }, 'Add Comment'),
            React.createElement('button', {
                'data-testid': 'trigger-comment-click',
                onClick: () => onCommentClick?.({ id: 'c1', context: {}, selection: {}, comment: 'test', status: 'open', createdAt: '', updatedAt: '', selectedText: '' }),
            }, 'View Comment'),
        ),
}));

import { CommitDetail } from '../../../src/server/spa/client/react/repos/CommitDetail';

// ============================================================================
// Hook factory
// ============================================================================

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
        runRelocation: vi.fn(),
        ...overrides,
    };
}

async function renderDetail(props: Record<string, unknown> = {}) {
    await act(async () => {
        render(React.createElement(CommitDetail, { workspaceId: 'ws1', hash: 'abc123', ...(props as any) }));
    });
}

// ============================================================================
// Source-level structural assertions
// ============================================================================

describe('CommitDetail — source structure', () => {
    let source: string;

    beforeEach(() => {
        source = fs.readFileSync(COMMIT_DETAIL_PATH, 'utf-8');
    });

    it('imports useDiffComments hook', () => {
        expect(source).toContain("useDiffComments");
    });

    it('imports UnifiedDiffViewer with comment props', () => {
        expect(source).toContain('UnifiedDiffViewer');
        expect(source).toContain('enableComments');
    });

    it('imports CommentSidebar', () => {
        expect(source).toContain('CommentSidebar');
    });

    it('imports InlineCommentPopup', () => {
        expect(source).toContain('InlineCommentPopup');
    });

    it('passes comments prop to UnifiedDiffViewer', () => {
        expect(source).toContain('comments={comments}');
    });

    it('passes onLinesReady for relocation', () => {
        expect(source).toContain('onLinesReady');
        expect(source).toContain('runRelocation');
    });

    it('has toggle-comments-btn testid', () => {
        expect(source).toContain('toggle-comments-btn');
    });

    it('has data-testid="commit-detail"', () => {
        expect(source).toContain('data-testid="commit-detail"');
    });
});

// ============================================================================
// Integration: select → add comment flow
// ============================================================================

describe('CommitDetail — select → add comment flow', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockAddComment.mockResolvedValue({ id: 'new-c' });
        mockUseDiffComments.mockReturnValue(makeHook());
    });

    it('shows InlineCommentPopup after clicking "Add Comment" trigger', async () => {
        await renderDetail({ filePath: 'src/foo.ts' });
        const trigger = await screen.findByTestId('trigger-add-comment');
        await act(async () => { fireEvent.click(trigger); });
        expect(screen.getByTestId('inline-comment-popup')).toBeTruthy();
    });

    it('submitting popup calls addComment and closes popup', async () => {
        await renderDetail({ filePath: 'src/foo.ts' });
        const trigger = await screen.findByTestId('trigger-add-comment');
        await act(async () => { fireEvent.click(trigger); });

        const textarea = screen.getByTestId('comment-textarea');
        fireEvent.change(textarea, { target: { value: 'my comment text' } });
        await act(async () => {
            fireEvent.click(screen.getByText(/Submit/));
        });

        expect(mockAddComment).toHaveBeenCalledWith(
            expect.objectContaining({ diffLineStart: 1 }),
            'selected text',
            'my comment text',
            expect.any(String),
        );
        await waitFor(() => expect(screen.queryByTestId('inline-comment-popup')).toBeNull());
    });

    it('cancelling popup does not call addComment', async () => {
        await renderDetail({ filePath: 'src/foo.ts' });
        const trigger = await screen.findByTestId('trigger-add-comment');
        await act(async () => { fireEvent.click(trigger); });
        await act(async () => { fireEvent.click(screen.getByText('Cancel')); });
        expect(screen.queryByTestId('inline-comment-popup')).toBeNull();
        expect(mockAddComment).not.toHaveBeenCalled();
    });
});

// ============================================================================
// Integration: sidebar flow
// ============================================================================

describe('CommitDetail — sidebar flow', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockAddComment.mockResolvedValue({ id: 'new-c' });
        mockUseDiffComments.mockReturnValue(makeHook());
    });

    it('sidebar hidden by default', async () => {
        await renderDetail({ filePath: 'src/foo.ts' });
        expect(screen.queryByTestId('comment-sidebar')).toBeNull();
    });

    it('sidebar shows after toggle button click', async () => {
        await renderDetail({ filePath: 'src/foo.ts' });
        fireEvent.click(screen.getByTestId('toggle-comments-btn'));
        expect(screen.getByTestId('comment-sidebar')).toBeTruthy();
    });

    it('clicking a comment via onCommentClick opens sidebar', async () => {
        await renderDetail({ filePath: 'src/foo.ts' });
        expect(screen.queryByTestId('comment-sidebar')).toBeNull();
        const trigger = await screen.findByTestId('trigger-comment-click');
        await act(async () => { fireEvent.click(trigger); });
        expect(screen.getByTestId('comment-sidebar')).toBeTruthy();
    });

    it('comment count passed to UnifiedDiffViewer', async () => {
        const twoComments = [
            { id: 'c1', context: {}, selection: { diffLineStart: 1, diffLineEnd: 1 }, comment: 'a', status: 'open', createdAt: '', updatedAt: '', selectedText: '' },
            { id: 'c2', context: {}, selection: { diffLineStart: 2, diffLineEnd: 2 }, comment: 'b', status: 'open', createdAt: '', updatedAt: '', selectedText: '' },
        ];
        mockUseDiffComments.mockReturnValue(makeHook({ comments: twoComments }));
        await renderDetail({ filePath: 'src/foo.ts' });
        const viewer = await screen.findByTestId('diff-content');
        expect(viewer.getAttribute('data-comment-count')).toBe('2');
    });
});
