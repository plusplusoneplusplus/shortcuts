/**
 * @vitest-environment jsdom
 *
 * Component tests for the composer CI auto-fix controls (AC-05): the "Auto-fix
 * CI" toggle + "Fix now" button in the failed-checks popover, and the "Auto-fix
 * on" badge on the chip. Driven through the connected {@link ChatComposerPrChips}
 * so the trigger client wiring (arm/disarm/fix-now) and the feature-flag /
 * unresolved-context gating are exercised end-to-end.
 *
 * All trigger + message calls must route through the workspace-scoped client
 * ({@link getCocClientForWorkspace}) so remote-clone conversations arm + fix on
 * their owning server (AC-06) — the test asserts the workspace-scoped client is
 * the one used.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, waitFor, act } from '@testing-library/react';
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
    triggers: {
        list: vi.fn(),
        create: vi.fn(),
        delete: vi.fn(),
    },
    processes: {
        sendMessage: vi.fn(),
    },
    getCocClientForWorkspace: vi.fn(),
    triggersEnabled: true,
}));

vi.mock('../../../src/server/spa/client/react/api/cocClient', () => ({
    getSpaCocClient: () => ({ pullRequests: mocks.pullRequests }),
    getSpaCocClientErrorMessage: (err: unknown, fallback: string) =>
        (err instanceof Error && err.message) || fallback,
}));

vi.mock('../../../src/server/spa/client/react/repos/cloneRegistry', () => ({
    getCocClientForWorkspace: mocks.getCocClientForWorkspace,
}));

vi.mock('../../../src/server/spa/client/react/utils/config', async (importOriginal) => {
    const actual = await importOriginal<Record<string, unknown>>();
    return {
        ...actual,
        isTriggersEnabled: () => mocks.triggersEnabled,
    };
});

import { ChatComposerPrChips } from '../../../src/server/spa/client/react/features/chat/conversation/ChatComposerPrChips';

const GH_URL = 'https://github.com/owner/repo/pull/42';
const GH_REMOTE = 'https://github.com/owner/repo';
const GH_ORIGIN = 'gh_owner_repo';
const ITEM_KEY = `${GH_ORIGIN}:42`;

function turnWithPrCreate(url: string, id = 'tc1', command = 'gh pr create --fill'): ClientConversationTurn {
    return {
        role: 'assistant',
        content: '',
        timeline: [
            {
                type: 'tool-complete',
                timestamp: '2024-01-01T00:00:00Z',
                toolCall: { id, toolName: 'bash', args: { command }, result: `Creating pull request...\n${url}\n`, status: 'completed' },
            },
        ],
    };
}

function activeMonitor(overrides: Record<string, unknown> = {}) {
    return {
        id: 'trg-1',
        workspaceId: 'ws1',
        processId: 'proc-1',
        status: 'active',
        event: { type: 'condition-monitor', monitor: 'ci-failure', originId: GH_ORIGIN, prId: '42', pollIntervalMs: 60000, lastSeenChecks: {} },
        action: { type: 'send-message', processId: 'proc-1', prompt: '', mode: 'autopilot' },
        inFlight: false,
        createdAt: '2024-01-01T00:00:00Z',
        expiresAt: '2024-01-04T00:00:00Z',
        lastTickAt: null,
        nextTickAt: null,
        ...overrides,
    };
}

/** Renders the chips and waits until the failing-checks badge is interactive. */
async function renderWithFailingPr(processId: string | null | undefined) {
    const utils = render(
        <ChatComposerPrChips
            turns={[turnWithPrCreate(GH_URL)]}
            workspaceId="ws1"
            remoteUrl={GH_REMOTE}
            taskId="t1"
            processId={processId}
        />,
    );
    await utils.findByText('Fix the thing');
    // Eager checks fetch resolves to a single failing check → the badge becomes a button.
    const badge = await waitFor(() => {
        const el = utils.getByTestId('composer-pr-chip-checks');
        if (el.getAttribute('data-failing') !== '1') throw new Error('checks not failing yet');
        return el;
    });
    return { ...utils, badge };
}

/** Renders the chips with a single PENDING (non-failing) check and waits for the badge. */
async function renderWithPendingPr(processId: string | null | undefined) {
    mocks.pullRequests.getChecksForOrigin.mockResolvedValue({
        checks: [{ id: 'c1', name: 'build', status: 'pending', detailsUrl: 'https://ci.example/c1' }],
    });
    const utils = render(
        <ChatComposerPrChips
            turns={[turnWithPrCreate(GH_URL)]}
            workspaceId="ws1"
            remoteUrl={GH_REMOTE}
            taskId="t1"
            processId={processId}
        />,
    );
    await utils.findByText('Fix the thing');
    // Eager checks fetch resolves to a single pending check → no failures.
    const badge = await waitFor(() => {
        const el = utils.getByTestId('composer-pr-chip-checks');
        if (el.getAttribute('data-total') !== '1') throw new Error('checks not loaded yet');
        if (el.getAttribute('data-failing') !== '0') throw new Error('expected no failing checks');
        return el;
    });
    return { ...utils, badge };
}

describe('ComposerPrChip CI auto-fix controls (AC-05)', () => {
    beforeEach(() => {
        for (const fn of Object.values(mocks.pullRequests)) fn.mockReset();
        for (const fn of Object.values(mocks.triggers)) fn.mockReset();
        mocks.processes.sendMessage.mockReset();
        mocks.getCocClientForWorkspace.mockReset();
        mocks.triggersEnabled = true;

        mocks.pullRequests.listChatBindingsForOrigin.mockResolvedValue({ bindings: {} });
        mocks.pullRequests.createChatBindingForOrigin.mockResolvedValue({ prId: '42', taskId: 't1' });
        mocks.pullRequests.getReviewersForOrigin.mockResolvedValue({ reviewers: [] });
        mocks.pullRequests.getForOrigin.mockResolvedValue({
            number: 42,
            title: 'Fix the thing',
            status: 'open',
            sourceBranch: 'feat/x',
            targetBranch: 'main',
            createdAt: '2024-01-01T00:00:00Z',
            url: GH_URL,
        });
        mocks.pullRequests.getChecksForOrigin.mockResolvedValue({
            checks: [{ id: 'c1', name: 'build', status: 'failure', detailsUrl: 'https://ci.example/c1' }],
        });

        mocks.triggers.list.mockResolvedValue([]);
        mocks.triggers.create.mockResolvedValue(activeMonitor());
        mocks.triggers.delete.mockResolvedValue({ deleted: true, trigger: activeMonitor({ status: 'disarmed' }) });
        mocks.processes.sendMessage.mockResolvedValue({});

        mocks.getCocClientForWorkspace.mockReturnValue({
            pullRequests: mocks.pullRequests,
            triggers: mocks.triggers,
            processes: mocks.processes,
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('toggle ON arms a ci-failure monitor for the PR + conversation', async () => {
        const { badge, getByTestId } = await renderWithFailingPr('proc-1');
        fireEvent.click(badge);
        const toggle = getByTestId(`composer-pr-chip-autofix-toggle-${ITEM_KEY}`);
        expect(toggle.getAttribute('data-armed')).toBe('false');

        await act(async () => {
            fireEvent.click(toggle);
        });

        expect(mocks.triggers.create).toHaveBeenCalledTimes(1);
        expect(mocks.triggers.create).toHaveBeenCalledWith('ws1', {
            processId: 'proc-1',
            event: { type: 'condition-monitor', monitor: 'ci-failure', originId: GH_ORIGIN, prId: '42' },
        });
        // The workspace-scoped client was used (AC-06), not the page-origin one.
        expect(mocks.getCocClientForWorkspace).toHaveBeenCalledWith('ws1');
        await waitFor(() => expect(getByTestId(`composer-pr-chip-autofix-badge-${ITEM_KEY}`)).toBeTruthy());
    });

    it('toggle OFF disarms the armed monitor', async () => {
        mocks.triggers.list.mockResolvedValue([activeMonitor()]);
        const { badge, getByTestId } = await renderWithFailingPr('proc-1');
        // Badge present because a monitor is already armed.
        await waitFor(() => expect(getByTestId(`composer-pr-chip-autofix-badge-${ITEM_KEY}`)).toBeTruthy());

        fireEvent.click(badge);
        const toggle = getByTestId(`composer-pr-chip-autofix-toggle-${ITEM_KEY}`);
        expect(toggle.getAttribute('data-armed')).toBe('true');

        await act(async () => {
            fireEvent.click(toggle);
        });

        expect(mocks.triggers.delete).toHaveBeenCalledTimes(1);
        expect(mocks.triggers.delete).toHaveBeenCalledWith('ws1', 'trg-1');
        expect(mocks.triggers.create).not.toHaveBeenCalled();
    });

    it('"Fix now" sends exactly one autopilot message with the PR + check details', async () => {
        const { badge, getByTestId } = await renderWithFailingPr('proc-1');
        fireEvent.click(badge);

        await act(async () => {
            fireEvent.click(getByTestId(`composer-pr-chip-autofix-fixnow-${ITEM_KEY}`));
        });

        expect(mocks.processes.sendMessage).toHaveBeenCalledTimes(1);
        const [pid, body, query] = mocks.processes.sendMessage.mock.calls[0];
        expect(pid).toBe('proc-1');
        expect(body.mode).toBe('autopilot');
        expect(body.content).toContain('#42');
        expect(body.content).toContain('https://ci.example/c1');
        expect(query).toEqual({ workspace: 'ws1' });
        // No monitor was armed by "Fix now".
        expect(mocks.triggers.create).not.toHaveBeenCalled();
    });

    it('renders the "Auto-fix on" badge only when a monitor is armed', async () => {
        const { queryByTestId } = await renderWithFailingPr('proc-1');
        // No monitor armed → no badge.
        await waitFor(() => expect(mocks.triggers.list).toHaveBeenCalled());
        expect(queryByTestId(`composer-pr-chip-autofix-badge-${ITEM_KEY}`)).toBeNull();
    });

    it('disables the controls with a tooltip when the conversation context is unresolved', async () => {
        const { badge, getByTestId } = await renderWithFailingPr(undefined);
        fireEvent.click(badge);
        const toggle = getByTestId(`composer-pr-chip-autofix-toggle-${ITEM_KEY}`);
        const fixNow = getByTestId(`composer-pr-chip-autofix-fixnow-${ITEM_KEY}`);
        expect((toggle as HTMLButtonElement).disabled).toBe(true);
        expect((fixNow as HTMLButtonElement).disabled).toBe(true);
        expect(toggle.getAttribute('title')).toMatch(/resolved pull request and conversation/i);

        fireEvent.click(toggle);
        fireEvent.click(fixNow);
        expect(mocks.triggers.create).not.toHaveBeenCalled();
        expect(mocks.processes.sendMessage).not.toHaveBeenCalled();
    });

    it('arms a monitor from the badge while checks are still pending (no failures)', async () => {
        const { badge, getByTestId } = await renderWithPendingPr('proc-1');
        // The badge is interactive even though nothing is failing — arming is
        // forward-looking, so it must be reachable before any failure.
        expect(badge.tagName).toBe('BUTTON');
        fireEvent.click(badge);

        const toggle = getByTestId(`composer-pr-chip-autofix-toggle-${ITEM_KEY}`);
        expect((toggle as HTMLButtonElement).disabled).toBe(false);
        expect(toggle.getAttribute('data-armed')).toBe('false');

        await act(async () => {
            fireEvent.click(toggle);
        });

        expect(mocks.triggers.create).toHaveBeenCalledTimes(1);
        expect(mocks.triggers.create).toHaveBeenCalledWith('ws1', {
            processId: 'proc-1',
            event: { type: 'condition-monitor', monitor: 'ci-failure', originId: GH_ORIGIN, prId: '42' },
        });
        await waitFor(() => expect(getByTestId(`composer-pr-chip-autofix-badge-${ITEM_KEY}`)).toBeTruthy());
    });

    it('disables "Fix now" (but not the toggle) when there are no failing checks to fix', async () => {
        const { badge, getByTestId } = await renderWithPendingPr('proc-1');
        fireEvent.click(badge);

        const fixNow = getByTestId(`composer-pr-chip-autofix-fixnow-${ITEM_KEY}`) as HTMLButtonElement;
        expect(fixNow.disabled).toBe(true);
        expect(fixNow.getAttribute('title')).toMatch(/no failing checks/i);

        fireEvent.click(fixNow);
        expect(mocks.processes.sendMessage).not.toHaveBeenCalled();
    });

    it('can disarm an armed monitor while no checks are failing (disarm-trap regression)', async () => {
        mocks.triggers.list.mockResolvedValue([activeMonitor()]);
        const { badge, getByTestId } = await renderWithPendingPr('proc-1');
        // The "Auto-fix on" badge shows even though CI is currently green/pending.
        await waitFor(() => expect(getByTestId(`composer-pr-chip-autofix-badge-${ITEM_KEY}`)).toBeTruthy());

        fireEvent.click(badge);
        const toggle = getByTestId(`composer-pr-chip-autofix-toggle-${ITEM_KEY}`);
        expect(toggle.getAttribute('data-armed')).toBe('true');

        await act(async () => {
            fireEvent.click(toggle);
        });

        expect(mocks.triggers.delete).toHaveBeenCalledTimes(1);
        expect(mocks.triggers.delete).toHaveBeenCalledWith('ws1', 'trg-1');
    });

    it('keeps the checks badge a plain pill (no popover) when the flag is off and nothing is failing', async () => {
        mocks.triggersEnabled = false;
        const { badge, queryByTestId } = await renderWithPendingPr('proc-1');
        expect(badge.tagName).toBe('SPAN');
        fireEvent.click(badge);
        expect(queryByTestId(`composer-pr-chip-checks-popover-${ITEM_KEY}`)).toBeNull();
    });

    it('hides the auto-fix controls + badge when the triggers flag is off', async () => {
        mocks.triggersEnabled = false;
        mocks.triggers.list.mockResolvedValue([activeMonitor()]);
        const { badge, queryByTestId } = await renderWithFailingPr('proc-1');
        fireEvent.click(badge);
        expect(queryByTestId(`composer-pr-chip-autofix-toggle-${ITEM_KEY}`)).toBeNull();
        expect(queryByTestId(`composer-pr-chip-autofix-badge-${ITEM_KEY}`)).toBeNull();
        // Disabled feature performs no trigger network calls.
        expect(mocks.triggers.list).not.toHaveBeenCalled();
    });
});
