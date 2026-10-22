/**
 * WorkingTreeAllComments — every pending-changes comment (staged + unstaged)
 * across all files, grouped by file, read from the exact review owner, with a
 * Copy as prompt action that reports real clipboard success or failure.
 */

// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';

const mockListDiffComments = vi.fn();
const defaultClient = { git: { listDiffComments: (...args: any[]) => mockListDiffComments('default', ...args) } };
// Real clients are cached per owner; a fresh object per call would re-run the read effect forever.
const ownerClients = new Map<string, unknown>();
const mockGetGitReviewClient = vi.fn((_ws: string, target: string | null | undefined) => {
    const key = String(target);
    if (!ownerClients.has(key)) {
        ownerClients.set(key, { git: { listDiffComments: (...args: any[]) => mockListDiffComments(`owner:${key}`, ...args) } });
    }
    return ownerClients.get(key);
});

vi.mock('../../../src/server/spa/client/react/repos/cloneRouting', () => ({
    useCocClient: () => defaultClient,
}));
vi.mock('../../../src/server/spa/client/react/features/git/diff/diffSource', () => ({
    getGitReviewClient: (ws: string, target: string | null | undefined) => mockGetGitReviewClient(ws, target),
}));

import { WorkingTreeAllComments } from '../../../src/server/spa/client/react/features/git/working-tree/WorkingTreeAllComments';

type WsListener = (event: any) => void;
class MockWebSocket {
    static instances: MockWebSocket[] = [];
    private listeners: Record<string, WsListener[]> = {};
    constructor(public url: string) { MockWebSocket.instances.push(this); }
    addEventListener(type: string, handler: WsListener) { (this.listeners[type] ??= []).push(handler); }
    send() { /* not used */ }
    close() { /* not used */ }
    emit(data: unknown) { for (const h of this.listeners.message ?? []) h({ data: JSON.stringify(data) }); }
}

function comment(id: string, filePath: string, overrides: Record<string, any> = {}) {
    return {
        id, status: 'open', comment: `fix ${id}`, selectedText: 'const x = 1;',
        context: { repositoryId: 'ws1', filePath, oldRef: 'INDEX', newRef: 'working-tree' },
        selection: { diffLineStart: 4, diffLineEnd: 4, side: 'added', newLineStart: 7, newLineEnd: 7, startColumn: 0, endColumn: 3 },
        createdAt: '', updatedAt: '',
        ...overrides,
    };
}

let writeText: ReturnType<typeof vi.fn>;

beforeEach(() => {
    mockListDiffComments.mockReset();
    mockGetGitReviewClient.mockClear();
    MockWebSocket.instances = [];
    vi.stubGlobal('WebSocket', MockWebSocket);
    writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
});

afterEach(() => { vi.unstubAllGlobals(); });

async function renderView(props: { workspaceId?: string; attachmentDestinationId?: string } = {}) {
    await act(async () => {
        render(<WorkingTreeAllComments workspaceId={props.workspaceId ?? 'ws1'} attachmentDestinationId={props.attachmentDestinationId} />);
    });
}

describe('WorkingTreeAllComments', () => {
    it('shows loading, then every working-tree comment grouped by file', async () => {
        let resolve: (v: unknown) => void = () => undefined;
        mockListDiffComments.mockImplementationOnce(() => new Promise(r => { resolve = r; }));
        await renderView();
        expect(screen.getByTestId('working-tree-all-comments-loading')).toBeTruthy();

        await act(async () => {
            resolve({ comments: [
                comment('u1', 'src/b.ts'),
                comment('s1', 'src/a.ts', { context: { repositoryId: 'ws1', filePath: 'src/a.ts', oldRef: 'HEAD', newRef: 'working-tree' } }),
                comment('d1', 'src/deleted.ts', { selection: { diffLineStart: 1, diffLineEnd: 2, side: 'removed', oldLineStart: 3, oldLineEnd: 4, startColumn: 0, endColumn: 1 } }),
            ] });
        });

        expect(mockListDiffComments).toHaveBeenCalledWith('default', 'ws1', { newRef: 'working-tree' });
        expect(screen.getAllByTestId('comment-file-group').map(g => g.getAttribute('aria-label')))
            .toEqual(['src/a.ts, 1 comment(s)', 'src/b.ts, 1 comment(s)', 'src/deleted.ts, 1 comment(s)']);
        expect(screen.getByText('Comments (3 · 3 files)')).toBeTruthy();
    });

    it('shows the load error', async () => {
        mockListDiffComments.mockRejectedValueOnce(new Error('Network error'));
        await renderView();
        await waitFor(() => expect(screen.getByTestId('working-tree-all-comments-error').textContent).toContain('Network error'));
    });

    it('shows the review empty state', async () => {
        mockListDiffComments.mockResolvedValueOnce({});
        await renderView();
        expect(screen.getByTestId('empty-comments').textContent).toContain('No comments yet');
        expect(screen.queryByTestId('copy-prompt-btn')).toBeNull();
    });

    it('reads from the explicit review owner, and the page origin for a local owner', async () => {
        mockListDiffComments.mockResolvedValue({ comments: [] });
        await renderView({ attachmentDestinationId: 'member-ws' });
        expect(mockGetGitReviewClient).toHaveBeenCalledWith('ws1', 'member-ws');
        expect(mockListDiffComments).toHaveBeenCalledWith('owner:member-ws', 'ws1', { newRef: 'working-tree' });

        mockListDiffComments.mockClear();
        await renderView({ attachmentDestinationId: 'ws1' });
        expect(mockListDiffComments).toHaveBeenCalledWith('owner:null', 'ws1', { newRef: 'working-tree' });
    });

    it('never falls back to another owner when the remote owner is unresolved', async () => {
        await renderView({ attachmentDestinationId: 'remote:unknown-server:ws1' });
        expect(screen.getByTestId('working-tree-all-comments-error').textContent).toBe('Git review owner is unavailable');
        expect(mockListDiffComments).not.toHaveBeenCalled();
    });

    it('copies every unresolved comment with file, location, stage and exact text', async () => {
        mockListDiffComments.mockResolvedValueOnce({ comments: [
            comment('u1', 'src/b.ts', { comment: 'Rename this.\nAlso add a test.' }),
            comment('s1', 'src/a.ts', { context: { repositoryId: 'ws1', filePath: 'src/a.ts', oldRef: 'HEAD', newRef: 'working-tree' } }),
            comment('r1', 'src/c.ts', { status: 'resolved', comment: 'already done' }),
        ] });
        await renderView();

        await act(async () => { fireEvent.click(screen.getByTestId('copy-prompt-btn')); });

        expect(writeText).toHaveBeenCalledOnce();
        const prompt: string = writeText.mock.calls[0][0];
        expect(prompt).toContain('You are reviewing the pending working-tree changes (staged and unstaged).');
        expect(prompt).toContain('Resolve the following 2 unresolved review comment(s) across 2 file(s).');
        expect(prompt).toContain('1 resolved comment(s) are not included.');
        expect(prompt.indexOf('## File: src/a.ts')).toBeLessThan(prompt.indexOf('## File: src/b.ts'));
        expect(prompt).toContain('File: src/a.ts\nLocation: new line 7 (added)\nChanges: staged');
        expect(prompt).toContain('File: src/b.ts\nLocation: new line 7 (added)\nChanges: unstaged');
        expect(prompt).toContain('Comment:\nRename this.\nAlso add a test.');
        expect(prompt).not.toContain('already done');
        expect(screen.getByTestId('copy-prompt-btn').textContent).toBe('✓ Copied');
    });

    it('reports a failed clipboard write instead of success', async () => {
        writeText.mockRejectedValueOnce(new Error('denied'));
        mockListDiffComments.mockResolvedValueOnce({ comments: [comment('u1', 'src/b.ts')] });
        await renderView();

        await act(async () => { fireEvent.click(screen.getByTestId('copy-prompt-btn')); });

        expect(screen.getByTestId('copy-prompt-btn').textContent).toBe('Copy failed');
    });

    it('refreshes when a working-tree comment is added in a file diff', async () => {
        mockListDiffComments
            .mockResolvedValueOnce({ comments: [comment('u1', 'src/b.ts')] })
            .mockResolvedValueOnce({ comments: [comment('u1', 'src/b.ts'), comment('u2', 'src/new.ts')] });
        await renderView();
        expect(screen.getAllByTestId('comment-file-group')).toHaveLength(1);

        await act(async () => {
            MockWebSocket.instances[0].emit({
                type: 'diff-comment-updated', action: 'added', workspaceId: 'ws1', storageKey: 'k',
                comment: comment('u2', 'src/new.ts'),
            });
        });

        await waitFor(() => expect(screen.getAllByTestId('comment-file-group')).toHaveLength(2));
    });
});
