/**
 * Ctrl/Cmd+1–9 switch browser tabs and a held modifier reveals their hints
 * (`features.browserTabShortcuts`, default on).
 *
 * Numbering rules are unit-tested in `browserTabShortcuts.test.ts`; these cases
 * prove the panel's hints and switching agree with the rendered strip after
 * reorder and close, respect focus ownership (editors and terminals keep their
 * keys), reset on release/blur/visibility/owner change, and accept native page
 * events only from this panel's active visible view.
 *
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

vi.mock('../../../../src/server/spa/client/react/features/terminal/TerminalView', () => ({
    TerminalView: () => <textarea data-testid="mock-terminal-input" />,
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
vi.mock('../../../../src/server/spa/client/react/repos/cloneRegistry', async importOriginal => ({
    ...await importOriginal<typeof import('../../../../src/server/spa/client/react/repos/cloneRegistry')>(),
    getCocClientForWorkspace: () => ({
        canvases: { list: async () => [], create: async () => ({ id: 'c1', title: 'c' }) },
        workspaces: { deleteTerminal: async () => undefined },
    }),
    lookupCloneBaseUrl: () => null,
}));

const native = vi.hoisted(() => {
    const listeners = new Set<(event: { viewId: string; digit?: number; held?: boolean }) => void>();
    return {
        enabled: false,
        listeners,
        emit: (event: { viewId: string; digit?: number; held?: boolean }) => { for (const listener of [...listeners]) listener(event); },
        setTabShortcuts: vi.fn(),
    };
});
vi.mock('../../../../src/server/spa/client/react/shared/file-path/browser-bridge', async importOriginal => ({
    ...await importOriginal<typeof import('../../../../src/server/spa/client/react/shared/file-path/browser-bridge')>(),
    desktopBrowserBridge: () => native.enabled ? {
        onNewTab: () => () => {},
        onState: () => () => {},
        onDownload: () => () => {},
        open: async () => ({ ok: true }),
        hide: async () => ({ ok: true }),
        navigate: async () => ({ ok: true }),
        close: vi.fn(),
        setTabShortcuts: native.setTabShortcuts,
        onTabShortcut: (callback: (event: { viewId: string; digit?: number; held?: boolean }) => void) => {
            native.listeners.add(callback);
            return () => { native.listeners.delete(callback); };
        },
    } : undefined,
}));

import { UnifiedRightPanel } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/UnifiedRightPanel';
import {
    clearUnifiedPanelState, readUnifiedPanelState, writeUnifiedPanelState,
} from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelStore';
import { clearUnifiedTreeState } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelTree';
import { moveTab } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelTabsModel';
import { BROWSER_TAB_HINT_DELAY_MS } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/browserTabShortcuts';
import { _resetRuntimeConfig, applyRuntimeConfigPatch } from '../../../../src/server/spa/client/react/utils/config';
import type { WorkspaceDockController } from '../../../../src/server/spa/client/react/features/repo-detail/useWorkspaceDock';

const WS = 'ws-1';

function dockStub(overrides: Partial<WorkspaceDockController> = {}): WorkspaceDockController {
    return {
        isOpen: true, toggleOpen: vi.fn(), mode: 'explorer', selectMode: vi.fn(), target: WS, setTarget: vi.fn(),
        targets: [], width: 420, maxWidth: 900, isDragging: false, handleMouseDown: vi.fn(), handleTouchStart: vi.fn(),
        ...overrides,
    };
}

function stubOffsetParent() {
    Object.defineProperty(HTMLElement.prototype, 'offsetParent', {
        configurable: true,
        get(this: HTMLElement) {
            return this.style.display === 'none' ? null : this.parentElement ?? document.body;
        },
    });
}

function key(type: 'keydown' | 'keyup', init: KeyboardEventInit) {
    const event = new KeyboardEvent(type, { bubbles: true, cancelable: true, ...init });
    act(() => { (document.activeElement ?? document).dispatchEvent(event); });
    return event;
}
const digit = (n: number, init: KeyboardEventInit = {}) => key('keydown', { key: String(n), code: `Digit${n}`, ctrlKey: true, ...init });
const holdCtrl = () => key('keydown', { key: 'Control', ctrlKey: true });
const releaseCtrl = () => key('keyup', { key: 'Control', ctrlKey: false });

function browserTabs(scope = WS) {
    return readUnifiedPanelState(scope).workspaceTabs.filter(tab => tab.kind === 'browser');
}

function focusChrome() {
    act(() => { screen.getAllByTestId('unified-panel-open-menu').at(-1)!.focus(); });
}

function openBrowser(url: string) {
    focusChrome();
    key('keydown', { key: 't', ctrlKey: true });
    const address = document.activeElement as HTMLInputElement;
    fireEvent.change(address, { target: { value: url } });
    fireEvent.submit(address.closest('form')!);
    return browserTabs().at(-1)!;
}

const activeId = () => screen.getByRole('tab', { selected: true }).getAttribute('data-tab-id');
/** Visible hint text by tab id, in strip order. */
const hints = () => Array.from(document.querySelectorAll<HTMLElement>('[data-testid^="unified-panel-tab-shortcut-"]'))
    .map(badge => [badge.closest('[role="tab"]')!.getAttribute('data-tab-id'), badge.textContent]);

function reveal() {
    holdCtrl();
    act(() => { vi.advanceTimersByTime(BROWSER_TAB_HINT_DELAY_MS); });
}

beforeEach(() => {
    localStorage.clear();
    clearUnifiedPanelState();
    clearUnifiedTreeState();
    _resetRuntimeConfig();
    stubOffsetParent();
});
afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
    native.enabled = false;
    native.listeners.clear();
    native.setTabShortcuts.mockClear();
    clearUnifiedPanelState();
    clearUnifiedTreeState();
    _resetRuntimeConfig();
});

describe('browser tab shortcuts', () => {
    it('is on when the flag is absent', () => {
        native.enabled = true;
        render(<UnifiedRightPanel workspaceId={WS} dock={dockStub()} />);
        expect(native.setTabShortcuts).toHaveBeenLastCalledWith(true);
        const a = openBrowser('a.test');
        openBrowser('b.test');
        expect(screen.getByTestId(`unified-panel-tab-${a.id}`).getAttribute('aria-keyshortcuts')).toBe('Control+1');
        focusChrome();
        expect(digit(1).defaultPrevented).toBe(true);
        expect(activeId()).toBe(a.id);
    });

    it('is off for a saved false: no hints, no aria shortcuts, and the keys pass through', () => {
        applyRuntimeConfigPatch({ browserTabShortcutsEnabled: false });
        native.enabled = true;
        render(<UnifiedRightPanel workspaceId={WS} dock={dockStub()} />);
        expect(native.setTabShortcuts).toHaveBeenLastCalledWith(false);
        const a = openBrowser('a.test');
        openBrowser('b.test');
        focusChrome();
        expect(digit(1).defaultPrevented).toBe(false);
        expect(activeId()).not.toBe(a.id);
        vi.useFakeTimers();
        reveal();
        expect(hints()).toEqual([]);
        expect(document.querySelector('[aria-keyshortcuts]')).toBeNull();
        act(() => { native.emit({ viewId: browserTabs()[1].resourceId, digit: 1 }); });
        expect(activeId()).not.toBe(a.id);
    });

    it('switches by visible browser-tab order, with 9 for the last, and follows live opt-in', () => {
        native.enabled = true;
        render(<UnifiedRightPanel workspaceId={WS} dock={dockStub()} />);
        const a = openBrowser('a.test');
        fireEvent.click(screen.getByTestId('unified-panel-open-menu'));
        fireEvent.click(screen.getByTestId('unified-panel-open-notes'));
        const b = openBrowser('b.test');
        const c = openBrowser('c.test');
        act(() => { applyRuntimeConfigPatch({ browserTabShortcutsEnabled: true }); });
        expect(native.setTabShortcuts).toHaveBeenLastCalledWith(true);
        // Only web tabs are numbered; the notes tab between them is skipped.
        expect(screen.getByTestId(`unified-panel-tab-${a.id}`).getAttribute('aria-keyshortcuts')).toBe('Control+1');
        expect(screen.getByTestId(`unified-panel-tab-${c.id}`).getAttribute('aria-keyshortcuts')).toBe('Control+3');
        expect(document.querySelector('[data-kind="notes"]')!.hasAttribute('aria-keyshortcuts')).toBe(false);

        focusChrome();
        expect(digit(1).defaultPrevented).toBe(true);
        expect(activeId()).toBe(a.id);
        expect(document.activeElement).toBe(screen.getByTestId(`unified-panel-tab-${a.id}`));
        expect(digit(2).defaultPrevented).toBe(true);
        expect(activeId()).toBe(b.id);
        expect(digit(9).defaultPrevented).toBe(true);
        expect(activeId()).toBe(c.id);
        // No fourth tab: nothing moves. Repeats, Shift, Alt and Numpad never switch.
        digit(4);
        expect(activeId()).toBe(c.id);
        digit(1, { repeat: true });
        expect(digit(1, { shiftKey: true }).defaultPrevented).toBe(false);
        expect(digit(1, { altKey: true }).defaultPrevented).toBe(false);
        expect(key('keydown', { key: '1', code: 'Numpad1', ctrlKey: true }).defaultPrevented).toBe(false);
        expect(digit(1, { ctrlKey: false, metaKey: true }).defaultPrevented).toBe(false);
        expect(activeId()).toBe(c.id);

        act(() => { applyRuntimeConfigPatch({ browserTabShortcutsEnabled: false }); });
        expect(native.setTabShortcuts).toHaveBeenLastCalledWith(false);
        focusChrome();
        expect(digit(1).defaultPrevented).toBe(false);
        expect(activeId()).toBe(c.id);
    });

    it('shows compact hints only after a held modifier, matching order after reorder and close', () => {
        applyRuntimeConfigPatch({ browserTabShortcutsEnabled: true });
        render(<UnifiedRightPanel workspaceId={WS} dock={dockStub()} />);
        const a = openBrowser('a.test');
        const b = openBrowser('b.test');
        const c = openBrowser('c.test');
        focusChrome();
        vi.useFakeTimers();
        holdCtrl();
        // A quick chord never flashes hints.
        act(() => { vi.advanceTimersByTime(BROWSER_TAB_HINT_DELAY_MS - 1); });
        expect(hints()).toEqual([]);
        act(() => { vi.advanceTimersByTime(1); });
        expect(hints()).toEqual([[a.id, 'Ctrl+1'], [b.id, 'Ctrl+2'], [c.id, 'Ctrl+3']]);
        // Hints are decorative; the close button and label stay in place.
        const badge = screen.getByTestId(`unified-panel-tab-shortcut-${a.id}`);
        expect(badge.getAttribute('aria-hidden')).toBe('true');
        expect(badge.nextElementSibling?.nextElementSibling).toBe(screen.getByTestId(`unified-panel-tab-close-${a.id}`));
        expect(screen.getByTestId(`unified-panel-tab-label-${a.id}`).className).toContain('truncate');

        // Switching keeps the hold and its hints.
        digit(2);
        expect(activeId()).toBe(b.id);
        expect(hints()).toHaveLength(3);

        act(() => { writeUnifiedPanelState(WS, moveTab(readUnifiedPanelState(WS), c.id, a.id)); });
        expect(hints()).toEqual([[c.id, 'Ctrl+1'], [a.id, 'Ctrl+2'], [b.id, 'Ctrl+3']]);
        focusChrome();
        digit(1);
        expect(activeId()).toBe(c.id);
        fireEvent.click(screen.getByTestId(`unified-panel-tab-close-${c.id}`));
        expect(hints()).toEqual([[a.id, 'Ctrl+1'], [b.id, 'Ctrl+2']]);
        focusChrome();
        digit(9);
        expect(activeId()).toBe(b.id);

        releaseCtrl();
        expect(hints()).toEqual([]);
    });

    it('hides hints on another chord, window blur, a hidden page and an owner change', () => {
        applyRuntimeConfigPatch({ browserTabShortcutsEnabled: true });
        const view = render(<UnifiedRightPanel workspaceId={WS} chatId="chat-1" dock={dockStub()} />);
        openBrowser('a.test');
        focusChrome();
        vi.useFakeTimers();
        reveal();
        expect(hints()).toHaveLength(1);
        key('keydown', { key: 'c', code: 'KeyC', ctrlKey: true });
        expect(hints()).toEqual([]);

        reveal();
        act(() => { window.dispatchEvent(new Event('blur')); });
        expect(hints()).toEqual([]);

        reveal();
        vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
        act(() => { document.dispatchEvent(new Event('visibilitychange')); });
        expect(hints()).toEqual([]);
        vi.restoreAllMocks();

        reveal();
        expect(hints()).toHaveLength(1);
        view.rerender(<UnifiedRightPanel workspaceId={WS} chatId="chat-2" dock={dockStub()} />);
        expect(hints()).toEqual([]);
        // A pending reveal from before the owner change never lands.
        holdCtrl();
        view.rerender(<UnifiedRightPanel workspaceId={WS} chatId="chat-1" dock={dockStub()} />);
        act(() => { vi.advanceTimersByTime(BROWSER_TAB_HINT_DELAY_MS); });
        expect(hints()).toEqual([]);
        // A collapsed panel shows nothing.
        view.rerender(<UnifiedRightPanel workspaceId={WS} chatId="chat-1" dock={dockStub({ isOpen: false })} />);
        reveal();
        expect(hints()).toEqual([]);
    });

    it('leaves editor, terminal and outside focus alone but works from the address bar', () => {
        applyRuntimeConfigPatch({ browserTabShortcutsEnabled: true });
        render(<UnifiedRightPanel workspaceId={WS} dock={dockStub()} />);
        const a = openBrowser('a.test');
        const b = openBrowser('b.test');
        expect(document.activeElement?.getAttribute('data-testid')).toBe('browser-address');
        expect(digit(1).defaultPrevented).toBe(true);
        expect(activeId()).toBe(a.id);

        fireEvent.click(screen.getByTestId('unified-panel-open-menu'));
        fireEvent.click(screen.getByTestId('unified-panel-open-terminal'));
        act(() => { screen.getByTestId('mock-terminal-input').focus(); });
        vi.useFakeTimers();
        reveal();
        expect(hints()).toEqual([]);
        expect(digit(2).defaultPrevented).toBe(false);
        expect(activeId()).not.toBe(b.id);

        const outside = document.createElement('input');
        document.body.appendChild(outside);
        act(() => { outside.focus(); });
        expect(digit(2).defaultPrevented).toBe(false);
        reveal();
        expect(hints()).toEqual([]);
        outside.remove();
    });

    it('numbers 1–8 and the last tab as 9 when there are more than nine', () => {
        // Ten visible browser tabs need the ungrouped strip.
        applyRuntimeConfigPatch({ browserTabShortcutsEnabled: true, panelTabGroupsEnabled: false });
        render(<UnifiedRightPanel workspaceId={WS} dock={dockStub({ width: 4000, maxWidth: 4000 })} />);
        const tabs = Array.from({ length: 10 }, (_, index) => openBrowser(`t${index}.test`));
        focusChrome();
        vi.useFakeTimers();
        reveal();
        expect(hints()).toEqual([
            ...tabs.slice(0, 8).map((tab, index) => [tab.id, `Ctrl+${index + 1}`]),
            [tabs[9].id, 'Ctrl+9'],
        ]);
        expect(screen.getByTestId(`unified-panel-tab-${tabs[8].id}`).hasAttribute('aria-keyshortcuts')).toBe(false);
        digit(8);
        expect(activeId()).toBe(tabs[7].id);
        focusChrome();
        digit(9);
        expect(activeId()).toBe(tabs[9].id);
    });

    it('uses Command and ⌘ hints on macOS', () => {
        vi.spyOn(navigator, 'platform', 'get').mockReturnValue('MacIntel');
        applyRuntimeConfigPatch({ browserTabShortcutsEnabled: true });
        render(<UnifiedRightPanel workspaceId={WS} dock={dockStub()} />);
        const a = openBrowser('a.test');
        const b = openBrowser('b.test');
        focusChrome();
        expect(digit(1).defaultPrevented).toBe(false);
        expect(activeId()).toBe(b.id);
        expect(digit(1, { ctrlKey: false, metaKey: true }).defaultPrevented).toBe(true);
        expect(activeId()).toBe(a.id);
        vi.useFakeTimers();
        key('keydown', { key: 'Meta', metaKey: true });
        act(() => { vi.advanceTimersByTime(BROWSER_TAB_HINT_DELAY_MS); });
        expect(hints()).toEqual([[a.id, '⌘1'], [b.id, '⌘2']]);
        expect(screen.getByTestId(`unified-panel-tab-${a.id}`).getAttribute('aria-keyshortcuts')).toBe('Meta+1');
        key('keyup', { key: 'Meta', metaKey: false });
        expect(hints()).toEqual([]);
    });

    it('honours native page events only from the active visible browser view', () => {
        native.enabled = true;
        applyRuntimeConfigPatch({ browserTabShortcutsEnabled: true });
        const view = render(<UnifiedRightPanel workspaceId={WS} dock={dockStub()} />);
        const a = openBrowser('a.test');
        const b = openBrowser('b.test');
        expect(activeId()).toBe(b.id);
        act(() => { native.emit({ viewId: a.resourceId, digit: 1 }); });
        act(() => { native.emit({ viewId: 'other-window-view', digit: 1 }); });
        expect(activeId()).toBe(b.id);

        vi.useFakeTimers();
        act(() => { native.emit({ viewId: b.resourceId, held: true }); });
        act(() => { vi.advanceTimersByTime(BROWSER_TAB_HINT_DELAY_MS); });
        expect(hints()).toHaveLength(2);
        act(() => { native.emit({ viewId: b.resourceId, digit: 1 }); });
        expect(activeId()).toBe(a.id);
        expect(document.activeElement).toBe(screen.getByTestId(`unified-panel-tab-${a.id}`));
        // The hold survives the switch; key-up now reaches the SPA document.
        expect(hints()).toHaveLength(2);
        releaseCtrl();
        expect(hints()).toEqual([]);

        act(() => { native.emit({ viewId: a.resourceId, held: true }); });
        act(() => { native.emit({ viewId: a.resourceId, held: false }); });
        act(() => { vi.advanceTimersByTime(BROWSER_TAB_HINT_DELAY_MS); });
        expect(hints()).toEqual([]);

        view.rerender(<UnifiedRightPanel workspaceId={WS} dock={dockStub({ isOpen: false })} />);
        act(() => { native.emit({ viewId: a.resourceId, digit: 2 }); });
        view.rerender(<UnifiedRightPanel workspaceId={WS} dock={dockStub()} />);
        expect(activeId()).toBe(a.id);
    });
});
