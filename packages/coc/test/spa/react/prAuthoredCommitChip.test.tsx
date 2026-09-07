/**
 * @vitest-environment jsdom
 *
 * Regression coverage for the composer PR banner on the chat that *authored*
 * the commits.
 *
 * When commits are made in chat A and later shipped by a separate
 * `submit-commits-as-pr` run (a queued chat), the PR's one
 * `pull_request_chat_bindings` row belongs to that queued chat. Chat A — the one
 * that did the work and the one the user has open — used to show nothing.
 *
 * The banner now also derives the association at render time by joining chat A's
 * own detected commits against the repo's candidate PRs. That association is
 * never persisted: writing a binding would steal the PR from the chat that
 * opened it, so no POST is issued and dismissing the chip issues no DELETE.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import type { ClientConversationTurn } from '../../../src/server/spa/client/react/types/dashboard';

const mocks = vi.hoisted(() => ({
    pullRequests: {
        listChatBindingsForOrigin: vi.fn(),
        createChatBindingForOrigin: vi.fn(),
        deleteChatBindingForOrigin: vi.fn(),
        listForOrigin: vi.fn(),
        getCommitsForOrigin: vi.fn(),
        getForOrigin: vi.fn(),
        getReviewersForOrigin: vi.fn(),
        getChecksForOrigin: vi.fn(),
    },
    getCocClientForWorkspace: vi.fn(),
}));

vi.mock('../../../src/server/spa/client/react/api/cocClient', () => ({
    getSpaCocClient: () => ({ pullRequests: mocks.pullRequests }),
    getSpaCocClientErrorMessage: (err: unknown, fallback: string) =>
        (err instanceof Error && err.message) || fallback,
}));

vi.mock('../../../src/server/spa/client/react/repos/cloneRegistry', () => ({
    getCocClientForWorkspace: mocks.getCocClientForWorkspace,
}));

import { ChatComposerPrChips } from '../../../src/server/spa/client/react/features/chat/conversation/ChatComposerPrChips';
import { clearAuthoredPrCommitsCache } from '../../../src/server/spa/client/react/features/chat/conversation/usePrChatStatusItems';

const WS = 'ws-authoring';
const GH_REMOTE = 'https://github.com/owner/repo';
const GH_ORIGIN = 'gh_owner_repo';
const SUBJECT = 'feat(composer): wire file-mention popup into both composers';

/** A shell tool call whose output is a successful `git commit`. */
function turnWithCommit(shortHash = '3d32522', subject = SUBJECT): ClientConversationTurn {
    return {
        role: 'assistant',
        content: '',
        timeline: [
            {
                type: 'tool-complete',
                timestamp: '2024-01-01T00:00:00Z',
                toolCall: {
                    id: 'tc-commit',
                    toolName: 'bash',
                    args: { command: 'git commit -m "…"' },
                    result: `[main ${shortHash}] ${subject}\n 3 files changed, 40 insertions(+)\n`,
                    status: 'completed',
                },
            },
        ],
    };
}

function renderChips(turns: ClientConversationTurn[]) {
    return render(<ChatComposerPrChips turns={turns} workspaceId={WS} remoteUrl={GH_REMOTE} taskId="chat-a" />);
}

describe('composer PR banner for the chat that authored the commits', () => {
    beforeEach(() => {
        clearAuthoredPrCommitsCache();
        for (const fn of Object.values(mocks.pullRequests)) fn.mockReset();
        // Chat A owns no binding; the queued submit chat owns PR 721's.
        mocks.pullRequests.listChatBindingsForOrigin.mockImplementation((_origin: string, options?: { taskId?: string }) =>
            Promise.resolve(
                options?.taskId
                    ? { bindings: {} }
                    : { bindings: { 721: { taskId: 'queue_1788707657651-i0mrcgh', createdAt: '2026-09-01T00:00:00Z' } } },
            ),
        );
        mocks.pullRequests.listForOrigin.mockResolvedValue({ pullRequests: [], total: 0 });
        mocks.pullRequests.getCommitsForOrigin.mockResolvedValue({
            // Cherry-picked onto the submit branch: new SHA, identical subject.
            commits: [{ id: 'f00ba4', shortId: 'f00ba4c', subject: SUBJECT, message: SUBJECT }],
        });
        mocks.pullRequests.getForOrigin.mockResolvedValue({
            number: 721,
            title: 'Composer file mentions',
            status: 'open',
            sourceBranch: 'pr/3d32522-composer-file-mentions',
            targetBranch: 'main',
            createdAt: '2026-09-02T00:00:00Z',
            url: 'https://github.com/owner/repo/pull/721',
        });
        mocks.pullRequests.getReviewersForOrigin.mockResolvedValue({ reviewers: [] });
        mocks.pullRequests.getChecksForOrigin.mockResolvedValue({ checks: [] });
        mocks.getCocClientForWorkspace.mockReset();
        mocks.getCocClientForWorkspace.mockReturnValue({ pullRequests: mocks.pullRequests });
    });

    it('surfaces the PR that ships its commits, without persisting a binding', async () => {
        const { findByText, getByTestId } = renderChips([turnWithCommit()]);

        await findByText('Composer file mentions');
        expect(getByTestId(`composer-pr-chip-view-${GH_ORIGIN}:721`)).toBeTruthy();
        // Round 1 of the scan: every PR some chat in this repo opened.
        expect(mocks.pullRequests.listChatBindingsForOrigin).toHaveBeenCalledWith(GH_ORIGIN);
        expect(mocks.pullRequests.getCommitsForOrigin).toHaveBeenCalledWith(GH_ORIGIN, '721', { workspaceId: WS });
        // Binding PK is (workspace, pr): a POST here would steal PR 721 from the
        // queued submit chat that actually opened it.
        expect(mocks.pullRequests.createChatBindingForOrigin).not.toHaveBeenCalled();
    });

    it('dismissing an authored-only chip deletes no binding', async () => {
        const { findByText, getByTestId, queryByTestId } = renderChips([turnWithCommit()]);

        await findByText('Composer file mentions');
        fireEvent.click(getByTestId(`composer-pr-chip-dismiss-${GH_ORIGIN}:721`));

        await waitFor(() => expect(queryByTestId(`composer-pr-chip-view-${GH_ORIGIN}:721`)).toBeNull());
        expect(mocks.pullRequests.deleteChatBindingForOrigin).not.toHaveBeenCalled();
    });

    it('falls back to open PRs and matches on the submit branch name', async () => {
        // No PR in this repo has a binding at all — the PR was opened outside coc.
        mocks.pullRequests.listChatBindingsForOrigin.mockResolvedValue({ bindings: {} });
        mocks.pullRequests.listForOrigin.mockResolvedValue({
            pullRequests: [{ number: 721, status: 'open', sourceBranch: 'pr/3d32522-composer-file-mentions' }],
            total: 1,
        });

        const { findByText } = renderChips([turnWithCommit()]);

        await findByText('Composer file mentions');
        expect(mocks.pullRequests.listForOrigin).toHaveBeenCalledWith(GH_ORIGIN, {
            workspaceId: WS,
            status: 'open',
            top: 20,
        });
        // The branch fast path matched, so no commit list was ever fetched.
        expect(mocks.pullRequests.getCommitsForOrigin).not.toHaveBeenCalled();
        expect(mocks.pullRequests.createChatBindingForOrigin).not.toHaveBeenCalled();
    });

    it('renders nothing and does no scanning I/O when the chat made no commits', async () => {
        const { queryByTestId } = renderChips([]);

        await new Promise(resolve => setTimeout(resolve, 30));
        expect(queryByTestId('composer-pr-chips')).toBeNull();
        expect(mocks.pullRequests.getCommitsForOrigin).not.toHaveBeenCalled();
        expect(mocks.pullRequests.listForOrigin).not.toHaveBeenCalled();
        // Only the chat's own task-scoped bindings GET, never the repo-wide scan.
        for (const call of mocks.pullRequests.listChatBindingsForOrigin.mock.calls) {
            expect(call[1]).toEqual({ taskId: 'chat-a' });
        }
    });

    it('does not surface a PR whose commits belong to a different chat', async () => {
        mocks.pullRequests.getCommitsForOrigin.mockResolvedValue({
            commits: [{ id: 'f00ba4', shortId: 'f00ba4c', subject: 'chore: unrelated work', message: 'chore: unrelated work' }],
        });

        const { queryByTestId } = renderChips([turnWithCommit('9999999', 'fix: something else entirely')]);

        await waitFor(() => expect(mocks.pullRequests.getCommitsForOrigin).toHaveBeenCalled());
        await new Promise(resolve => setTimeout(resolve, 30));
        expect(queryByTestId('composer-pr-chips')).toBeNull();
        expect(mocks.pullRequests.getForOrigin).not.toHaveBeenCalled();
    });
});
