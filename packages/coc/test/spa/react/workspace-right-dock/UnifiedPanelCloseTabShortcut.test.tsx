/**
 * Ctrl/Cmd+W closes the active unified-right-panel tab.
 *
 * The rule itself is unit-tested in `closeTabRouting.test.ts`; these cases prove
 * the shell wires it up the way the panel's other shortcut does — a
 * capture-phase listener on `document`, live DOM containment against the panel
 * root rather than focus state in the store, and a close that goes through
 * `requestClose` so the terminal and unsaved-buffer guards still run.
 *
 * The load-bearing negative: while the panel holds the focus the browser must
 * never get this key, not even when there is nothing left to close.
 *
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createPortal } from 'react-dom';
import type { TerminalSessionSummary } from '../../../../src/server/spa/client/react/features/terminal/TerminalView';

// A terminal view with something focusable in it, so "focus is inside the
// active terminal" can be set up exactly as xterm's hidden textarea would.
let reportSessions: (sessions: readonly TerminalSessionSummary[]) => void = () => {};
vi.mock('../../../../src/server/spa/client/react/features/terminal/TerminalView', () => ({
    TerminalView: ({ onSessionsChange }: {
        onSessionsChange?: (sessions: readonly TerminalSessionSummary[]) => void;
    }) => {
        reportSessions = sessions => onSessionsChange?.(sessions);
        return <textarea data-testid="mock-terminal-input" />;
    },
}));
vi.mock('../../../../src/server/spa/client/react/features/notes/NotesView', () => ({
    NotesView: () => <textarea data-testid="mock-notes-input" />,
}));
vi.mock('../../../../src/server/spa/client/react/features/repo-detail/explorer/ExplorerPanel', () => ({
    ExplorerPanel: () => <div data-testid="mock-explorer" />,
    getAncestorPaths: () => [],
}));
vi.mock('../../../../src/server/spa/client/react/features/repo-detail/explorer/explorerApi', () => ({
    explorerApi: {
        searchFiles: async () => ({ results: [] }),
        readBlob: async () => ({ content: '', encoding: 'utf-8', mimeType: 'text/plain' }),
        writeBlob: async () => ({ success: true }),
        readTrustedBlob: async () => ({ content: '', encoding: 'utf-8', mimeType: 'text/plain' }),
        tree: async () => ({ entries: [] }),
    },
}));
vi.mock('../../../../src/server/spa/client/react/repos/cloneRegistry', () => ({
    getCocClientForWorkspace: () => ({
        canvases: { list: async () => [], create: async () => ({ id: 'c1', title: 'c' }) },
        workspaces: { deleteTerminal: async () => undefined },
    }),
    lookupCloneBaseUrl: () => null,
}));

const nativeMenu = vi.hoisted(() => ({
    enabled: false,
    callback: (_event: { viewId: string }) => {},
}));
vi.mock('../../../../src/server/spa/client/react/shared/file-path/browser-bridge', async importOriginal => ({
    ...await importOriginal<typeof import('../../../../src/server/spa/client/react/shared/file-path/browser-bridge')>(),
    desktopBrowserBridge: () => nativeMenu.enabled ? {
        onNewTab: () => () => {},
        onOpenMenuRequested: (callback: (event: { viewId: string }) => void) => {
            nativeMenu.callback = callback;
            return () => { nativeMenu.callback = () => {}; };
        },
    } : undefined,
}));

import { UnifiedRightPanel } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/UnifiedRightPanel';
import { readUnifiedPanelState, clearUnifiedPanelState } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelStore';
import { clearUnifiedTreeState } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelTree';
import type { WorkspaceDockController } from '../../../../src/server/spa/client/react/features/repo-detail/useWorkspaceDock';
import { getUnifiedGitTabDirtyBridge, openUnifiedGitTab, useUnifiedGitTabHost } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedGitTabHost';

const WS = 'ws-1';

function GitDetailPortal({ scope = WS }: { scope?: string }) {
    const host = useUnifiedGitTabHost(scope);
    return host ? createPortal(<div>
        <span data-testid={`git-line-${scope}`}>diff content</span>
        <div className="monaco-editor"><textarea data-testid={`git-editor-${scope}`} /></div>
        <button data-testid={`git-action-${scope}`}>Save</button>
    </div>, host) : null;
}

function dockStub(overrides: Partial<WorkspaceDockController> = {}): WorkspaceDockController {
    return {
        isOpen: true,
        toggleOpen: vi.fn(),
        mode: 'explorer',
        selectMode: vi.fn(),
        target: WS,
        setTarget: vi.fn(),
        targets: [],
        width: 420,
        maxWidth: 900,
        isDragging: false,
        handleMouseDown: vi.fn(),
        handleTouchStart: vi.fn(),
        ...overrides,
    };
}

/**
 * jsdom runs no layout, so `offsetParent` is null on every element and the
 * panel's hidden-pane guard would reject a panel that is plainly on screen.
 * Report the parent instead — which is still null for a collapsed panel's own
 * `display:none` root only if we say so, so key off the inline style.
 */
function stubOffsetParent() {
    Object.defineProperty(HTMLElement.prototype, 'offsetParent', {
        configurable: true,
        get(this: HTMLElement) {
            return this.style.display === 'none' ? null : this.parentElement ?? document.body;
        },
    });
}

function renderPanel(props: Partial<React.ComponentProps<typeof UnifiedRightPanel>> = {}) {
    const dock = props.dock ?? dockStub();
    return render(<UnifiedRightPanel workspaceId={WS} dock={dock} {...props} />);
}

/** Open one of the "+" menu's workspace resources. */
function openResource(id: 'terminal' | 'notes') {
    fireEvent.click(screen.getByTestId('unified-panel-open-menu'));
    fireEvent.click(screen.getByTestId(`unified-panel-open-${id}`));
}

/** Press the shortcut on `document`, exactly as the browser dispatches it. */
function pressCloseTab(init: { metaKey?: boolean } = {}) {
    const event = new KeyboardEvent('keydown', {
        key: 'w', ctrlKey: !init.metaKey, metaKey: init.metaKey === true, bubbles: true, cancelable: true,
    });
    act(() => { document.dispatchEvent(event); });
    return event;
}

/** Every open tab in the strip, by kind. */
function tabKinds(): string[] {
    return Array.from(document.querySelectorAll('[role="tab"]'))
        .map(node => node.getAttribute('data-kind') ?? '');
}

function focusIn(testId: string) {
    const el = screen.getByTestId(testId) as HTMLElement;
    act(() => { el.focus(); });
    expect(document.activeElement).toBe(el);
}

describe('unified panel close-tab shortcut', () => {
    beforeEach(() => {
        localStorage.clear();
        clearUnifiedPanelState();
        clearUnifiedTreeState();
        stubOffsetParent();
    });
    afterEach(() => {
        cleanup();
        clearUnifiedPanelState();
        clearUnifiedTreeState();
    });

    it.each([false, true])('closes Git after clicking portaled diff content (meta=%s)', metaKey => {
        render(<><UnifiedRightPanel workspaceId={WS} dock={dockStub()} /><GitDetailPortal /></>);
        act(() => { openUnifiedGitTab(WS, { ownerWorkspaceId: WS, chatId: null }); });
        expect(pressCloseTab({ metaKey }).defaultPrevented).toBe(false);
        fireEvent.mouseDown(screen.getByTestId(`git-line-${WS}`));
        expect(document.activeElement).toBe(screen.getByTestId('unified-git-tab'));
        expect(pressCloseTab({ metaKey }).defaultPrevented).toBe(true);
        expect(tabKinds()).toEqual([]);
    });

    it('preserves editor and control focus and closes Git before editor key handlers', () => {
        render(<><UnifiedRightPanel workspaceId={WS} dock={dockStub()} /><GitDetailPortal /></>);
        openResource('notes');
        act(() => { openUnifiedGitTab(WS, { ownerWorkspaceId: WS, chatId: null }); });
        for (const target of [`git-editor-${WS}`, `git-action-${WS}`]) {
            focusIn(target);
            fireEvent.mouseDown(screen.getByTestId(target));
            expect(document.activeElement).toBe(screen.getByTestId(target));
        }
        focusIn(`git-editor-${WS}`);
        const editorHandler = vi.fn((event: Event) => event.stopPropagation());
        const editor = screen.getByTestId(`git-editor-${WS}`);
        editor.addEventListener('keydown', editorHandler);
        const event = new KeyboardEvent('keydown', { key: 'w', ctrlKey: true, bubbles: true, cancelable: true });
        act(() => { editor.dispatchEvent(event); });
        expect(event.defaultPrevented).toBe(true);
        expect(editorHandler).not.toHaveBeenCalled();
        expect(tabKinds()).toEqual(['notes']);
    });

    it('closes only the focused panel and yields when the composer regains focus', () => {
        render(<>
            <textarea data-testid="composer" />
            <UnifiedRightPanel workspaceId={WS} dock={dockStub()} /><GitDetailPortal />
            <UnifiedRightPanel workspaceId="ws-2" dock={dockStub({ target: 'ws-2' })} /><GitDetailPortal scope="ws-2" />
        </>);
        act(() => {
            for (const scope of [WS, 'ws-2']) openUnifiedGitTab(scope, { ownerWorkspaceId: scope, chatId: null });
        });
        fireEvent.mouseDown(screen.getByTestId('git-line-ws-2'));
        focusIn('composer');
        expect(pressCloseTab().defaultPrevented).toBe(false);
        expect(tabKinds()).toEqual(['git', 'git']);
        fireEvent.mouseDown(screen.getByTestId('git-line-ws-2'));
        expect(pressCloseTab().defaultPrevented).toBe(true);
        expect(tabKinds()).toEqual(['git']);
        expect(screen.getByTestId(`git-line-${WS}`)).toBeTruthy();
    });

    it('uses the dirty Git close guard, preserving Cancel and failed saves', async () => {
        render(<><UnifiedRightPanel workspaceId={WS} dock={dockStub()} /><GitDetailPortal /></>);
        act(() => { openUnifiedGitTab(WS, { ownerWorkspaceId: WS, chatId: null }); });
        const save = vi.fn(async () => false);
        act(() => {
            const bridge = getUnifiedGitTabDirtyBridge(WS)!;
            bridge.onRegisterSave(save);
            bridge.onDirtyChange(true);
        });
        fireEvent.mouseDown(screen.getByTestId(`git-line-${WS}`));
        pressCloseTab();
        fireEvent.click(screen.getByTestId('explorer-close-cancel-btn'));
        expect(tabKinds()).toEqual(['git']);
        focusIn(`git-editor-${WS}`);
        pressCloseTab({ metaKey: true });
        fireEvent.click(screen.getByTestId('explorer-close-save-btn'));
        await screen.findByTestId('explorer-close-tabs-error');
        expect(tabKinds()).toEqual(['git']);
        fireEvent.click(screen.getByTestId('explorer-close-dont-save-btn'));
        expect(tabKinds()).toEqual([]);
        expect(save).toHaveBeenCalledOnce();
    });

    it('closes the active tab on Ctrl+W with focus inside the panel', () => {
        renderPanel();
        openResource('notes');
        expect(tabKinds()).toEqual(['notes']);

        focusIn('mock-notes-input');
        const event = pressCloseTab();

        expect(event.defaultPrevented).toBe(true);
        expect(tabKinds()).toEqual([]);
    });

    it('closes on Cmd+W too, for macOS', () => {
        renderPanel();
        openResource('notes');
        focusIn('mock-notes-input');

        expect(pressCloseTab({ metaKey: true }).defaultPrevented).toBe(true);
        expect(tabKinds()).toEqual([]);
    });

    it('closes only the active tab, leaving the rest open', () => {
        renderPanel();
        openResource('terminal');
        openResource('notes');
        expect(tabKinds()).toEqual(['terminal', 'notes']);

        // Notes was opened last, so it is the active tab.
        focusIn('mock-notes-input');
        pressCloseTab();
        expect(tabKinds()).toEqual(['terminal']);
    });

    it('does nothing when focus is outside the panel', () => {
        renderPanel();
        openResource('notes');

        const outside = document.createElement('input');
        document.body.appendChild(outside);
        act(() => { outside.focus(); });

        const event = pressCloseTab();
        expect(event.defaultPrevented).toBe(false);
        expect(tabKinds()).toEqual(['notes']);
        outside.remove();
    });

    it('does nothing when nothing is focused', () => {
        renderPanel();
        openResource('notes');
        act(() => { (document.activeElement as HTMLElement | null)?.blur(); });
        expect(document.activeElement).toBe(document.body);

        const event = pressCloseTab();
        expect(event.defaultPrevented).toBe(false);
        expect(tabKinds()).toEqual(['notes']);
    });

    it('does nothing while the panel is collapsed', () => {
        // Open a tab, then reopen the panel collapsed: the tab survives (it is
        // persisted), the strip is still in the DOM behind `display:none`, and
        // focus is put on it so the *only* thing rejecting the key is the
        // hidden-root guard rather than "nothing is focused".
        renderPanel();
        openResource('notes');
        cleanup();
        renderPanel({ dock: dockStub({ isOpen: false }) });
        expect(tabKinds()).toEqual(['notes']);

        const tab = document.querySelector('[role="tab"][data-kind="notes"]') as HTMLElement;
        act(() => { tab.focus(); });
        expect(document.activeElement).toBe(tab);
        expect(screen.getByTestId('unified-right-panel').offsetParent).toBeNull();

        const event = pressCloseTab();
        expect(event.defaultPrevented).toBe(false);
        expect(tabKinds()).toEqual(['notes']);
    });

    it('swallows the key with an empty strip — the browser window never closes', () => {
        renderPanel();
        openResource('notes');
        focusIn('mock-notes-input');
        pressCloseTab();
        expect(tabKinds()).toEqual([]);

        // Focus fell back into the panel's empty state; put it somewhere
        // explicit inside the root so containment is unambiguous.
        focusIn('unified-panel-empty-open');
        const event = pressCloseTab();
        expect(event.defaultPrevented).toBe(true);
        expect(screen.getByTestId('unified-panel-empty')).toBeTruthy();
        expect(screen.getByTestId('unified-right-panel')).toBeTruthy();
    });

    it('lets a plain Ctrl+W through to the shell while a terminal has focus', () => {
        renderPanel();
        openResource('terminal');
        focusIn('mock-terminal-input');

        const event = pressCloseTab();
        expect(event.defaultPrevented).toBe(false);
        expect(tabKinds()).toEqual(['terminal']);
    });

    it('closes the terminal tab on Cmd+W', () => {
        renderPanel();
        openResource('terminal');
        focusIn('mock-terminal-input');

        const event = pressCloseTab({ metaKey: true });
        expect(event.defaultPrevented).toBe(true);
        expect(tabKinds()).toEqual([]);
    });

    it('takes Ctrl+W when a terminal is active but the focus is on the tab strip', () => {
        renderPanel();
        openResource('terminal');
        const tab = document.querySelector('[role="tab"][data-kind="terminal"]') as HTMLElement;
        act(() => { tab.focus(); });

        const event = pressCloseTab();
        expect(event.defaultPrevented).toBe(true);
        expect(tabKinds()).toEqual([]);
    });

    it('routes through requestClose, so a live terminal still asks first', () => {
        renderPanel();
        openResource('terminal');
        act(() => { reportSessions([{ id: 't1', serverSessionId: 's-1', status: 'running' }]); });
        focusIn('mock-terminal-input');

        pressCloseTab({ metaKey: true });

        expect(screen.getByTestId('unified-panel-close-confirm')).toBeTruthy();
        expect(tabKinds()).toEqual(['terminal']);
    });

    it('stops propagation, so no bubble-phase owner sees the key', () => {
        renderPanel();
        openResource('notes');
        focusIn('mock-notes-input');

        const bubbled = vi.fn();
        document.addEventListener('keydown', bubbled);
        pressCloseTab();
        document.removeEventListener('keydown', bubbled);

        expect(bubbled).not.toHaveBeenCalled();
    });
});

function pressAddTab(init: KeyboardEventInit = {}) {
    const event = new KeyboardEvent('keydown', {
        key: 't', ctrlKey: true, bubbles: true, cancelable: true, ...init,
    });
    act(() => { (document.activeElement ?? document).dispatchEvent(event); });
    return event;
}

describe('unified panel new-browser shortcut', () => {
    beforeEach(() => {
        localStorage.clear();
        clearUnifiedPanelState();
        clearUnifiedTreeState();
        stubOffsetParent();
    });
    afterEach(() => { cleanup(); nativeMenu.enabled = false; clearUnifiedPanelState(); clearUnifiedTreeState(); });

    function expectNewBrowser(count: number) {
        expect(tabKinds()).toEqual(Array(count).fill('browser'));
        expect(screen.getByRole('tab', { selected: true }).textContent).toContain('New Tab');
        const addresses = screen.getAllByTestId('browser-address');
        expect(document.activeElement).toBe(addresses[count - 1]);
        expect((document.activeElement as HTMLInputElement).value).toBe('');
        expect(screen.queryByTestId('unified-panel-open-menu-popover')).toBeNull();
    }

    it.each([{ ctrlKey: true }, { ctrlKey: false, metaKey: true }])(
        'creates and activates one blank browser with address focus from an empty panel (%j)', modifiers => {
            renderPanel();
            expect(document.activeElement).toBe(document.body);
            expect(pressAddTab(modifiers).defaultPrevented).toBe(true);
            expectNewBrowser(1);
            // The freshly focused address must accept the next chord, too.
            expect(pressAddTab(modifiers).defaultPrevented).toBe(true);
            expectNewBrowser(2);
            act(() => { (document.activeElement as HTMLElement).blur(); });
            expect(pressAddTab(modifiers).defaultPrevented).toBe(true);
            expectNewBrowser(3);
            expect(pressAddTab({ ...modifiers, repeat: true }).defaultPrevented).toBe(true);
            expectNewBrowser(3);
        },
    );

    it.each(['unified-panel-empty-open', 'unified-panel-open-menu'])(
        'opens directly from panel chrome (%s)', trigger => {
            renderPanel();
            focusIn(trigger);
            expect(pressAddTab().defaultPrevented).toBe(true);
            expectNewBrowser(1);
        },
    );

    it('replaces an open add menu and preserves click toggling', () => {
        renderPanel();
        fireEvent.click(screen.getByTestId('unified-panel-open-menu'));
        const input = screen.getByTestId('unified-panel-open-menu-search');
        input.focus();
        fireEvent.change(input, { target: { value: 'abc' } });
        expect(pressAddTab().defaultPrevented).toBe(true);
        expectNewBrowser(1);
        fireEvent.click(screen.getByTestId('unified-panel-open-menu'));
        expect(screen.getByTestId('unified-panel-open-menu-search')).toBeTruthy();
        fireEvent.click(screen.getByTestId('unified-panel-open-menu'));
        expect(screen.queryByTestId('unified-panel-open-menu-popover')).toBeNull();
    });

    it('ignores unrelated focus, modifiers, composition and previously handled events', () => {
        renderPanel();
        const outside = document.createElement('button');
        document.body.appendChild(outside);
        outside.focus();
        expect(pressAddTab().defaultPrevented).toBe(false);
        outside.remove();
        focusIn('unified-panel-open-menu');
        for (const init of [{ altKey: true }, { shiftKey: true }, { ctrlKey: false }, { isComposing: true }, { key: 'w', altKey: true }]) {
            expect(pressAddTab(init).defaultPrevented).toBe(false);
        }
        const consumed = new KeyboardEvent('keydown', { key: 't', ctrlKey: true, bubbles: true, cancelable: true });
        consumed.preventDefault();
        act(() => { document.activeElement!.dispatchEvent(consumed); });
        expect(tabKinds()).toEqual([]);
    });

    it('preserves editable and terminal content, while allowing the strip shortcut', () => {
        renderPanel();
        for (const kind of ['notes', 'terminal'] as const) {
            openResource(kind);
            focusIn(`mock-${kind}-input`);
            expect(pressAddTab().defaultPrevented).toBe(false);
        }
        const editable = document.createElement('div');
        editable.setAttribute('contenteditable', 'true');
        editable.tabIndex = 0;
        screen.getByTestId('unified-right-panel').appendChild(editable);
        editable.focus();
        expect(pressAddTab().defaultPrevented).toBe(false);
        editable.remove();
        focusIn('unified-panel-open-menu');
        expect(pressAddTab().defaultPrevented).toBe(true);
        expect(tabKinds()).toEqual(['notes', 'terminal', 'browser']);
        expect(document.activeElement).toBe(screen.getByTestId('browser-address'));
    });

    it('preserves Monaco bindings even on non-editable editor chrome', () => {
        render(<><UnifiedRightPanel workspaceId={WS} dock={dockStub()} /><GitDetailPortal /></>);
        act(() => { openUnifiedGitTab(WS, { ownerWorkspaceId: WS, chatId: null }); });
        const editor = screen.getByTestId(`git-editor-${WS}`).parentElement!;
        editor.tabIndex = 0;
        editor.focus();
        expect(pressAddTab().defaultPrevented).toBe(false);
        expect(tabKinds()).toEqual(['git']);
    });

    it('uses only the focused workspace and declines ambiguous body focus', () => {
        render(<>
            <UnifiedRightPanel workspaceId={WS} dock={dockStub()} />
            <UnifiedRightPanel workspaceId="ws-2" dock={dockStub({ target: 'ws-2' })} />
        </>);
        expect(pressAddTab().defaultPrevented).toBe(false);
        const panels = screen.getAllByTestId('unified-right-panel');
        panels[1].querySelector<HTMLElement>('[data-testid="unified-panel-open-menu"]')!.focus();
        expect(pressAddTab().defaultPrevented).toBe(true);
        expectNewBrowser(1);
        expect(readUnifiedPanelState(WS).workspaceTabs).toEqual([]);
        expect(readUnifiedPanelState('ws-2').workspaceTabs.map(tab => tab.ownerWorkspaceId)).toEqual(['ws-2']);
    });

    it('retains the selected remote group member route and workspace scope', () => {
        renderPanel({
            workspaceId: 'group-acme', routingRef: 'remote:server-1:group-acme', chatId: 'chat-1',
            dock: dockStub({ target: 'ws-member', targets: [{ workspaceId: 'ws-member', label: 'api' }] }),
        });
        pressAddTab();
        expectNewBrowser(1);
        expect(readUnifiedPanelState('group-acme').workspaceTabs[0]).toMatchObject({
            kind: 'browser', ownerWorkspaceId: 'ws-member', ownerRoutingRef: 'remote:server-1:ws-member',
            chatId: null, repoLabel: 'api',
        });
    });

    it('opens only for the active visible native browser source and focuses the new address', () => {
        nativeMenu.enabled = true;
        const view = renderPanel();
        pressAddTab();
        const browser = readUnifiedPanelState(WS).workspaceTabs[0];
        act(() => { nativeMenu.callback({ viewId: 'unrelated-view' }); });
        expectNewBrowser(1);
        act(() => { nativeMenu.callback({ viewId: browser.resourceId }); });
        expectNewBrowser(2);
        act(() => { nativeMenu.callback({ viewId: browser.resourceId }); });
        expectNewBrowser(2);
        openResource('notes');
        act(() => { nativeMenu.callback({ viewId: browser.resourceId }); });
        expect(tabKinds()).toEqual(['browser', 'browser', 'notes']);
        const latest = readUnifiedPanelState(WS).workspaceTabs[1];
        fireEvent.click(screen.getAllByRole('tab')[1]);
        view.rerender(<UnifiedRightPanel workspaceId={WS} dock={dockStub({ isOpen: false })} />);
        act(() => { nativeMenu.callback({ viewId: latest.resourceId }); });
        expect(readUnifiedPanelState(WS).workspaceTabs).toHaveLength(3);
    });

    it('ignores hidden panels and swallows initial repeats without creating tabs', () => {
        const view = renderPanel();
        expect(pressAddTab({ repeat: true }).defaultPrevented).toBe(true);
        expect(tabKinds()).toEqual([]);
        focusIn('unified-panel-open-menu');
        view.rerender(<UnifiedRightPanel workspaceId={WS} dock={dockStub({ isOpen: false })} />);
        expect(pressAddTab().defaultPrevented).toBe(false);
        expect(readUnifiedPanelState(WS).workspaceTabs).toEqual([]);
    });
});
