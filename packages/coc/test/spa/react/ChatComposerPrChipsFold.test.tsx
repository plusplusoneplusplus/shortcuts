/**
 * @vitest-environment jsdom
 *
 * Component tests for folding "earlier" PR chips in the composer — the rendered
 * half of the behaviour unit-tested in composerPrChipFold.test.ts.
 *
 * Covers the real motivating case (a chat that shipped five commits, all merged,
 * out-growing the textarea it sits above): the stack keeps one chip expanded and
 * summarizes the rest in a single fold row, the row toggles the hidden chips into
 * view, and dismissing still works on a chip rendered inside an expanded fold —
 * folding hides, dismissing removes, and the two stay orthogonal.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import type { ClientConversationTurn } from '../../../src/server/spa/client/react/types/dashboard';

const mocks = vi.hoisted(() => ({
    pullRequests: {
        listChatBindingsForOrigin: vi.fn(),
        createChatBindingForOrigin: vi.fn(),
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

const GH_REMOTE = 'https://github.com/owner/repo';
const GH_ORIGIN = 'gh_owner_repo';
const prUrl = (n: number) => `https://github.com/owner/repo/pull/${n}`;

/** An assistant turn whose bash output announces PR `n` — the detection path. */
function turnWithPr(n: number): ClientConversationTurn {
    return {
        role: 'assistant',
        content: '',
        timeline: [
            {
                type: 'tool-complete',
                timestamp: '2024-01-01T00:00:00Z',
                toolCall: {
                    id: `tc-${n}`,
                    toolName: 'bash',
                    args: { command: 'gh pr create --fill' },
                    result: `Creating pull request...\n${prUrl(n)}\n`,
                    status: 'completed',
                },
            },
        ],
    };
}

/**
 * Detail for PR `n`. `createdAt` ascends with `n`, so higher numbers are newer
 * and the chip order is deterministic.
 */
function detailFor(n: number, status: string) {
    return {
        number: n,
        title: `PR ${n} title`,
        status,
        sourceBranch: `feat/${n}`,
        targetBranch: 'main',
        createdAt: `2024-01-0${n}T00:00:00Z`,
        url: prUrl(n),
    };
}

/** Renders the chip stack for PRs `numbers`, each resolving to `statuses[n]`. */
function renderStack(numbers: number[], statuses: Record<number, string>) {
    mocks.pullRequests.getForOrigin.mockImplementation((_origin: string, prId: string) =>
        Promise.resolve(detailFor(Number(prId), statuses[Number(prId)])),
    );
    return render(
        <ChatComposerPrChips
            turns={numbers.map(turnWithPr)}
            workspaceId="ws1"
            remoteUrl={GH_REMOTE}
            taskId="t1"
        />,
    );
}

const allMerged = { 1: 'merged', 2: 'merged', 3: 'merged', 4: 'merged', 5: 'merged' };

describe('ChatComposerPrChips — folding earlier PRs', () => {
    beforeEach(() => {
        mocks.pullRequests.listChatBindingsForOrigin.mockReset();
        mocks.pullRequests.createChatBindingForOrigin.mockReset();
        mocks.pullRequests.getForOrigin.mockReset();
        mocks.pullRequests.getReviewersForOrigin.mockReset();
        mocks.pullRequests.getChecksForOrigin.mockReset();
        mocks.pullRequests.listChatBindingsForOrigin.mockResolvedValue({ bindings: {} });
        mocks.pullRequests.createChatBindingForOrigin.mockResolvedValue({ prId: '1', taskId: 't1' });
        mocks.pullRequests.getReviewersForOrigin.mockResolvedValue({ reviewers: [] });
        mocks.pullRequests.getChecksForOrigin.mockResolvedValue({ checks: [] });
        mocks.getCocClientForWorkspace.mockReset();
        mocks.getCocClientForWorkspace.mockReturnValue({ pullRequests: mocks.pullRequests });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('collapses five merged PRs to one chip plus a fold row, closed by default', async () => {
        const { findByTestId, getAllByTestId, getByTestId } = renderStack([1, 2, 3, 4, 5], allMerged);

        const foldRow = await findByTestId('composer-pr-fold-row');
        expect(foldRow.getAttribute('data-count')).toBe('4');
        expect(foldRow.getAttribute('data-open')).toBe('false');
        expect(foldRow.getAttribute('aria-expanded')).toBe('false');
        expect(getByTestId('composer-pr-fold-count').textContent).toBe('4 earlier PRs');
        expect(getByTestId('composer-pr-fold-breakdown').textContent).toBe('4 merged');
        expect(getByTestId('composer-pr-fold-numbers').textContent).toBe('#4 #3 #2 #1');

        // Rule 2: the newest merged PR stays expanded, so the chat still shows
        // what it shipped rather than only a summary row.
        const chips = getAllByTestId('composer-pr-chip');
        expect(chips).toHaveLength(1);
        expect(chips[0].getAttribute('data-pr-key')).toBe(`${GH_ORIGIN}:5`);
    });

    it('shows a mixed breakdown and state dots for what is hidden', async () => {
        const { findByTestId, getByTestId, getAllByTestId } = renderStack([1, 2, 3, 4, 5], {
            1: 'merged', 2: 'closed', 3: 'merged', 4: 'merged', 5: 'open',
        });

        await findByTestId('composer-pr-fold-row');
        await waitFor(() => expect(getByTestId('composer-pr-fold-count').textContent).toBe('4 earlier PRs'));
        expect(getByTestId('composer-pr-fold-breakdown').textContent).toBe('3 merged · 1 closed');

        const dots = getAllByTestId('composer-pr-fold-dots')[0].children;
        expect(Array.from(dots).map(dot => dot.getAttribute('data-status')))
            .toEqual(['merged', 'merged', 'closed', 'merged']);

        // The open PR is what needs attention, so it is the one left expanded.
        const chips = getAllByTestId('composer-pr-chip');
        expect(chips).toHaveLength(1);
        expect(chips[0].getAttribute('data-pr-key')).toBe(`${GH_ORIGIN}:5`);
    });

    it('clicking the fold row expands the hidden chips and clicking again re-folds them', async () => {
        const { findByTestId, getAllByTestId, getByTestId } = renderStack([1, 2, 3, 4, 5], allMerged);

        const foldRow = await findByTestId('composer-pr-fold-row');
        expect(getAllByTestId('composer-pr-chip')).toHaveLength(1);

        fireEvent.click(foldRow);

        await waitFor(() => expect(getAllByTestId('composer-pr-chip')).toHaveLength(5));
        expect(getByTestId('composer-pr-fold-row').getAttribute('data-open')).toBe('true');
        expect(getByTestId('composer-pr-fold-row').getAttribute('aria-expanded')).toBe('true');
        // Newest first, with the fold row's chips following the expanded head.
        expect(getAllByTestId('composer-pr-chip').map(chip => chip.getAttribute('data-pr-key')))
            .toEqual([5, 4, 3, 2, 1].map(n => `${GH_ORIGIN}:${n}`));

        fireEvent.click(getByTestId('composer-pr-fold-row'));
        await waitFor(() => expect(getAllByTestId('composer-pr-chip')).toHaveLength(1));
    });

    it('dismissing a chip inside an expanded fold removes it and re-tallies the row', async () => {
        const { findByTestId, getAllByTestId, getByTestId, queryByTestId } = renderStack([1, 2, 3, 4, 5], allMerged);

        fireEvent.click(await findByTestId('composer-pr-fold-row'));
        await waitFor(() => expect(getAllByTestId('composer-pr-chip')).toHaveLength(5));

        fireEvent.click(getByTestId(`composer-pr-chip-dismiss-${GH_ORIGIN}:2`));

        await waitFor(() => expect(queryByTestId(`composer-pr-chip-dismiss-${GH_ORIGIN}:2`)).toBeNull());
        expect(getByTestId('composer-pr-fold-row').getAttribute('data-count')).toBe('3');
        expect(getByTestId('composer-pr-fold-count').textContent).toBe('3 earlier PRs');
        expect(getByTestId('composer-pr-fold-numbers').textContent).toBe('#4 #3 #1');
        // Still expanded — dismissing one chip must not collapse the fold.
        expect(getAllByTestId('composer-pr-chip')).toHaveLength(4);
    });

    it('drops the fold row entirely once dismissals leave only one chip to fold (rule 3)', async () => {
        const { findByTestId, getByTestId, queryByTestId, getAllByTestId } = renderStack([1, 2, 3, 4, 5], allMerged);

        fireEvent.click(await findByTestId('composer-pr-fold-row'));
        await waitFor(() => expect(getAllByTestId('composer-pr-chip')).toHaveLength(5));

        fireEvent.click(getByTestId(`composer-pr-chip-dismiss-${GH_ORIGIN}:1`));
        fireEvent.click(getByTestId(`composer-pr-chip-dismiss-${GH_ORIGIN}:2`));
        fireEvent.click(getByTestId(`composer-pr-chip-dismiss-${GH_ORIGIN}:3`));

        // Two chips left, only one of them foldable — folding it would trade a
        // chip row for a fold row, so both render inline.
        await waitFor(() => expect(queryByTestId('composer-pr-fold-row')).toBeNull());
        expect(getAllByTestId('composer-pr-chip').map(chip => chip.getAttribute('data-pr-key')))
            .toEqual([`${GH_ORIGIN}:5`, `${GH_ORIGIN}:4`]);
    });

    it('renders no fold row for a handful of open PRs under the cap', async () => {
        const { findByText, queryByTestId, getAllByTestId } = renderStack([1, 2, 3], {
            1: 'open', 2: 'open', 3: 'draft',
        });

        await findByText('PR 1 title');
        await waitFor(() => expect(getAllByTestId('composer-pr-chip')).toHaveLength(3));
        expect(queryByTestId('composer-pr-fold-row')).toBeNull();
    });

    it('folds open PRs past the active cap so a long-running chat cannot swallow the composer', async () => {
        const { findByTestId, getByTestId, getAllByTestId } = renderStack([1, 2, 3, 4, 5], {
            1: 'open', 2: 'open', 3: 'open', 4: 'open', 5: 'open',
        });

        const foldRow = await findByTestId('composer-pr-fold-row');
        expect(foldRow.getAttribute('data-count')).toBe('2');
        expect(getByTestId('composer-pr-fold-breakdown').textContent).toBe('2 open');
        // The cap keeps the three most recent active PRs.
        expect(getAllByTestId('composer-pr-chip').map(chip => chip.getAttribute('data-pr-key')))
            .toEqual([5, 4, 3].map(n => `${GH_ORIGIN}:${n}`));
    });

    it('never folds a chip whose detail failed to load', async () => {
        // An error chip you cannot see is a chip nobody will ever retry, so it
        // stays expanded alongside the fold row summarizing the merged PRs.
        mocks.pullRequests.getForOrigin.mockImplementation((_origin: string, prId: string) => {
            const n = Number(prId);
            return n === 1
                ? Promise.reject(new Error('detail fetch failed'))
                : Promise.resolve(detailFor(n, 'merged'));
        });

        const { findByTestId, getAllByTestId, getByTestId } = render(
            <ChatComposerPrChips
                turns={[1, 2, 3, 4].map(turnWithPr)}
                workspaceId="ws1"
                remoteUrl={GH_REMOTE}
                taskId="t1"
            />,
        );

        const foldRow = await findByTestId('composer-pr-fold-row');
        await waitFor(() => expect(foldRow.getAttribute('data-count')).toBe('3'));

        const chips = getAllByTestId('composer-pr-chip');
        expect(chips).toHaveLength(1);
        expect(chips[0].getAttribute('data-pr-key')).toBe(`${GH_ORIGIN}:1`);
        expect(chips[0].getAttribute('data-state')).toBe('error');
        // Rule 2 does not additionally hold back the newest merged PR — the
        // visible error chip already keeps the stack non-empty.
        expect(getByTestId('composer-pr-fold-numbers').textContent).toBe('#4 #3 #2');
    });
});
