/**
 * BranchRangeAllComments — every branch-range comment across all files,
 * grouped by file. Range file comments are stored under the fixed
 * `branch-base`/`branch-head` refs (createBranchRangeDiffSource.commentContext),
 * not the resolved range refs; reading the resolved refs silently shows nothing.
 */

// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';

const mockListDiffComments = vi.fn();
const defaultClient = { git: { listDiffComments: (...args: any[]) => mockListDiffComments('default', ...args) } };
const ownerClients = new Map<string, unknown>();
const mockGetGitReviewClient = vi.fn((_ws: string, target: string | null | undefined) => {
    const key = String(target);
    if (!ownerClients.has(key)) {
        ownerClients.set(key, { git: { listDiffComments: (...args: any[]) => mockListDiffComments(`owner:${key}`, ...args) } });
    }
    return ownerClients.get(key);
});

vi.mock('../../../../src/server/spa/client/react/repos/cloneRouting', () => ({
    useCocClient: () => defaultClient,
}));
vi.mock('../../../../src/server/spa/client/react/features/git/diff/diffSource', () => ({
    getGitReviewClient: (ws: string, target: string | null | undefined) => mockGetGitReviewClient(ws, target),
}));

import { BranchRangeAllComments } from '../../../../src/server/spa/client/react/features/git/branches/BranchRangeAllComments';

class MockWebSocket {
    addEventListener() { /* not used */ }
    send() { /* not used */ }
    close() { /* not used */ }
}

function comment(id: string, filePath: string, overrides: Record<string, any> = {}) {
    return {
        id, status: 'open', comment: `fix ${id}`, selectedText: 'const x = 1;',
        context: { repositoryId: 'ws-test', filePath, oldRef: 'branch-base', newRef: 'branch-head' },
        selection: { diffLineStart: 1, diffLineEnd: 3, side: 'added', newLineStart: 10, newLineEnd: 12, startColumn: 0, endColumn: 3 },
        createdAt: '', updatedAt: '',
        ...overrides,
    };
}

let writeText: ReturnType<typeof vi.fn>;

beforeEach(() => {
    mockListDiffComments.mockReset();
    mockGetGitReviewClient.mockClear();
    vi.stubGlobal('WebSocket', MockWebSocket);
    writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
});

afterEach(() => { vi.unstubAllGlobals(); });

async function renderView(attachmentDestinationId?: string) {
    await act(async () => {
        render(<BranchRangeAllComments workspaceId="ws-test" attachmentDestinationId={attachmentDestinationId} branchLabel="feature/my-branch" />);
    });
}

describe('BranchRangeAllComments', () => {
    it('reads the refs range file comments are stored under', async () => {
        mockListDiffComments.mockResolvedValueOnce({ comments: [] });
        await renderView();
        expect(mockListDiffComments).toHaveBeenCalledWith('default', 'ws-test', { oldRef: 'branch-base', newRef: 'branch-head' });
        expect(screen.getByText('Branch Changes: feature/my-branch — All Comments')).toBeTruthy();
    });

    it('routes the read to the explicit review owner', async () => {
        mockListDiffComments.mockResolvedValueOnce({ comments: [] });
        await renderView('member-ws');
        expect(mockListDiffComments).toHaveBeenCalledWith('owner:member-ws', 'ws-test', { oldRef: 'branch-base', newRef: 'branch-head' });
    });

    it('groups comments by file', async () => {
        mockListDiffComments.mockResolvedValueOnce({ comments: [comment('b', 'src/b.ts'), comment('a', 'src/a.ts')] });
        await renderView();
        expect(screen.getAllByTestId('comment-file-group').map(g => g.getAttribute('aria-label')))
            .toEqual(['src/a.ts, 1 comment(s)', 'src/b.ts, 1 comment(s)']);
    });

    it('shows a fallback error message when the error has no message', async () => {
        mockListDiffComments.mockRejectedValueOnce({});
        await renderView();
        await waitFor(() => expect(screen.getByTestId('branch-range-all-comments-error').textContent).toBe('Failed to load comments'));
    });

    it('copies the branch context, file paths, line ranges and exact text', async () => {
        mockListDiffComments.mockResolvedValueOnce({ comments: [comment('a', 'src/a.ts', { comment: 'Use the shared helper' })] });
        await renderView();
        await act(async () => { fireEvent.click(screen.getByTestId('copy-prompt-btn')); });

        const prompt: string = writeText.mock.calls[0][0];
        expect(prompt).toContain('You are reviewing the branch changes of feature/my-branch.');
        expect(prompt).toContain('## File: src/a.ts (1 comment(s))');
        expect(prompt).toContain('Location: new lines 10–12 (added)');
        expect(prompt).toContain('Comment:\nUse the shared helper');
    });
});

describe('createBranchRangeDiffSource comment refs', () => {
    it('matches the refs the aggregate view reads', async () => {
        const actual = await vi.importActual<typeof import('../../../../src/server/spa/client/react/features/git/diff/diffSource')>(
            '../../../../src/server/spa/client/react/features/git/diff/diffSource');
        const ctx = actual.createBranchRangeDiffSource('ws-test').commentContext('src/a.ts');
        expect({ oldRef: ctx.oldRef, newRef: ctx.newRef }).toEqual({ oldRef: 'branch-base', newRef: 'branch-head' });
    });
});
