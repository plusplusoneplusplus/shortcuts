/**
 * unifiedPanelStore / useUnifiedPanelTabs — persistence and the cross-tree
 * sharing that the unified right panel's entry points depend on.
 *
 * The point of these cases is not that the model works (it has its own suite)
 * but that the React face of it keeps three promises: one session shared by
 * every consumer of a workspace, a `chatId` that selects a *view* over stored
 * state rather than a separate session, and a reload that comes back with the
 * same tabs, order, and selection.
 *
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';

import {
    clearUnifiedPanelState,
    readUnifiedPanelState,
    useUnifiedPanelState,
    closeBrowserPanelView,
    writeUnifiedPanelState,
    closeDeletedExplorerTabs,
} from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelStore';
import { useUnifiedPanelTabs, type UnifiedPanelTabsApi } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/useUnifiedPanelTabs';
import {
    openTab,
    unifiedPanelStorageKey,
    unifiedTabId,
    EMPTY_UNIFIED_PANEL,
} from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelTabsModel';

const WS = 'ws-1';

/** Probe that exposes one consumer's view of the session to the test. */
function Probe({ workspaceId, chatId, name, onApi, reorderEnabled }: {
    workspaceId: string;
    chatId: string | null;
    name: string;
    onApi?: (api: UnifiedPanelTabsApi) => void;
    reorderEnabled?: boolean;
}) {
    const api = useUnifiedPanelTabs(workspaceId, chatId, reorderEnabled);
    onApi?.(api);
    return (
        <div>
            <span data-testid={`${name}-labels`}>{api.tabs.map(tab => tab.label).join(',')}</span>
            <span data-testid={`${name}-active`}>{api.active?.label ?? ''}</span>
        </div>
    );
}

function labels(name: string): string {
    return screen.getByTestId(`${name}-labels`).textContent ?? '';
}

function active(name: string): string {
    return screen.getByTestId(`${name}-active`).textContent ?? '';
}

describe('unifiedPanelStore', () => {
    beforeEach(() => {
        localStorage.clear();
        clearUnifiedPanelState();
    });
    afterEach(() => {
        cleanup();
        localStorage.clear();
        clearUnifiedPanelState();
    });

    it('closes deleted member files across all chats and cached scopes without crossing owners or path prefixes', () => {
        for (const scope of ['group-a', 'group-b']) {
            let state = EMPTY_UNIFIED_PANEL;
            for (const chatId of ['chat-a', 'chat-b']) {
                for (const [owner, route, path] of [
                    ['member', 'remote:server-a:member', 'src/a.ts'],
                    ['member', 'remote:server-a:member', 'src/deep/b.ts'],
                    ['member', 'remote:server-a:member', 'src-other/c.ts'],
                    ['member', 'remote:server-b:member', 'src/a.ts'],
                    ['other-member', 'remote:server-a:other-member', 'src/a.ts'],
                ]) {
                    state = openTab(state, { kind: 'file', ownerWorkspaceId: owner, ownerRoutingRef: route, chatId, resourceId: path, label: path });
                }
            }
            writeUnifiedPanelState(scope, state);
        }
        closeDeletedExplorerTabs('remote:server-a:member', 'src');
        for (const scope of ['group-a', 'group-b']) {
            const state = readUnifiedPanelState(scope);
            for (const tabs of Object.values(state.chatTabs)) {
                expect(tabs).toHaveLength(3);
                expect(tabs.filter(tab => tab.ownerRoutingRef === 'remote:server-a:member').map(tab => tab.resourceId)).toEqual(['src-other/c.ts']);
            }
            expect(Object.values(state.activeByScope).every(id =>
                Object.values(state.chatTabs).flat().some(tab => tab.id === id))).toBe(true);
        }
    });

    it('closes native browser views across cached inactive workspaces without removing other tabs', () => {
        for (const workspaceId of ['local-workspace', 'remote-workspace']) {
            let state = openTab(EMPTY_UNIFIED_PANEL, { kind: 'browser', ownerWorkspaceId: workspaceId, chatId: null, resourceId: 'closed-view', label: 'Browser' });
            state = openTab(state, { kind: 'terminal', ownerWorkspaceId: workspaceId, chatId: null, resourceId: 'terminal', label: 'Terminal' });
            writeUnifiedPanelState(workspaceId, state);
        }
        closeBrowserPanelView('closed-view');
        for (const workspaceId of ['local-workspace', 'remote-workspace']) {
            expect(readUnifiedPanelState(workspaceId).workspaceTabs.map(tab => tab.kind)).toEqual(['terminal']);
        }
        closeBrowserPanelView('missing-view');
        expect(readUnifiedPanelState('local-workspace').workspaceTabs).toHaveLength(1);
    });

    it('removes only the matching HTML guest descriptor from inactive workspaces', () => {
        for (const workspaceId of ['workspace-a', 'workspace-b']) {
            writeUnifiedPanelState(workspaceId, openTab(EMPTY_UNIFIED_PANEL, {
                kind: 'html-page', ownerWorkspaceId: workspaceId, chatId: null,
                resourceId: '/preview/page.html', htmlPageId: workspaceId, label: 'page.html',
            }));
        }
        closeBrowserPanelView('html-page:workspace-a');
        expect(readUnifiedPanelState('workspace-a').workspaceTabs).toEqual([]);
        expect(readUnifiedPanelState('workspace-b').workspaceTabs).toHaveLength(1);
    });

    it('starts empty and persists opened tabs under the workspace key', () => {
        let api!: UnifiedPanelTabsApi;
        render(<Probe workspaceId={WS} chatId="chat-1" name="a" onApi={next => { api = next; }} />);
        expect(labels('a')).toBe('');

        act(() => {
            api.open({ kind: 'terminal', ownerWorkspaceId: WS, chatId: 'chat-1', resourceId: 'sess-1', label: 'bash' });
        });

        expect(labels('a')).toBe('bash');
        const stored = localStorage.getItem(unifiedPanelStorageKey(WS));
        expect(stored).toContain('sess-1');
        // Descriptors only — a persisted tab is a pointer, never a copy.
        expect(stored).not.toContain('output');
    });

    it('persists mixed order across remount/reload and isolates same-id remote panel scopes', () => {
        let api!: UnifiedPanelTabsApi;
        const ownerA = 'remote:host-a:workspace';
        const ownerB = 'remote:host-b:workspace';
        const props = { workspaceId: ownerA, chatId: 'chat-a', name: 'a', reorderEnabled: true, onApi: (next: UnifiedPanelTabsApi) => { api = next; } };
        const mounted = render(<Probe {...props} />);
        act(() => {
            api.open({ kind: 'terminal', ownerWorkspaceId: 'workspace', ownerRoutingRef: ownerA, chatId: 'chat-a', resourceId: 'terminal', label: 'Terminal' });
            api.open({ kind: 'file', ownerWorkspaceId: 'workspace', ownerRoutingRef: ownerA, chatId: 'chat-a', resourceId: 'sample.md', label: 'File' });
        });
        act(() => {
            api.move(api.tabs.find(tab => tab.kind === 'file')!.id, api.tabs.find(tab => tab.kind === 'terminal')!.id);
        });
        expect(labels('a')).toBe('File,Terminal');
        const selected = api.activeId;
        const raw = localStorage.getItem(unifiedPanelStorageKey(ownerA))!;
        mounted.unmount();
        render(<Probe {...props} />);
        expect(labels('a')).toBe('File,Terminal');
        expect(api.activeId).toBe(selected);
        cleanup();
        clearUnifiedPanelState(ownerA);
        localStorage.setItem(unifiedPanelStorageKey(ownerA), raw);
        render(<Probe {...props} />);
        expect(labels('a')).toBe('File,Terminal');
        const restored = readUnifiedPanelState(ownerA);
        writeUnifiedPanelState(ownerB, { ...restored, orderByScope: undefined });
        render(<Probe {...props} workspaceId={ownerB} name="b" onApi={undefined} />);
        expect(labels('b')).toBe('Terminal,File');
        act(() => api.move(api.tabs[0].id, null));
        expect(labels('a')).toBe('Terminal,File');
        expect(labels('b')).toBe('Terminal,File');
        expect(readUnifiedPanelState(ownerB).orderByScope).toBeUndefined();
    });

    it('shares one session across consumers mounted in separate subtrees', () => {
        let opener!: UnifiedPanelTabsApi;
        render(
            <>
                <Probe workspaceId={WS} chatId="chat-1" name="a" onApi={next => { opener = next; }} />
                <Probe workspaceId={WS} chatId="chat-1" name="b" />
            </>,
        );

        act(() => {
            opener.open({ kind: 'file', ownerWorkspaceId: WS, chatId: 'chat-1', resourceId: 'src/a.ts', label: 'a.ts' });
        });

        // The second probe never opened anything; it sees the tab because the
        // session lives in the store, not in the opener's subtree.
        expect(labels('b')).toBe('a.ts');
        expect(active('b')).toBe('a.ts');
    });

    it('keeps each workspace independent', () => {
        let a!: UnifiedPanelTabsApi;
        render(
            <>
                <Probe workspaceId="ws-a" chatId={null} name="a" onApi={next => { a = next; }} />
                <Probe workspaceId="ws-b" chatId={null} name="b" />
            </>,
        );

        act(() => {
            a.open({ kind: 'terminal', ownerWorkspaceId: 'ws-a', chatId: null, resourceId: 's', label: 'bash' });
        });

        expect(labels('a')).toBe('bash');
        expect(labels('b')).toBe('');
    });

    it('shows workspace tabs in every chat and chat tabs only in their own', () => {
        let api!: UnifiedPanelTabsApi;
        const { rerender } = render(<Probe workspaceId={WS} chatId="chat-1" name="a" onApi={next => { api = next; }} />);

        act(() => {
            api.open({ kind: 'terminal', ownerWorkspaceId: WS, chatId: 'chat-1', resourceId: 's', label: 'bash' });
            api.open({ kind: 'file', ownerWorkspaceId: WS, chatId: 'chat-1', resourceId: 'src/a.ts', label: 'a.ts' });
        });
        expect(labels('a')).toBe('bash,a.ts');
        expect(active('a')).toBe('a.ts');

        rerender(<Probe workspaceId={WS} chatId="chat-2" name="a" onApi={next => { api = next; }} />);
        expect(labels('a')).toBe('bash');

        // Returning restores chat 1's own tab *and* the selection it had.
        rerender(<Probe workspaceId={WS} chatId="chat-1" name="a" onApi={next => { api = next; }} />);
        expect(labels('a')).toBe('bash,a.ts');
        expect(active('a')).toBe('a.ts');
    });

    it('restores tabs, order, and per-chat selection after a reload', () => {
        let api!: UnifiedPanelTabsApi;
        const { unmount } = render(<Probe workspaceId={WS} chatId="chat-1" name="a" onApi={next => { api = next; }} />);
        act(() => {
            api.open({ kind: 'terminal', ownerWorkspaceId: WS, chatId: 'chat-1', resourceId: 's', label: 'bash' });
            api.open({ kind: 'file', ownerWorkspaceId: WS, chatId: 'chat-1', resourceId: 'src/a.ts', label: 'a.ts' });
            api.open({ kind: 'file', ownerWorkspaceId: WS, chatId: 'chat-1', resourceId: 'src/b.ts', label: 'b.ts' });
            api.activate(unifiedTabId({ kind: 'file', ownerWorkspaceId: WS, chatId: 'chat-1', resourceId: 'src/a.ts' }));
        });
        unmount();

        // A reload keeps localStorage but drops every in-memory snapshot.
        clearInMemorySnapshots();
        render(<Probe workspaceId={WS} chatId="chat-1" name="a" />);
        expect(labels('a')).toBe('bash,a.ts,b.ts');
        expect(active('a')).toBe('a.ts');
    });

    it('degrades a corrupt payload to an empty panel instead of throwing', () => {
        localStorage.setItem(unifiedPanelStorageKey(WS), '{not json');
        render(<Probe workspaceId={WS} chatId="chat-1" name="a" />);
        expect(labels('a')).toBe('');
    });

    it('survives storage that throws on read', () => {
        const original = Storage.prototype.getItem;
        Storage.prototype.getItem = () => { throw new Error('denied'); };
        try {
            expect(readUnifiedPanelState(WS)).toBe(EMPTY_UNIFIED_PANEL);
        } finally {
            Storage.prototype.getItem = original;
        }
    });

    it('composes two actions fired in the same tick', () => {
        let api!: UnifiedPanelTabsApi;
        render(<Probe workspaceId={WS} chatId="chat-1" name="a" onApi={next => { api = next; }} />);
        act(() => {
            api.open({ kind: 'file', ownerWorkspaceId: WS, chatId: 'chat-1', resourceId: 'a.ts', label: 'a.ts' });
            api.open({ kind: 'file', ownerWorkspaceId: WS, chatId: 'chat-1', resourceId: 'b.ts', label: 'b.ts' });
        });
        // The second open read the freshest state rather than the render's, so
        // it appended instead of clobbering the first.
        expect(labels('a')).toBe('a.ts,b.ts');
    });

    it('closes and reorders through the same shared session', () => {
        let api!: UnifiedPanelTabsApi;
        render(<Probe workspaceId={WS} chatId="chat-1" name="a" onApi={next => { api = next; }} />);
        const idA = unifiedTabId({ kind: 'file', ownerWorkspaceId: WS, chatId: 'chat-1', resourceId: 'a.ts' });
        const idB = unifiedTabId({ kind: 'file', ownerWorkspaceId: WS, chatId: 'chat-1', resourceId: 'b.ts' });
        act(() => {
            api.open({ kind: 'file', ownerWorkspaceId: WS, chatId: 'chat-1', resourceId: 'a.ts', label: 'a.ts' });
            api.open({ kind: 'file', ownerWorkspaceId: WS, chatId: 'chat-1', resourceId: 'b.ts', label: 'b.ts' });
        });
        act(() => { api.move(idB, idA); });
        expect(labels('a')).toBe('b.ts,a.ts');

        act(() => { api.close(idB); });
        expect(labels('a')).toBe('a.ts');

        act(() => { api.close(idA); });
        expect(labels('a')).toBe('');
    });

    it('does not notify subscribers for a no-op operation', () => {
        let renders = 0;
        function Counter() {
            const [state] = useUnifiedPanelState(WS);
            renders += 1;
            return <span data-testid="count">{state.workspaceTabs.length}</span>;
        }
        let api!: UnifiedPanelTabsApi;
        render(
            <>
                <Counter />
                <Probe workspaceId={WS} chatId={null} name="a" onApi={next => { api = next; }} />
            </>,
        );
        const before = renders;
        // Activating a tab that does not exist is a model no-op; the store must
        // not turn it into a write and a re-render of every consumer.
        act(() => { api.activate('does-not-exist'); });
        expect(renders).toBe(before);
    });
});

/**
 * Simulate a page reload: localStorage keeps its contents, but the module-level
 * snapshot cache and subscriber set are gone. `clearUnifiedPanelState` also
 * removes the stored value, so re-persist it around the reset.
 */
function clearInMemorySnapshots(): void {
    const saved = new Map<string, string>();
    for (let i = 0; i < localStorage.length; i += 1) {
        const key = localStorage.key(i)!;
        saved.set(key, localStorage.getItem(key)!);
    }
    clearUnifiedPanelState();
    for (const [key, value] of saved) localStorage.setItem(key, value);
}

describe('readUnifiedPanelState', () => {
    afterEach(() => {
        localStorage.clear();
        clearUnifiedPanelState();
    });

    it('returns the same reference while the stored text is unchanged', () => {
        const state = openTab(EMPTY_UNIFIED_PANEL, {
            kind: 'terminal', ownerWorkspaceId: WS, chatId: null, resourceId: 's', label: 'bash',
        });
        localStorage.setItem(unifiedPanelStorageKey(WS), JSON.stringify({
            version: 1,
            workspaceTabs: [...state.workspaceTabs],
            chatTabs: {},
            activeByScope: {},
        }));
        // useSyncExternalStore re-renders on every new reference; an unstable
        // snapshot here loops forever rather than failing loudly.
        expect(readUnifiedPanelState(WS)).toBe(readUnifiedPanelState(WS));
    });
});
