/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import {
    clearUnifiedTabGroupState, moveTabGroup, readUnifiedTabGroupOrder, readUnifiedTabGroupState, toggleGroupFolded,
    useUnifiedTabGroupOrder, useUnifiedTabGroupState,
} from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelTabGroupStore';
import { unifiedPanelStorageKey } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelTabsModel';
import { clearUnifiedPanelState } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelStore';

const key = (scope: string) => unifiedPanelStorageKey(scope).replace(/:tabs$/, ':groups');

describe('unifiedPanelTabGroupStore', () => {
    beforeEach(() => {
        localStorage.clear();
        clearUnifiedTabGroupState();
    });
    afterEach(() => {
        cleanup();
        vi.restoreAllMocks();
        clearUnifiedTabGroupState();
    });

    it('defaults to unfolded with stable snapshots', () => {
        const first = readUnifiedTabGroupState('one');
        expect([...first]).toEqual([]);
        expect(readUnifiedTabGroupState('one')).toBe(first);
    });

    it('retains the stable empty snapshot after scoped and global clears', () => {
        const empty = readUnifiedTabGroupState('one');
        toggleGroupFolded('one', 'files');
        clearUnifiedTabGroupState('one');
        expect(readUnifiedTabGroupState('one')).toBe(empty);
        toggleGroupFolded('one', 'web');
        clearUnifiedTabGroupState();
        expect(readUnifiedTabGroupState('one')).toBe(empty);
    });

    it('persists toggles using the panel scope and isolates equal workspace ids on different hosts', () => {
        toggleGroupFolded('host-a:workspace', 'files');
        toggleGroupFolded('host-a:workspace', 'tools');
        expect(JSON.parse(localStorage.getItem('unified-right-panel:host-a:workspace:groups')!)).toEqual({
            folded: ['tools', 'files'], order: ['tools', 'files', 'web', 'canvas'],
        });
        expect([...readUnifiedTabGroupState('host-b:workspace')]).toEqual([]);
        const first = readUnifiedTabGroupState('host-a:workspace');
        expect(readUnifiedTabGroupState('host-a:workspace')).toBe(first);
        toggleGroupFolded('host-a:workspace', 'files');
        expect([...readUnifiedTabGroupState('host-a:workspace')]).toEqual(['tools']);
        expect([...first]).toEqual(['tools', 'files']);
        toggleGroupFolded('host-a:workspace', 'tools');
        expect([...readUnifiedTabGroupState('host-a:workspace')]).toEqual([]);
    });

    it('restores uncached persisted state, filters unknown groups and deduplicates', () => {
        localStorage.setItem(key('uncached'), '["canvas","unknown","files","canvas",null]');
        const state = readUnifiedTabGroupState('uncached');
        expect([...state]).toEqual(['files', 'canvas']);
        expect(readUnifiedTabGroupState('uncached')).toBe(state);
    });

    it.each(['{broken', '{}', 'null', '"files"', '42', '["unknown"]'])('ignores malformed state %s', raw => {
        localStorage.setItem(key('one'), raw);
        expect([...readUnifiedTabGroupState('one')]).toEqual([]);
        expect(readUnifiedTabGroupState('one')).toBe(readUnifiedTabGroupState('one'));
    });

    it('clears one scope without changing another scope or tab descriptors', () => {
        toggleGroupFolded('one', 'tools');
        toggleGroupFolded('two', 'files');
        localStorage.setItem(unifiedPanelStorageKey('one'), 'descriptor');
        clearUnifiedTabGroupState('one');
        expect(localStorage.getItem(key('one'))).toBeNull();
        expect([...readUnifiedTabGroupState('one')]).toEqual([]);
        expect([...readUnifiedTabGroupState('two')]).toEqual(['files']);
        expect(localStorage.getItem(unifiedPanelStorageKey('one'))).toBe('descriptor');
    });

    it('clears all persisted group keys including scopes never read', () => {
        toggleGroupFolded('cached', 'files');
        localStorage.setItem(key('uncached'), '["web"]');
        localStorage.setItem(key('also-uncached'), '["canvas"]');
        localStorage.setItem('another:tabs:groups', 'unrelated');
        clearUnifiedTabGroupState();
        for (const scope of ['cached', 'uncached', 'also-uncached']) expect(localStorage.getItem(key(scope))).toBeNull();
        expect(localStorage.getItem('another:tabs:groups')).toBe('unrelated');
    });

    it('clears group state when the panel store is cleared', () => {
        toggleGroupFolded('one', 'tools');
        toggleGroupFolded('two', 'files');
        clearUnifiedPanelState('one');
        expect([...readUnifiedTabGroupState('one')]).toEqual([]);
        expect([...readUnifiedTabGroupState('two')]).toEqual(['files']);
        localStorage.setItem(key('uncached'), '["web"]');
        clearUnifiedPanelState();
        expect([...readUnifiedTabGroupState('two')]).toEqual([]);
        expect(localStorage.getItem(key('uncached'))).toBeNull();
    });

    it('shares live hook updates, responds to clears and changes scope', () => {
        const first = renderHook(({ scope }) => useUnifiedTabGroupState(scope), { initialProps: { scope: 'one' } });
        const second = renderHook(() => useUnifiedTabGroupState('one'));
        act(() => toggleGroupFolded('one', 'web'));
        expect([...first.result.current]).toEqual(['web']);
        expect(second.result.current).toBe(first.result.current);
        first.rerender({ scope: 'two' });
        expect([...first.result.current]).toEqual([]);
        act(() => toggleGroupFolded('two', 'canvas'));
        expect([...first.result.current]).toEqual(['canvas']);
        expect([...second.result.current]).toEqual(['web']);
        act(() => clearUnifiedTabGroupState());
        expect([...first.result.current]).toEqual([]);
        expect([...second.result.current]).toEqual([]);
    });

    it('refreshes subscribed snapshots for cross-window changes and storage clears', () => {
        const hook = renderHook(() => useUnifiedTabGroupState('one'));
        act(() => {
            localStorage.setItem(key('one'), '["web"]');
            window.dispatchEvent(new StorageEvent('storage', { key: key('one') }));
        });
        expect([...hook.result.current]).toEqual(['web']);
        act(() => {
            localStorage.clear();
            window.dispatchEvent(new StorageEvent('storage', { key: null }));
        });
        expect([...hook.result.current]).toEqual([]);
    });

    it('unsubscribes when unmounted', () => {
        const remove = vi.spyOn(window, 'removeEventListener');
        const hook = renderHook(() => useUnifiedTabGroupState('one'));
        hook.unmount();
        expect(remove).toHaveBeenCalledWith('storage', expect.any(Function));
        expect(() => toggleGroupFolded('one', 'tools')).not.toThrow();
    });

    it('does not throw when storage is disabled', () => {
        vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('disabled'); });
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('disabled'); });
        vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('disabled'); });
        expect([...readUnifiedTabGroupState('one')]).toEqual([]);
        expect(() => toggleGroupFolded('one', 'tools')).not.toThrow();
        expect(() => clearUnifiedTabGroupState('one')).not.toThrow();
        expect(() => clearUnifiedTabGroupState()).not.toThrow();
    });

    describe('group order', () => {
        it('defaults to the fixed order with a stable snapshot', () => {
            const first = readUnifiedTabGroupOrder('one');
            expect(first).toEqual(['tools', 'files', 'web', 'canvas']);
            expect(readUnifiedTabGroupOrder('one')).toBe(first);
        });

        it('persists moves beside fold state and keeps both through later writes', () => {
            toggleGroupFolded('one', 'tools');
            moveTabGroup('one', 'web', 'tools');
            expect(JSON.parse(localStorage.getItem(key('one'))!)).toEqual({
                folded: ['tools'], order: ['web', 'tools', 'files', 'canvas'],
            });
            toggleGroupFolded('one', 'files');
            expect(readUnifiedTabGroupOrder('one')).toEqual(['web', 'tools', 'files', 'canvas']);
            expect([...readUnifiedTabGroupState('one')]).toEqual(['tools', 'files']);
        });

        it('isolates workspaces and equal workspace ids on different hosts', () => {
            moveTabGroup('host-a:workspace', 'canvas', 'tools');
            expect(readUnifiedTabGroupOrder('host-a:workspace')).toEqual(['canvas', 'tools', 'files', 'web']);
            expect(readUnifiedTabGroupOrder('host-b:workspace')).toEqual(['tools', 'files', 'web', 'canvas']);
            expect(readUnifiedTabGroupOrder('other')).toEqual(['tools', 'files', 'web', 'canvas']);
        });

        it('reads legacy folded-only arrays with the default order', () => {
            localStorage.setItem(key('legacy'), '["files"]');
            expect([...readUnifiedTabGroupState('legacy')]).toEqual(['files']);
            expect(readUnifiedTabGroupOrder('legacy')).toEqual(['tools', 'files', 'web', 'canvas']);
            moveTabGroup('legacy', 'files', null);
            expect(JSON.parse(localStorage.getItem(key('legacy'))!)).toEqual({
                folded: ['files'], order: ['tools', 'web', 'canvas', 'files'],
            });
        });

        it('validates saved orders: unknown, repeated and missing groups reconcile', () => {
            localStorage.setItem(key('saved'), JSON.stringify({ folded: 'bad', order: ['web', 'nope', 'web', 'canvas'] }));
            expect(readUnifiedTabGroupOrder('saved')).toEqual(['web', 'canvas', 'tools', 'files']);
            expect([...readUnifiedTabGroupState('saved')]).toEqual([]);
            localStorage.setItem(key('saved'), JSON.stringify({ order: 7 }));
            expect(readUnifiedTabGroupOrder('saved')).toEqual(['tools', 'files', 'web', 'canvas']);
        });

        it('skips no-op moves without writing', () => {
            moveTabGroup('one', 'files', 'web');
            expect(localStorage.getItem(key('one'))).toBeNull();
        });

        it('notifies subscribers and resets on clear', () => {
            const { result } = renderHook(() => useUnifiedTabGroupOrder('hook'));
            expect(result.current).toEqual(['tools', 'files', 'web', 'canvas']);
            act(() => moveTabGroup('hook', 'web', null));
            expect(result.current).toEqual(['tools', 'files', 'canvas', 'web']);
            act(() => clearUnifiedTabGroupState('hook'));
            expect(result.current).toEqual(['tools', 'files', 'web', 'canvas']);
        });
    });
});
