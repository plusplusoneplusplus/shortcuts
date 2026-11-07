/**
 * UnifiedTodoTab `selectItemRequest` (a `coc://todo/<itemId>` address): it
 * selects the item and opens its detail once the ledger loads, repeats for a
 * new nonce after the user moved away, and leaves the selection alone for an
 * unknown id. The open item is reported through `onSelectionChange`.
 *
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, configure, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { SentinelTodoItem, SentinelTodoLedgerResponse } from '@plusplusoneplusplus/coc-client';

vi.mock('../../../src/server/spa/client/react/contexts/AppContext', () => ({ useAppOptional: () => null }));
vi.mock('../../../src/server/spa/client/react/contexts/ReposContext', () => ({
    useReposOptional: () => ({ repos: [], remoteGroupWorkspaces: [] }),
}));

configure({ asyncUtilTimeout: 5000 });

const get = vi.fn();
const update = vi.fn();
const create = vi.fn();
const connect = vi.fn();
const scrubGet = vi.fn();
const fakeClient = {
    sentinelTodos: {
        scrubber: { get: (...args: unknown[]) => scrubGet(...args), getRun: vi.fn(), accept: vi.fn() },
        get: (...args: unknown[]) => get(...args),
        create: (...args: unknown[]) => create(...args),
        update: (...args: unknown[]) => update(...args),
        evaluateDependencies: vi.fn(),
        listPrOutcomes: vi.fn(),
    },
    triggers: { listSentinelTodo: async () => [] },
    events: { connect: (...args: unknown[]) => connect(...args) },
};
vi.mock('../../../src/server/spa/client/react/repos/cloneRouting', () => ({ useCocClient: () => fakeClient }));
vi.mock('../../../src/server/spa/client/react/repos/cloneRegistry', async importOriginal => ({
    ...(await importOriginal<object>()),
    getCocClientForWorkspace: () => fakeClient,
}));

import { UnifiedTodoTab } from '../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/UnifiedTodoTab';
import { clearSentinelTodoExcursion } from '../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/sentinelTodoExcursion';
import { applyRuntimeConfigPatch } from '../../../src/server/spa/client/react/utils/config';
import { resetCloneRegistryForTests } from '../../../src/server/spa/client/react/repos/cloneRegistry';

const OWNER = { ownerWorkspaceId: 'ws-1', processId: 'queue_sentinel' };

let seq = 0;
function item(overrides: Partial<SentinelTodoItem> = {}): SentinelTodoItem {
    seq += 1;
    const stamp = new Date(Date.UTC(2026, 9, 9, 0, 0, seq)).toISOString();
    return {
        id: `item-${seq}`, title: `Item ${seq}`, completionCondition: '', notes: '', status: 'todo', archived: false,
        revision: 1, createdAt: stamp, updatedAt: stamp, createdBy: 'sentinel', updatedBy: 'sentinel', jobs: [],
        type: 'normal', priority: 'regular', ...overrides,
    };
}

function ledger(items: SentinelTodoItem[], revision = items.length): SentinelTodoLedgerResponse {
    return { revision, items };
}

beforeEach(() => {
    seq = 0;
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(800);
    // jsdom reports every element hidden; the find shortcut ignores hidden panels.
    vi.spyOn(HTMLElement.prototype, 'offsetParent', 'get').mockImplementation(function (this: HTMLElement) { return this.parentElement; });
    applyRuntimeConfigPatch({ sentinelTodoScrubberEnabled: false, sentinelTodoDependenciesEnabled: false, sentinelPrOutcomeWakeEnabled: false });
    resetCloneRegistryForTests();
    get.mockReset();
    update.mockReset();
    create.mockReset();
    scrubGet.mockReset();
    connect.mockReset().mockReturnValue({ close: vi.fn() });
    clearSentinelTodoExcursion();
});

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

const pressed = (id: string) => document.querySelector(`[data-todo-select="${id}"]`)?.getAttribute('aria-pressed');

describe('UnifiedTodoTab selectItemRequest', () => {
    it('selects the requested item, opens its detail and reports the selection', async () => {
        get.mockResolvedValue(ledger([item({ id: 'a' }), item({ id: 'b' })]));
        const onSelectionChange = vi.fn();
        render(<UnifiedTodoTab owner={OWNER} selectItemRequest={{ id: 'b', nonce: 1 }} onSelectionChange={onSelectionChange} />);
        await waitFor(() => expect(pressed('b')).toBe('true'));
        expect(screen.getByTestId('sentinel-todo-detail-b').hidden).toBe(false);
        expect(onSelectionChange).toHaveBeenLastCalledWith('b');
        expect(screen.queryByTestId('sentinel-todo-item-not-found')).toBeNull();
    });

    it('re-selects the same item for a new nonce after the user moved away', async () => {
        get.mockResolvedValue(ledger([item({ id: 'a' }), item({ id: 'b' })]));
        const onSelectionChange = vi.fn();
        const view = render(<UnifiedTodoTab owner={OWNER} selectItemRequest={{ id: 'b', nonce: 1 }} onSelectionChange={onSelectionChange} />);
        await waitFor(() => expect(pressed('b')).toBe('true'));
        fireEvent.click(document.querySelector('[data-todo-select="a"]')!);
        expect(pressed('a')).toBe('true');
        expect(onSelectionChange).toHaveBeenLastCalledWith('a');

        // The same request object does not fire again.
        view.rerender(<UnifiedTodoTab owner={OWNER} selectItemRequest={{ id: 'b', nonce: 1 }} onSelectionChange={onSelectionChange} />);
        expect(pressed('a')).toBe('true');
        view.rerender(<UnifiedTodoTab owner={OWNER} selectItemRequest={{ id: 'b', nonce: 2 }} onSelectionChange={onSelectionChange} />);
        await waitFor(() => expect(pressed('b')).toBe('true'));
        expect(onSelectionChange).toHaveBeenLastCalledWith('b');
    });

    it('leaves the selection alone and shows a note for an unknown id', async () => {
        get.mockResolvedValue(ledger([item({ id: 'a' })]));
        const view = render(<UnifiedTodoTab owner={OWNER} selectItemRequest={{ id: 'a', nonce: 1 }} />);
        await waitFor(() => expect(pressed('a')).toBe('true'));
        view.rerender(<UnifiedTodoTab owner={OWNER} selectItemRequest={{ id: 'missing', nonce: 2 }} />);
        expect((await screen.findByTestId('sentinel-todo-item-not-found')).textContent).toContain('missing');
        expect(pressed('a')).toBe('true');

        // Selecting an item clears the note.
        view.rerender(<UnifiedTodoTab owner={OWNER} selectItemRequest={{ id: 'a', nonce: 3 }} />);
        fireEvent.click(document.querySelector('[data-todo-select="a"]')!);
        await waitFor(() => expect(screen.queryByTestId('sentinel-todo-item-not-found')).toBeNull());
    });

    it('waits for the ledger before applying a request', async () => {
        let resolve!: (value: SentinelTodoLedgerResponse) => void;
        get.mockReturnValue(new Promise(done => { resolve = done; }));
        render(<UnifiedTodoTab owner={OWNER} selectItemRequest={{ id: 'b', nonce: 1 }} />);
        expect(screen.queryByTestId('sentinel-todo-item-not-found')).toBeNull();
        await act(async () => { resolve(ledger([item({ id: 'a' }), item({ id: 'b' })])); });
        await waitFor(() => expect(pressed('b')).toBe('true'));
    });
});
