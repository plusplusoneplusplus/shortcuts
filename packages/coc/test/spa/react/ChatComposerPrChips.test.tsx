/**
 * @vitest-environment jsdom
 *
 * Integration tests for ChatComposerPrChips + usePrChatStatusItems — the runtime
 * wiring behind the in-composer PR chip (design 01·B). The chip stack reuses the
 * same detect + persist + fetch hook as the legacy top-of-thread card, so these
 * cover the composer-specific presentation: a detected PR renders one chip with a
 * deep-link, the ✕ dismisses it for the session, the +adds/−dels diff surfaces
 * from the detail's diffStats, and an empty association set renders nothing.
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

describe('ChatComposerPrChips / usePrChatStatusItems', () => {
    beforeEach(() => {
        mocks.pullRequests.listChatBindingsForOrigin.mockReset();
        mocks.pullRequests.createChatBindingForOrigin.mockReset();
        mocks.pullRequests.getForOrigin.mockReset();
        mocks.pullRequests.getChecksForOrigin.mockReset();
        mocks.pullRequests.createChatBindingForOrigin.mockResolvedValue({ prId: '42', taskId: 't1' });
        mocks.pullRequests.getChecksForOrigin.mockResolvedValue({ checks: [] });
        mocks.getCocClientForWorkspace.mockReset();
        mocks.getCocClientForWorkspace.mockReturnValue({ pullRequests: mocks.pullRequests });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('renders one composer chip for a detected PR, with title, diff, and deep-link', async () => {
        mocks.pullRequests.listChatBindingsForOrigin.mockResolvedValue({ bindings: {} });
        mocks.pullRequests.getForOrigin.mockResolvedValue({
            number: 42,
            title: 'Dark mode: settings schedules',
            status: 'open',
            sourceBranch: 'feat/dark-settings',
            targetBranch: 'main',
            createdAt: '2024-01-01T00:00:00Z',
            url: GH_URL,
            diffStats: { additions: 142, deletions: 38, changedFiles: 3 },
        });

        const { findByText, getByTestId } = render(
            <ChatComposerPrChips turns={[turnWithPrCreate(GH_URL)]} workspaceId="ws1" remoteUrl={GH_REMOTE} taskId="t1" />,
        );

        await findByText('Dark mode: settings schedules');
        expect(getByTestId('composer-pr-chips')).toBeTruthy();
        expect(getByTestId('composer-pr-chip').getAttribute('data-state')).toBe('ready');

        const view = getByTestId(`composer-pr-chip-view-${GH_ORIGIN}:42`) as HTMLAnchorElement;
        expect(view.getAttribute('href')).toBe('#repos/ws1/pull-requests/42/overview');
        expect(getByTestId('composer-pr-chip-diff').textContent).toContain('+142');
    });

    it('eager-loaded checks surface as a passing/total count on the chip', async () => {
        mocks.pullRequests.listChatBindingsForOrigin.mockResolvedValue({ bindings: {} });
        mocks.pullRequests.getForOrigin.mockResolvedValue({
            number: 42,
            title: 'PR with checks',
            status: 'open',
            sourceBranch: 'feat/x',
            targetBranch: 'main',
            createdAt: '2024-01-01T00:00:00Z',
            url: GH_URL,
        });
        mocks.pullRequests.getChecksForOrigin.mockResolvedValue({
            checks: [
                { id: 'c1', name: 'build', status: 'success', source: 'check' },
                { id: 'c2', name: 'unit', status: 'success', source: 'check' },
                { id: 'c3', name: 'e2e', status: 'pending', source: 'check' },
            ],
        });

        const { findByText, findByTestId } = render(
            <ChatComposerPrChips turns={[turnWithPrCreate(GH_URL)]} workspaceId="ws1" remoteUrl={GH_REMOTE} taskId="t1" />,
        );

        await findByText('PR with checks');
        const badge = await findByTestId('composer-pr-chip-checks');
        expect(badge.getAttribute('data-passing')).toBe('2');
        expect(badge.getAttribute('data-total')).toBe('3');
        expect(badge.textContent).toContain('2/3');
    });

    it('dismissing a chip with ✕ hides it for the session', async () => {
        mocks.pullRequests.listChatBindingsForOrigin.mockResolvedValue({ bindings: {} });
        mocks.pullRequests.getForOrigin.mockResolvedValue({
            number: 42,
            title: 'Dismissable PR',
            status: 'open',
            sourceBranch: 'feat/x',
            targetBranch: 'main',
            createdAt: '2024-01-01T00:00:00Z',
            url: GH_URL,
        });

        const { findByText, getByTestId, queryByTestId } = render(
            <ChatComposerPrChips turns={[turnWithPrCreate(GH_URL)]} workspaceId="ws1" remoteUrl={GH_REMOTE} taskId="t1" />,
        );

        await findByText('Dismissable PR');
        fireEvent.click(getByTestId(`composer-pr-chip-dismiss-${GH_ORIGIN}:42`));
        await waitFor(() => expect(queryByTestId('composer-pr-chips')).toBeNull());
    });

    it('renders nothing when no PR is detected and no binding exists', async () => {
        mocks.pullRequests.listChatBindingsForOrigin.mockResolvedValue({ bindings: {} });
        const { container } = render(
            <ChatComposerPrChips turns={[]} workspaceId="ws1" remoteUrl={GH_REMOTE} taskId="t1" />,
        );
        await waitFor(() => expect(mocks.pullRequests.listChatBindingsForOrigin).toHaveBeenCalled());
        expect(container.querySelector('[data-testid="composer-pr-chips"]')).toBeNull();
        expect(mocks.pullRequests.getForOrigin).not.toHaveBeenCalled();
    });
});
