/**
 * Tests for BranchRangeAllComments component.
 *
 * Validates:
 * - Loading state while fetching
 * - Error state when fetch fails
 * - Successful render: header and sidebar with comments
 * - Correct API URL constructed from workspaceId / baseRef / headRef
 * - copyAllCommentsAsPrompt: groups by file, filters resolved, includes branchLabel
 */

// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';

// ============================================================================
// Source path
// ============================================================================

const COMPONENT_PATH = path.resolve(
    __dirname, '../../../../src/server/spa/client/react/features/git/branches/BranchRangeAllComments.tsx'
);

// ============================================================================
// Module mocks (hoisted by Vitest)
// ============================================================================

const mockListDiffComments = vi.fn();

vi.mock('../../../../src/server/spa/client/react/api/cocClient', () => ({
    getSpaCocClient: () => ({
        git: {
            listDiffComments: (...args: any[]) => mockListDiffComments(...args),
        },
    }),
}));

vi.mock('../../../../src/server/spa/client/react/tasks/comments/CommentSidebar', () => ({
    CommentSidebar: ({ onCopyPrompt, comments, 'data-testid': testId }: any) =>
        React.createElement('div', { 'data-testid': testId ?? 'mock-comment-sidebar' },
            onCopyPrompt
                ? React.createElement('button', {
                    'data-testid': 'copy-prompt-btn',
                    onClick: onCopyPrompt,
                }, '📋')
                : null,
            React.createElement('span', { 'data-testid': 'comment-count' }, String(comments?.length ?? 0)),
        ),
}));

vi.mock('../../../../src/server/spa/client/react/ui', () => ({
    Spinner: () => React.createElement('span', { 'data-testid': 'spinner' }, '…'),
}));

import { BranchRangeAllComments } from '../../../../src/server/spa/client/react/features/git/branches/BranchRangeAllComments';

// ============================================================================
// Helpers
// ============================================================================

const DEFAULT_PROPS = {
    workspaceId: 'ws-test',
    baseRef: 'origin/main',
    headRef: 'feature/my-branch',
    branchLabel: 'feature/my-branch',
};

function makeDiffComment(overrides: Record<string, any> = {}) {
    return {
        id: 'c1',
        status: 'open',
        comment: 'fix this',
        selectedText: 'const x = 1;',
        context: { filePath: 'src/foo.ts' },
        selection: { diffLineStart: 10, diffLineEnd: 12, side: 'right' },
        createdAt: '',
        updatedAt: '',
        ...overrides,
    };
}

async function renderComponent(props = DEFAULT_PROPS) {
    await act(async () => {
        render(React.createElement(BranchRangeAllComments, props));
    });
}

// ============================================================================
// Source-level structural assertions
// ============================================================================

describe('BranchRangeAllComments — source structure', () => {
    let source: string;

    beforeAll(() => {
        source = fs.readFileSync(COMPONENT_PATH, 'utf-8');
    });

    it('exports BranchRangeAllComments as a named export', () => {
        expect(source).toContain('export function BranchRangeAllComments');
    });

    it('accepts workspaceId, baseRef, headRef and branchLabel props', () => {
        expect(source).toContain('workspaceId: string');
        expect(source).toContain('baseRef: string');
        expect(source).toContain('headRef: string');
        expect(source).toContain('branchLabel: string');
    });

    it('defines copyAllCommentsAsPrompt callback', () => {
        expect(source).toContain('copyAllCommentsAsPrompt');
    });

    it('passes onCopyPrompt to CommentSidebar', () => {
        expect(source).toContain('onCopyPrompt={copyAllCommentsAsPrompt}');
    });

    it('groups comments by filePath', () => {
        expect(source).toContain('byFile');
        expect(source).toContain('filePath');
    });

    it('filters only open comments', () => {
        expect(source).toContain("status === 'open'");
    });

    it('writes to clipboard', () => {
        expect(source).toContain('navigator.clipboard.writeText');
    });

    it('builds API URL with oldRef and newRef query params', () => {
        expect(source).toContain('listDiffComments(workspaceId, { oldRef: baseRef, newRef: headRef })');
    });
});

// ============================================================================
// Integration: rendering states
// ============================================================================

describe('BranchRangeAllComments — rendering', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('shows loading state initially', async () => {
        mockListDiffComments.mockReturnValue(new Promise(() => {})); // never resolves
        await act(async () => {
            render(React.createElement(BranchRangeAllComments, DEFAULT_PROPS));
        });
        expect(screen.getByTestId('branch-range-all-comments-loading')).toBeTruthy();
    });

    it('shows error state when fetch fails', async () => {
        mockListDiffComments.mockRejectedValue(new Error('Network error'));
        await renderComponent();
        await waitFor(() => expect(screen.getByTestId('branch-range-all-comments-error')).toBeTruthy());
        expect(screen.getByTestId('branch-range-all-comments-error').textContent).toContain('Network error');
    });

    it('shows a fallback error message when error has no message', async () => {
        mockListDiffComments.mockRejectedValue({});
        await renderComponent();
        await waitFor(() => expect(screen.getByTestId('branch-range-all-comments-error')).toBeTruthy());
        expect(screen.getByTestId('branch-range-all-comments-error').textContent).toContain('Failed to load comments');
    });

    it('renders main container after successful fetch', async () => {
        mockListDiffComments.mockResolvedValue({ comments: [] });
        await renderComponent();
        await waitFor(() => expect(screen.getByTestId('branch-range-all-comments')).toBeTruthy());
    });

    it('renders sidebar after successful fetch', async () => {
        mockListDiffComments.mockResolvedValue({ comments: [makeDiffComment()] });
        await renderComponent();
        await waitFor(() => expect(screen.getByTestId('branch-range-all-comments-sidebar')).toBeTruthy());
    });

    it('passes comments to sidebar', async () => {
        const comments = [makeDiffComment({ id: 'c1' }), makeDiffComment({ id: 'c2' })];
        mockListDiffComments.mockResolvedValue({ comments });
        await renderComponent();
        await waitFor(() => expect(screen.getByTestId('comment-count').textContent).toBe('2'));
    });

    it('passes empty array to sidebar when API returns no comments field', async () => {
        mockListDiffComments.mockResolvedValue({});
        await renderComponent();
        await waitFor(() => expect(screen.getByTestId('comment-count').textContent).toBe('0'));
    });

    it('renders branchLabel in the header', async () => {
        mockListDiffComments.mockResolvedValue({ comments: [] });
        await renderComponent();
        await waitFor(() => screen.getByTestId('branch-range-all-comments'));
        expect(screen.getByText(/feature\/my-branch/)).toBeTruthy();
    });

    it('constructs API URL with encoded workspaceId, baseRef, and headRef', async () => {
        mockListDiffComments.mockResolvedValue({ comments: [] });
        const props = { workspaceId: 'ws/123', baseRef: 'origin/main', headRef: 'feat/x', branchLabel: 'feat/x' };
        await act(async () => {
            render(React.createElement(BranchRangeAllComments, props));
        });
        await waitFor(() => expect(mockListDiffComments).toHaveBeenCalled());
        expect(mockListDiffComments).toHaveBeenCalledWith('ws/123', {
            oldRef: 'origin/main',
            newRef: 'feat/x',
        });
    });
});

// ============================================================================
// Integration: copyAllCommentsAsPrompt
// ============================================================================

describe('BranchRangeAllComments — copyAllCommentsAsPrompt', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        Object.assign(navigator, {
            clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
        });
    });

    it('renders copy prompt button when there are open comments', async () => {
        mockListDiffComments.mockResolvedValue({ comments: [makeDiffComment()] });
        await renderComponent();
        await waitFor(() => expect(screen.getByTestId('copy-prompt-btn')).toBeTruthy());
    });

    it('calls clipboard.writeText when copy prompt button is clicked', async () => {
        mockListDiffComments.mockResolvedValue({ comments: [makeDiffComment()] });
        await renderComponent();
        await waitFor(() => screen.getByTestId('copy-prompt-btn'));
        fireEvent.click(screen.getByTestId('copy-prompt-btn'));
        expect(navigator.clipboard.writeText).toHaveBeenCalledOnce();
    });

    it('prompt contains file path', async () => {
        mockListDiffComments.mockResolvedValue({ comments: [makeDiffComment({ context: { filePath: 'src/bar.ts' } })] });
        await renderComponent();
        await waitFor(() => screen.getByTestId('copy-prompt-btn'));
        fireEvent.click(screen.getByTestId('copy-prompt-btn'));
        const written = (navigator.clipboard.writeText as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
        expect(written).toContain('src/bar.ts');
    });

    it('prompt contains comment text', async () => {
        mockListDiffComments.mockResolvedValue({ comments: [makeDiffComment({ comment: 'refactor me' })] });
        await renderComponent();
        await waitFor(() => screen.getByTestId('copy-prompt-btn'));
        fireEvent.click(screen.getByTestId('copy-prompt-btn'));
        const written = (navigator.clipboard.writeText as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
        expect(written).toContain('refactor me');
    });

    it('prompt includes branchLabel', async () => {
        mockListDiffComments.mockResolvedValue({ comments: [makeDiffComment()] });
        await renderComponent();
        await waitFor(() => screen.getByTestId('copy-prompt-btn'));
        fireEvent.click(screen.getByTestId('copy-prompt-btn'));
        const written = (navigator.clipboard.writeText as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
        expect(written).toContain('feature/my-branch');
    });

    it('groups comments by file in the prompt', async () => {
        const comments = [
            makeDiffComment({ id: 'c1', context: { filePath: 'src/a.ts' }, comment: 'comment A' }),
            makeDiffComment({ id: 'c2', context: { filePath: 'src/b.ts' }, comment: 'comment B' }),
        ];
        mockListDiffComments.mockResolvedValue({ comments });
        await renderComponent();
        await waitFor(() => screen.getByTestId('copy-prompt-btn'));
        fireEvent.click(screen.getByTestId('copy-prompt-btn'));
        const written = (navigator.clipboard.writeText as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
        expect(written).toContain('## File: src/a.ts');
        expect(written).toContain('## File: src/b.ts');
        expect(written).toContain('2 file(s)');
    });

    it('prompt lists multiple comments in the same file', async () => {
        const comments = [
            makeDiffComment({ id: 'c1', context: { filePath: 'src/a.ts' }, comment: 'first' }),
            makeDiffComment({ id: 'c2', context: { filePath: 'src/a.ts' }, comment: 'second' }),
        ];
        mockListDiffComments.mockResolvedValue({ comments });
        await renderComponent();
        await waitFor(() => screen.getByTestId('copy-prompt-btn'));
        fireEvent.click(screen.getByTestId('copy-prompt-btn'));
        const written = (navigator.clipboard.writeText as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
        expect(written).toContain('first');
        expect(written).toContain('second');
        expect(written).toContain('2 comment(s)');
    });

    it('excludes resolved comments from the prompt', async () => {
        const comments = [
            makeDiffComment({ id: 'c1', status: 'open', comment: 'open comment' }),
            makeDiffComment({ id: 'c2', status: 'resolved', comment: 'resolved comment' }),
        ];
        mockListDiffComments.mockResolvedValue({ comments });
        await renderComponent();
        await waitFor(() => screen.getByTestId('copy-prompt-btn'));
        fireEvent.click(screen.getByTestId('copy-prompt-btn'));
        const written = (navigator.clipboard.writeText as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
        expect(written).toContain('open comment');
        expect(written).not.toContain('resolved comment');
    });

    it('does not call clipboard.writeText when there are no open comments', async () => {
        const comments = [makeDiffComment({ id: 'c1', status: 'resolved' })];
        mockListDiffComments.mockResolvedValue({ comments });
        await renderComponent();
        // sidebar mock always renders copy-prompt-btn when onCopyPrompt is defined —
        // trigger it directly to verify early return
        await waitFor(() => screen.getByTestId('copy-prompt-btn'));
        fireEvent.click(screen.getByTestId('copy-prompt-btn'));
        expect(navigator.clipboard.writeText).not.toHaveBeenCalled();
    });

    it('prompt includes line range and selected text', async () => {
        const comments = [
            makeDiffComment({
                selection: { diffLineStart: 5, diffLineEnd: 8, side: 'left' },
                selectedText: 'let y = 2;',
            }),
        ];
        mockListDiffComments.mockResolvedValue({ comments });
        await renderComponent();
        await waitFor(() => screen.getByTestId('copy-prompt-btn'));
        fireEvent.click(screen.getByTestId('copy-prompt-btn'));
        const written = (navigator.clipboard.writeText as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
        expect(written).toContain('Lines 5–8 (left)');
        expect(written).toContain('let y = 2;');
    });

    it('prompt ends with "Please address these comments."', async () => {
        mockListDiffComments.mockResolvedValue({ comments: [makeDiffComment()] });
        await renderComponent();
        await waitFor(() => screen.getByTestId('copy-prompt-btn'));
        fireEvent.click(screen.getByTestId('copy-prompt-btn'));
        const written = (navigator.clipboard.writeText as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
        expect(written).toContain('Please address these comments.');
    });
});
