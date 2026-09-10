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
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
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
vi.mock('../../../../src/server/spa/client/react/features/notes/dock/DockNotesPanel', () => ({
    DockNotesPanel: () => <textarea data-testid="mock-notes-input" />,
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

import { UnifiedRightPanel } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/UnifiedRightPanel';
import { clearUnifiedPanelState } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelStore';
import { clearUnifiedTreeState } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelTree';
import type { WorkspaceDockController } from '../../../../src/server/spa/client/react/features/repo-detail/useWorkspaceDock';

const WS = 'ws-1';

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
