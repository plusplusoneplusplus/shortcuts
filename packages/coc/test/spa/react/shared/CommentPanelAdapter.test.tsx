/**
 * Tests for CommentPanelAdapter shared component.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CommentPanelAdapter } from '../../../../src/server/spa/client/react/shared/CommentPanelAdapter';
import type { NotesCommentPanelProps, TaskCommentPanelProps } from '../../../../src/server/spa/client/react/shared/CommentPanelAdapter';
import type { UseCommentsReturn } from '../../../../src/server/spa/client/react/features/notes/editor/useComments';
import type { AnyComment } from '../../../../src/server/spa/client/shared-comment-types';

function makeStubComments(overrides: Partial<UseCommentsReturn> = {}): UseCommentsReturn {
    return {
        threads: [],
        selectedThreadId: null,
        filter: 'all',
        loading: false,
        error: null,
        totalCount: 0,
        openCount: 0,
        resolvedCount: 0,
        setFilter: vi.fn(),
        selectThread: vi.fn(),
        createThread: vi.fn(),
        resolveThread: vi.fn(),
        reopenThread: vi.fn(),
        deleteThread: vi.fn(),
        addComment: vi.fn(),
        editComment: vi.fn(),
        deleteComment: vi.fn(),
        reload: vi.fn(),
        ...overrides,
    };
}

function makeTaskComment(overrides: Partial<AnyComment> = {}): AnyComment {
    return {
        id: 'c1',
        text: 'Fix this',
        status: 'open',
        filePath: 'src/index.ts',
        lineNumber: 10,
        createdAt: new Date().toISOString(),
        ...overrides,
    } as AnyComment;
}

describe('CommentPanelAdapter', () => {
    it('renders the notes CommentsSidebar when variant is "notes"', () => {
        const props: NotesCommentPanelProps = {
            variant: 'notes',
            workspaceId: 'ws-1',
            notePath: '/test.md',
            selectedThreadId: null,
            onThreadSelect: vi.fn(),
            comments: makeStubComments({ totalCount: 3 }),
        };

        render(<CommentPanelAdapter {...props} />);

        expect(screen.getByTestId('comments-sidebar')).toBeTruthy();
        expect(screen.queryByTestId('comment-sidebar')).toBeNull();
    });

    it('renders the task CommentSidebar when variant is "task"', () => {
        const props: TaskCommentPanelProps = {
            variant: 'task',
            comments: [makeTaskComment()],
            loading: false,
            onResolve: vi.fn(),
            onUnresolve: vi.fn(),
            onDelete: vi.fn(),
            onEdit: vi.fn(),
            onAskAI: vi.fn(),
            onCommentClick: vi.fn(),
        };

        render(<CommentPanelAdapter {...props} />);

        expect(screen.getByTestId('comment-sidebar')).toBeTruthy();
        expect(screen.queryByTestId('comments-sidebar')).toBeNull();
    });

    it('passes notes props through to CommentsSidebar', () => {
        const comments = makeStubComments({ totalCount: 5 });
        render(
            <CommentPanelAdapter
                variant="notes"
                workspaceId="ws-2"
                notePath="/doc.md"
                selectedThreadId={null}
                onThreadSelect={vi.fn()}
                comments={comments}
            />,
        );

        expect(screen.getByTestId('comments-count-badge').textContent).toBe('5');
    });

    it('passes task props through to CommentSidebar', () => {
        const comment = makeTaskComment({ id: 'task-c1', text: 'Review this' });
        render(
            <CommentPanelAdapter
                variant="task"
                comments={[comment]}
                loading={false}
                onResolve={vi.fn()}
                onUnresolve={vi.fn()}
                onDelete={vi.fn()}
                onEdit={vi.fn()}
                onAskAI={vi.fn()}
                onCommentClick={vi.fn()}
            />,
        );

        expect(screen.getByTestId('comment-list')).toBeTruthy();
        expect(screen.getByTestId('comment-sidebar')).toBeTruthy();
    });

    it('shows loading state from notes branch', () => {
        render(
            <CommentPanelAdapter
                variant="notes"
                workspaceId="ws-1"
                notePath="/test.md"
                selectedThreadId={null}
                onThreadSelect={vi.fn()}
                comments={makeStubComments({ loading: true })}
            />,
        );

        expect(screen.getByTestId('comments-loading')).toBeTruthy();
    });

    it('shows loading state from task branch', () => {
        render(
            <CommentPanelAdapter
                variant="task"
                comments={[]}
                loading={true}
                onResolve={vi.fn()}
                onUnresolve={vi.fn()}
                onDelete={vi.fn()}
                onEdit={vi.fn()}
                onAskAI={vi.fn()}
                onCommentClick={vi.fn()}
            />,
        );

        expect(screen.getByText('Loading comments…')).toBeTruthy();
    });
});
