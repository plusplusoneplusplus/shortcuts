/**
 * @vitest-environment jsdom
 *
 * Integration tests for ChatPrStatusCard + usePrChatStatusItems — the runtime
 * wiring that closes AC-01 (detect + persist + union) and AC-02 (card visible
 * with deep-link) at runtime.
 *
 * Covers:
 *   - AC-01 DoD #1 / AC-02 DoD #1: a PR detected in a `gh pr create` turn is
 *     unioned, its detail fetched, the row rendered, and a binding upserted.
 *   - AC-01 DoD #2: with no turns, a persisted binding alone surfaces the PR
 *     (reload with the creating turn collapsed) and is NOT re-posted.
 *   - AC-02 error state: a failed detail fetch shows an inline error + retry,
 *     and retry recovers.
 *   - empty: no detected PRs and no bindings → the card stays hidden.
 *   - mapPrDetailToCardPr pure-mapper edge cases.
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
    },
}));

vi.mock('../../../src/server/spa/client/react/api/cocClient', () => ({
    getSpaCocClient: () => ({ pullRequests: mocks.pullRequests }),
    getSpaCocClientErrorMessage: (err: unknown, fallback: string) =>
        (err instanceof Error && err.message) || fallback,
}));

import { ChatPrStatusCard } from '../../../src/server/spa/client/react/features/chat/conversation/ChatPrStatusCard';
import { mapPrDetailToCardPr, parseAutoMerge } from '../../../src/server/spa/client/react/features/chat/conversation/usePrChatStatusItems';

const GH_URL = 'https://github.com/owner/repo/pull/42';
const GH_REMOTE = 'https://github.com/owner/repo';
const GH_ORIGIN = 'gh_owner_repo';

function turnWithPrCreate(url: string, id = 'tc1'): ClientConversationTurn {
    return {
        role: 'assistant',
        content: '',
        timeline: [
            {
                type: 'tool-complete',
                timestamp: '2024-01-01T00:00:00Z',
                toolCall: {
                    id,
                    toolName: 'bash',
                    args: { command: 'gh pr create --fill' },
                    result: `Creating pull request...\n${url}\n`,
                    status: 'completed',
                },
            },
        ],
    };
}

describe('ChatPrStatusCard / usePrChatStatusItems', () => {
    beforeEach(() => {
        mocks.pullRequests.listChatBindingsForOrigin.mockReset();
        mocks.pullRequests.createChatBindingForOrigin.mockReset();
        mocks.pullRequests.getForOrigin.mockReset();
        mocks.pullRequests.createChatBindingForOrigin.mockResolvedValue({ prId: '42', taskId: 't1' });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('AC-01/AC-02: detected PR is unioned, fetched, rendered, and persisted', async () => {
        mocks.pullRequests.listChatBindingsForOrigin.mockResolvedValue({ bindings: {} });
        mocks.pullRequests.getForOrigin.mockResolvedValue({
            number: 42,
            title: 'Add PR status card',
            status: 'open',
            sourceBranch: 'feature/card',
            targetBranch: 'main',
            createdAt: '2024-01-01T00:00:00Z',
            url: GH_URL,
        });

        const { findByText, getByTestId } = render(
            <ChatPrStatusCard turns={[turnWithPrCreate(GH_URL)]} workspaceId="ws1" remoteUrl={GH_REMOTE} taskId="t1" />,
        );

        // Row renders with the fetched title + branches (AC-02 DoD #1).
        await findByText('Add PR status card');
        expect(getByTestId('pr-status-card')).toBeTruthy();
        expect(getByTestId(`pr-status-card-branches-${GH_ORIGIN}:42`).textContent).toContain('feature/card → main');

        // Detail fetched against the detected PR's canonical origin.
        expect(mocks.pullRequests.getForOrigin).toHaveBeenCalledWith(GH_ORIGIN, '42', { workspaceId: 'ws1' });

        // Deep-link points at the PR detail view for this repo.
        const link = getByTestId(`pr-status-card-open-${GH_ORIGIN}:42`) as HTMLAnchorElement;
        expect(link.getAttribute('href')).toBe('#repos/ws1/pull-requests/42/overview');

        // Fresh detection persists a binding so it survives a later reload (AC-01).
        await waitFor(() =>
            expect(mocks.pullRequests.createChatBindingForOrigin).toHaveBeenCalledWith(GH_ORIGIN, '42', 't1'),
        );
    });

    it('AC-01 DoD #2: a persisted binding alone surfaces the PR on reload (no re-post)', async () => {
        mocks.pullRequests.listChatBindingsForOrigin.mockResolvedValue({
            bindings: { '42': { taskId: 't1', createdAt: '2024-01-01T00:00:00Z' } },
        });
        mocks.pullRequests.getForOrigin.mockResolvedValue({
            number: 42,
            title: 'Persisted PR',
            status: 'merged',
            sourceBranch: 'feature/x',
            targetBranch: 'main',
            mergedAt: '2024-01-02T00:00:00Z',
            createdAt: '2024-01-01T00:00:00Z',
        });

        // No turns → nothing detected; the binding is the only source.
        const { findByText } = render(
            <ChatPrStatusCard turns={[]} workspaceId="ws1" remoteUrl={GH_REMOTE} taskId="t1" />,
        );

        await findByText('Persisted PR');
        expect(mocks.pullRequests.getForOrigin).toHaveBeenCalledWith(GH_ORIGIN, '42', { workspaceId: 'ws1' });
        // Already bound → no upsert.
        expect(mocks.pullRequests.createChatBindingForOrigin).not.toHaveBeenCalled();
    });

    it('AC-02 error state: failed detail fetch shows error + retry, retry recovers', async () => {
        mocks.pullRequests.listChatBindingsForOrigin.mockResolvedValue({ bindings: {} });
        mocks.pullRequests.getForOrigin
            .mockRejectedValueOnce(new Error('network down'))
            .mockResolvedValueOnce({
                number: 42,
                title: 'Recovered PR',
                status: 'open',
                sourceBranch: 'feature/card',
                targetBranch: 'main',
                createdAt: '2024-01-01T00:00:00Z',
            });

        const { findByText, getByTestId } = render(
            <ChatPrStatusCard turns={[turnWithPrCreate(GH_URL)]} workspaceId="ws1" remoteUrl={GH_REMOTE} taskId="t1" />,
        );

        const errorRow = await waitFor(() => getByTestId(`pr-status-card-error-${GH_ORIGIN}:42`));
        expect(errorRow.textContent).toContain('network down');

        fireEvent.click(getByTestId(`pr-status-card-retry-${GH_ORIGIN}:42`));
        await findByText('Recovered PR');
        expect(mocks.pullRequests.getForOrigin).toHaveBeenCalledTimes(2);
    });

    it('empty: no detection and no bindings keeps the card hidden', async () => {
        mocks.pullRequests.listChatBindingsForOrigin.mockResolvedValue({ bindings: {} });
        const { container } = render(
            <ChatPrStatusCard turns={[]} workspaceId="ws1" remoteUrl={GH_REMOTE} taskId="t1" />,
        );
        await waitFor(() => expect(mocks.pullRequests.listChatBindingsForOrigin).toHaveBeenCalled());
        expect(container.querySelector('[data-testid="pr-status-card"]')).toBeNull();
        expect(mocks.pullRequests.getForOrigin).not.toHaveBeenCalled();
    });
});

describe('mapPrDetailToCardPr', () => {
    it('maps a canonical PR detail to the card subset', () => {
        const pr = mapPrDetailToCardPr({
            number: 7,
            title: 'A PR',
            status: 'merged',
            sourceBranch: 'feat',
            targetBranch: 'main',
            mergedAt: '2024-01-02T00:00:00Z',
            url: 'https://example/pr/7',
        });
        expect(pr).toEqual({
            number: 7,
            title: 'A PR',
            status: 'merged',
            sourceBranch: 'feat',
            targetBranch: 'main',
            mergedAt: '2024-01-02T00:00:00Z',
            closedAt: undefined,
            url: 'https://example/pr/7',
        });
    });

    it('returns undefined for non-objects or payloads missing title/status', () => {
        expect(mapPrDetailToCardPr(null)).toBeUndefined();
        expect(mapPrDetailToCardPr('nope')).toBeUndefined();
        expect(mapPrDetailToCardPr({ title: 'no status' })).toBeUndefined();
        expect(mapPrDetailToCardPr({ status: 'open' })).toBeUndefined();
    });

    it('defaults missing branch fields to empty strings', () => {
        const pr = mapPrDetailToCardPr({ title: 'T', status: 'open' });
        expect(pr).toMatchObject({ title: 'T', status: 'open', sourceBranch: '', targetBranch: '' });
    });

    it('extracts the canonical auto-merge payload (AC-04)', () => {
        const pr = mapPrDetailToCardPr({
            title: 'T',
            status: 'open',
            autoMerge: {
                enabled: true,
                state: 'armed',
                mergeMethod: 'squash',
                enabledBy: { id: 'u1', displayName: 'Carol' },
                blockedReason: undefined,
            },
        });
        expect(pr?.autoMerge).toEqual({
            enabled: true,
            state: 'armed',
            mergeMethod: 'squash',
            enabledBy: { displayName: 'Carol' },
            blockedReason: undefined,
        });
    });

    it('leaves auto-merge undefined when the detail omits it', () => {
        const pr = mapPrDetailToCardPr({ title: 'T', status: 'open' });
        expect(pr?.autoMerge).toBeUndefined();
    });
});

describe('parseAutoMerge', () => {
    it('returns undefined for non-objects or payloads missing state', () => {
        expect(parseAutoMerge(undefined)).toBeUndefined();
        expect(parseAutoMerge(null)).toBeUndefined();
        expect(parseAutoMerge('nope')).toBeUndefined();
        expect(parseAutoMerge({ enabled: true })).toBeUndefined();
    });

    it('maps a blocked auto-merge, narrowing enabledBy to displayName', () => {
        expect(
            parseAutoMerge({
                enabled: true,
                state: 'blocked',
                blockedReason: 'conflicts',
                enabledBy: { id: 'u2', displayName: 'Dana', email: 'd@x.io' },
            }),
        ).toEqual({
            enabled: true,
            state: 'blocked',
            blockedReason: 'conflicts',
            mergeMethod: undefined,
            enabledBy: { displayName: 'Dana' },
        });
    });

    it('treats a missing/false enabled flag and absent enabledBy gracefully', () => {
        expect(parseAutoMerge({ state: 'not-enabled' })).toEqual({
            enabled: false,
            state: 'not-enabled',
            blockedReason: undefined,
            mergeMethod: undefined,
            enabledBy: undefined,
        });
    });
});
