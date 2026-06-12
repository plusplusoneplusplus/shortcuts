/**
 * Tests for WorkItemContext — unseen state change tracking.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import type { ReactNode } from 'react';

import {
    WorkItemProvider,
    useWorkItems,
    loadUnseenWorkItemIds,
    UNSEEN_STORAGE_PREFIX,
    type WorkItemSummary,
} from '../../../../src/server/spa/client/react/contexts/WorkItemContext';

// Minimal test component that renders context state and exposes dispatch
let testDispatch: any;
function TestConsumer({ repoId = 'repo-1' }: { repoId?: string }) {
    const { state, dispatch } = useWorkItems();
    testDispatch = dispatch;
    const items = state.workItemsByRepo[repoId] || [];
    const unseen = state.unseenByRepo[repoId] || [];
    const realtimeRevision = state.realtimeRevisionByRepo[repoId] || 0;
    return (
        <div>
            <span data-testid="item-count">{items.length}</span>
            <span data-testid="unseen-count">{unseen.length}</span>
            <span data-testid="unseen-ids">{unseen.join(',')}</span>
            <span data-testid="realtime-revision">{realtimeRevision}</span>
        </div>
    );
}

function renderWithProvider(repoId = 'repo-1') {
    return render(
        <WorkItemProvider>
            <TestConsumer repoId={repoId} />
        </WorkItemProvider>,
    );
}

function makeItem(id: string, status = 'created'): WorkItemSummary {
    return {
        id,
        title: `Item ${id}`,
        status,
        source: 'user',
        createdAt: '2025-01-01',
        updatedAt: '2025-01-01',
    };
}

describe('WorkItemContext: unseen tracking', () => {
    beforeEach(() => {
        localStorage.clear();
        testDispatch = undefined;
    });
    afterEach(() => {
        localStorage.clear();
    });

    it('WORK_ITEM_ADDED marks the item as unseen', () => {
        renderWithProvider();
        act(() => testDispatch({ type: 'WORK_ITEM_ADDED', repoId: 'repo-1', item: makeItem('w1') }));
        expect(screen.getByTestId('unseen-count').textContent).toBe('1');
        expect(screen.getByTestId('unseen-ids').textContent).toBe('w1');
    });

    it('WORK_ITEM_ADDED with planning status marks item as unseen', () => {
        renderWithProvider();
        act(() => testDispatch({ type: 'WORK_ITEM_ADDED', repoId: 'repo-1', item: makeItem('w1', 'planning') }));
        expect(screen.getByTestId('unseen-count').textContent).toBe('1');
    });

    it('WORK_ITEM_UPDATED with status change marks item as unseen', () => {
        renderWithProvider();
        act(() => {
            testDispatch({ type: 'SET_WORK_ITEMS', repoId: 'repo-1', items: [makeItem('w1', 'created')] });
        });
        act(() => {
            testDispatch({ type: 'WORK_ITEM_UPDATED', repoId: 'repo-1', item: makeItem('w1', 'planning') });
        });
        expect(screen.getByTestId('unseen-count').textContent).toBe('1');
        expect(screen.getByTestId('unseen-ids').textContent).toBe('w1');
    });

    it('WORK_ITEM_UPDATED without status change does not mark as unseen', () => {
        renderWithProvider();
        act(() => {
            testDispatch({ type: 'SET_WORK_ITEMS', repoId: 'repo-1', items: [makeItem('w1', 'created')] });
        });
        act(() => {
            testDispatch({ type: 'WORK_ITEM_UPDATED', repoId: 'repo-1', item: { ...makeItem('w1', 'created'), title: 'Updated' } });
        });
        expect(screen.getByTestId('unseen-count').textContent).toBe('0');
    });

    it('WORK_ITEM_REMOVED removes item from unseen set', () => {
        renderWithProvider();
        act(() => testDispatch({ type: 'WORK_ITEM_ADDED', repoId: 'repo-1', item: makeItem('w1') }));
        expect(screen.getByTestId('unseen-count').textContent).toBe('1');
        act(() => testDispatch({ type: 'WORK_ITEM_REMOVED', repoId: 'repo-1', id: 'w1' }));
        expect(screen.getByTestId('unseen-count').textContent).toBe('0');
    });

    it('MARK_WORK_ITEMS_SEEN clears all unseen for a repo', () => {
        renderWithProvider();
        act(() => {
            testDispatch({ type: 'WORK_ITEM_ADDED', repoId: 'repo-1', item: makeItem('w1') });
            testDispatch({ type: 'WORK_ITEM_ADDED', repoId: 'repo-1', item: makeItem('w2') });
        });
        expect(screen.getByTestId('unseen-count').textContent).toBe('2');
        act(() => testDispatch({ type: 'MARK_WORK_ITEMS_SEEN', repoId: 'repo-1' }));
        expect(screen.getByTestId('unseen-count').textContent).toBe('0');
    });

    it('LOAD_UNSEEN_WORK_ITEMS filters to only existing item IDs', () => {
        renderWithProvider();
        act(() => {
            testDispatch({ type: 'SET_WORK_ITEMS', repoId: 'repo-1', items: [makeItem('w1'), makeItem('w2')] });
        });
        act(() => {
            testDispatch({ type: 'LOAD_UNSEEN_WORK_ITEMS', repoId: 'repo-1', ids: ['w1', 'w3', 'w99'] });
        });
        expect(screen.getByTestId('unseen-count').textContent).toBe('1');
        expect(screen.getByTestId('unseen-ids').textContent).toBe('w1');
    });

    it('duplicate WORK_ITEM_ADDED does not add duplicate unseen IDs', () => {
        renderWithProvider();
        act(() => {
            testDispatch({ type: 'WORK_ITEM_ADDED', repoId: 'repo-1', item: makeItem('w1') });
            testDispatch({ type: 'WORK_ITEM_ADDED', repoId: 'repo-1', item: makeItem('w1') });
        });
        expect(screen.getByTestId('item-count').textContent).toBe('1');
        expect(screen.getByTestId('unseen-ids').textContent).toBe('w1');
    });

    it('increments realtime revision for workspace-scoped work item events', () => {
        renderWithProvider();
        act(() => testDispatch({ type: 'WORK_ITEM_ADDED', repoId: 'repo-1', item: makeItem('w1') }));
        expect(screen.getByTestId('realtime-revision').textContent).toBe('1');
        act(() => testDispatch({ type: 'WORK_ITEM_UPDATED', repoId: 'repo-1', item: makeItem('w1', 'planning') }));
        expect(screen.getByTestId('realtime-revision').textContent).toBe('2');
        act(() => testDispatch({ type: 'WORK_ITEM_REMOVED', repoId: 'repo-1', id: 'w1' }));
        expect(screen.getByTestId('realtime-revision').textContent).toBe('3');
    });

    it('SET_WORK_ITEMS does not affect unseen set', () => {
        renderWithProvider();
        act(() => {
            testDispatch({ type: 'SET_WORK_ITEMS', repoId: 'repo-1', items: [makeItem('w1'), makeItem('w2')] });
        });
        expect(screen.getByTestId('unseen-count').textContent).toBe('0');
    });
});

describe('WorkItemContext: localStorage persistence', () => {
    beforeEach(() => {
        localStorage.clear();
    });
    afterEach(() => {
        localStorage.clear();
    });

    it('persists unseen IDs to localStorage on change', async () => {
        renderWithProvider();
        act(() => testDispatch({ type: 'WORK_ITEM_ADDED', repoId: 'repo-1', item: makeItem('w1') }));
        // useEffect runs async — wait a tick
        await act(async () => {});
        const stored = JSON.parse(localStorage.getItem(UNSEEN_STORAGE_PREFIX + 'repo-1') || '[]');
        expect(stored).toEqual(['w1']);
    });

    it('clears localStorage when all items marked seen', async () => {
        renderWithProvider();
        act(() => testDispatch({ type: 'WORK_ITEM_ADDED', repoId: 'repo-1', item: makeItem('w1') }));
        await act(async () => {});
        act(() => testDispatch({ type: 'MARK_WORK_ITEMS_SEEN', repoId: 'repo-1' }));
        await act(async () => {});
        const stored = JSON.parse(localStorage.getItem(UNSEEN_STORAGE_PREFIX + 'repo-1') || '[]');
        expect(stored).toEqual([]);
    });

    it('dispatches coc-seen-updated event when unseen changes', async () => {
        const handler = vi.fn();
        window.addEventListener('coc-seen-updated', handler);
        renderWithProvider();
        act(() => testDispatch({ type: 'WORK_ITEM_ADDED', repoId: 'repo-1', item: makeItem('w1') }));
        await act(async () => {});
        expect(handler).toHaveBeenCalled();
        window.removeEventListener('coc-seen-updated', handler);
    });
});

describe('loadUnseenWorkItemIds', () => {
    beforeEach(() => localStorage.clear());
    afterEach(() => localStorage.clear());

    it('returns empty array when no localStorage entry', () => {
        expect(loadUnseenWorkItemIds('repo-1')).toEqual([]);
    });

    it('returns stored IDs', () => {
        localStorage.setItem(UNSEEN_STORAGE_PREFIX + 'repo-1', JSON.stringify(['w1', 'w2']));
        expect(loadUnseenWorkItemIds('repo-1')).toEqual(['w1', 'w2']);
    });

    it('returns empty array on corrupt JSON', () => {
        localStorage.setItem(UNSEEN_STORAGE_PREFIX + 'repo-1', '{bad json');
        expect(loadUnseenWorkItemIds('repo-1')).toEqual([]);
    });
});

describe('WorkItemContext: grouped actions', () => {
    beforeEach(() => localStorage.clear());
    afterEach(() => localStorage.clear());

    it('SET_GROUPED_WORK_ITEMS populates items and per-status pagination', () => {
        renderWithProvider();
        act(() => {
            testDispatch({
                type: 'SET_GROUPED_WORK_ITEMS',
                repoId: 'repo-1',
                groups: {
                    created: {
                        items: [makeItem('w1', 'created'), makeItem('w2', 'created')],
                        total: 5,
                        hasMore: true,
                    },
                    done: {
                        items: [makeItem('w3', 'done')],
                        total: 1,
                        hasMore: false,
                    },
                },
            });
        });
        expect(screen.getByTestId('item-count').textContent).toBe('3');
    });

    it('SET_GROUPED_WORK_ITEMS replaces previous items', () => {
        renderWithProvider();
        act(() => {
            testDispatch({ type: 'SET_WORK_ITEMS', repoId: 'repo-1', items: [makeItem('old1'), makeItem('old2')], total: 2, hasMore: false });
        });
        expect(screen.getByTestId('item-count').textContent).toBe('2');

        act(() => {
            testDispatch({
                type: 'SET_GROUPED_WORK_ITEMS',
                repoId: 'repo-1',
                groups: {
                    created: { items: [makeItem('new1', 'created')], total: 1, hasMore: false },
                },
            });
        });
        expect(screen.getByTestId('item-count').textContent).toBe('1');
    });

    it('APPEND_STATUS_ITEMS appends items for a specific status', () => {
        renderWithProvider();
        act(() => {
            testDispatch({
                type: 'SET_GROUPED_WORK_ITEMS',
                repoId: 'repo-1',
                groups: {
                    created: { items: [makeItem('w1', 'created')], total: 3, hasMore: true },
                },
            });
        });
        expect(screen.getByTestId('item-count').textContent).toBe('1');

        act(() => {
            testDispatch({
                type: 'APPEND_STATUS_ITEMS',
                repoId: 'repo-1',
                status: 'created',
                items: [makeItem('w2', 'created'), makeItem('w3', 'created')],
                total: 3,
                hasMore: false,
                offset: 1,
            });
        });
        expect(screen.getByTestId('item-count').textContent).toBe('3');
    });

    it('APPEND_STATUS_ITEMS deduplicates items', () => {
        renderWithProvider();
        act(() => {
            testDispatch({
                type: 'SET_GROUPED_WORK_ITEMS',
                repoId: 'repo-1',
                groups: {
                    created: { items: [makeItem('w1', 'created')], total: 2, hasMore: true },
                },
            });
        });

        act(() => {
            testDispatch({
                type: 'APPEND_STATUS_ITEMS',
                repoId: 'repo-1',
                status: 'created',
                items: [makeItem('w1', 'created'), makeItem('w2', 'created')],
                total: 2,
                hasMore: false,
                offset: 1,
            });
        });
        expect(screen.getByTestId('item-count').textContent).toBe('2');
    });

    it('WebSocket WORK_ITEM_ADDED works alongside grouped state', () => {
        renderWithProvider();
        act(() => {
            testDispatch({
                type: 'SET_GROUPED_WORK_ITEMS',
                repoId: 'repo-1',
                groups: {
                    created: { items: [makeItem('w1', 'created')], total: 1, hasMore: false },
                },
            });
        });
        expect(screen.getByTestId('item-count').textContent).toBe('1');

        act(() => {
            testDispatch({ type: 'WORK_ITEM_ADDED', repoId: 'repo-1', item: makeItem('w2', 'created') });
        });
        expect(screen.getByTestId('item-count').textContent).toBe('2');
        expect(screen.getByTestId('unseen-count').textContent).toBe('1');
    });
});
