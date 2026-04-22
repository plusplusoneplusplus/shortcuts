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
    __dirname, '../../../src/server/spa/client/react/features/git/commits/CommitDetail.tsx'
);

// ============================================================================
// Module mocks (hoisted)
// ============================================================================

const mockAddComment = vi.fn();
const mockUseDiffComments = vi.fn();

vi.mock('../../../src/server/spa/client/react/features/git/hooks/useDiffComments', () => ({
    useDiffComments: (...args: any[]) => mockUseDiffComments(...args),
}));

vi.mock('../../../src/server/spa/client/react/hooks/useApi', () => ({
    fetchApi: () => Promise.resolve({ diff: '@@ -1,2 +1,3 @@\n ctx\n+added\n-removed\n ctx2' }),
}));

vi.mock('react-dom', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-dom')>();
    return { ...actual, createPortal: (children: React.ReactNode) => children };
});

vi.mock('../../../src/server/spa/client/react/hooks/ui/useBreakpoint', () => ({
    useBreakpoint: () => ({ isMobile: false }),
}));

vi.mock('../../../src/server/spa/client/react/contexts/QueueContext', () => ({
    useQueue: () => ({ state: { dialogLaunchMode: 'default', dialogMode: 'task' }, dispatch: vi.fn() }),
}));

vi.mock('../../../src/server/spa/client/react/features/git/diff/UnifiedDiffViewer', () => ({
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
                onClick: (e: any) => {
                    Object.defineProperty(e, 'currentTarget', {
                        value: { getBoundingClientRect: () => ({ top: 50, bottom: 70, left: 100, right: 200, width: 100, height: 20 }) },
                    });
                    onCommentClick?.({ id: 'c1', context: {}, selection: {}, comment: 'test', status: 'open', createdAt: '', updatedAt: '', selectedText: '' }, e);
                },
            }, 'View Comment'),
        ),
    HunkNavButtons: () => null,
}));

import { CommitDetail } from '../../../src/server/spa/client/react/features/git/commits/CommitDetail';

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
        resolvingIds: new Set(),
        deletingIds: new Set(),

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

describe('CommitDetail — source structure (commit-level comments)', () => {
    let source: string;

    beforeEach(() => {
        source = fs.readFileSync(COMMIT_DETAIL_PATH, 'utf-8');
    });

    it('imports useAllCommitComments hook', () => {
        expect(source).toContain("useAllCommitComments");
    });

    it('no longer imports useDiffComments (per-file comments moved to FileDiffPanel)', () => {
        expect(source).not.toContain("import { useDiffComments }");
    });

    it('imports UnifiedDiffViewer', () => {
        expect(source).toContain('UnifiedDiffViewer');
    });

    it('imports CommentSidebar', () => {
        expect(source).toContain('CommentSidebar');
    });

    it('no longer imports InlineCommentPopup (per-file commenting moved to FileDiffPanel)', () => {
        expect(source).not.toContain("import { InlineCommentPopup }");
    });

    it('has toggle-comments-btn testid', () => {
        expect(source).toContain('toggle-comments-btn');
    });

    it('has data-testid="commit-detail"', () => {
        expect(source).toContain('data-testid="commit-detail"');
    });

    it('no longer accepts filePath prop', () => {
        expect(source).not.toContain('filePath?: string');
    });
});

// ============================================================================
// Note: The per-file comment interaction tests (select → add comment flow,
// sidebar flow) have been removed because CommitDetail no longer supports
// the filePath prop. Per-file commenting is now handled by FileDiffPanel.
// See FileDiffPanel tests for equivalent coverage.
// ============================================================================
