/**
 * Ctrl/Cmd+P and Ctrl/Cmd+O in the unified right panel.
 *
 * The regression these pin: the handler used to live inside `ExplorerPanel`,
 * which the panel only mounts while its file-tree column is open — so with the
 * column collapsed nothing listened, and with a main-area Explorer tab also
 * mounted two document listeners fired and stacked two dialogs.
 *
 * The routing rule itself is unit-tested in `quickOpenRouting.test.ts`; these
 * cases prove the shell wires it up: it listens regardless of the tree column,
 * it claims the event in the capture phase so no second owner sees it, and a
 * picked file lands as the right kind of panel tab with the column revealed.
 *
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

vi.mock('../../../../src/server/spa/client/react/features/terminal/TerminalView', () => ({
    TerminalView: () => <div data-testid="mock-terminal" />,
}));
vi.mock('../../../../src/server/spa/client/react/features/notes/dock/DockNotesPanel', () => ({
    DockNotesPanel: () => <div data-testid="mock-notes" />,
}));
vi.mock('../../../../src/server/spa/client/react/features/repo-detail/explorer/ExplorerPanel', () => ({
    ExplorerPanel: ({ workspaceId, mode }: { workspaceId: string; mode?: string }) => (
        <div data-testid="mock-explorer" data-mode={mode}>explorer:{workspaceId}</div>
    ),
    getAncestorPaths: (p: string) => {
        const parts = p.split('/').filter(Boolean);
        return parts.slice(0, -1).map((_, i) => parts.slice(0, i + 1).join('/'));
    },
}));
// The dialogs are stubbed down to "am I open, for which workspace, and here is
// a pick": their search/ranking behaviour has its own suites, and what matters
// here is that the panel opens the right one and files what comes back.
vi.mock('../../../../src/server/spa/client/react/features/repo-detail/explorer/QuickOpen', () => ({
    QuickOpen: ({ workspaceId, open, onFileSelect }: {
        workspaceId: string; open: boolean; onFileSelect: (p: string) => void;
    }) => (open ? (
        <div data-testid="quick-open-dialog" data-workspace={workspaceId}>
            <button type="button" data-testid="quick-open-pick" onClick={() => onFileSelect('src/deep/app.ts')}>
                pick
            </button>
        </div>
    ) : null),
}));
vi.mock('../../../../src/server/spa/client/react/features/repo-detail/explorer/ExactOpen', () => ({
    TRUSTED_PATH_PREFIX: '__trusted__:',
    fileName: (p: string) => (p.includes('/') ? p.slice(p.lastIndexOf('/') + 1) : p),
    ExactOpen: ({ workspaceId, open, onFileSelect }: {
        workspaceId: string; open: boolean; onFileSelect: (p: string) => void;
    }) => (open ? (
        <div data-testid="exact-open-dialog" data-workspace={workspaceId}>
            <button
                type="button"
                data-testid="exact-open-pick"
                onClick={() => onFileSelect('__trusted__:/home/me/.copilot/config.json')}
            >
                pick
            </button>
        </div>
    ) : null),
}));
vi.mock('../../../../src/server/spa/client/react/features/repo-detail/explorer/explorerApi', () => ({
    explorerApi: {
        searchFiles: async () => ({ results: [] as { path: string }[] }),
        readBlob: async () => ({ content: '', encoding: 'utf-8', mimeType: 'text/plain' }),
        writeBlob: async () => ({ success: true }),
        readTrustedBlob: async () => ({ content: '', encoding: 'utf-8', mimeType: 'text/plain' }),
        tree: async () => ({ entries: [] }),
    },
}));
vi.mock('../../../../src/server/spa/client/react/shared/file-viewer/MonacoFileEditor', () => ({
    MonacoFileEditor: () => <div data-testid="mock-monaco" />,
    getMonacoLanguage: () => 'plaintext',
}));
vi.mock('../../../../src/server/spa/client/react/repos/cloneRegistry', () => ({
    getCocClientForWorkspace: () => ({ canvases: { list: async () => [], create: async () => ({ id: 'c1', title: 'c' }) } }),
    lookupCloneBaseUrl: () => null,
}));
// `PreviewPane` opens a language document for every live repo file; this suite
// is about panel behaviour, not language support.
vi.mock('../../../../src/server/spa/client/react/features/language-servers/languageServerClient',
    async () => await import('../language-servers/inertTransportMock'));


import { UnifiedRightPanel } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/UnifiedRightPanel';
import {
    clearUnifiedPanelState,
    readUnifiedPanelState,
} from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelStore';
import {
    clearUnifiedTreeState,
    readUnifiedTreeState,
    writeUnifiedTreeState,
} from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelTree';
import {
    clearExplorerQuickOpenRegistry,
    registerExplorerQuickOpen,
} from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/quickOpenRouting';
import type { WorkspaceDockController } from '../../../../src/server/spa/client/react/features/repo-detail/useWorkspaceDock';

const WS = 'ws-1';

function dockStub(overrides: Partial<WorkspaceDockController> = {}): WorkspaceDockController {
    return {
        isOpen: true,
        toggleOpen: vi.fn(),
        target: WS,
        setTarget: vi.fn(),
        targets: [],
        width: 900,
        maxWidth: 1200,
        isDragging: false,
        handleMouseDown: vi.fn(),
        handleTouchStart: vi.fn(),
        ...overrides,
    };
}

function renderPanel(props: Partial<React.ComponentProps<typeof UnifiedRightPanel>> = {}) {
    const dock = props.dock ?? dockStub();
    return render(<UnifiedRightPanel workspaceId={WS} dock={dock} {...props} />);
}

/** Press the shortcut on `document`, exactly as the browser dispatches it. */
function press(key: 'p' | 'o', target: Element | Document = document) {
    const event = new KeyboardEvent('keydown', { key, ctrlKey: true, bubbles: true, cancelable: true });
    act(() => { target.dispatchEvent(event); });
    return event;
}

/** Every file tab in the strip, with the two bits these cases care about. */
function fileTabs(): { label: string; preview: boolean }[] {
    return Array.from(document.querySelectorAll('[role="tab"][data-kind="file"]')).map(node => ({
        label: node.querySelector('[data-testid^="unified-panel-tab-label-"]')?.textContent ?? '',
        preview: node.getAttribute('data-preview') === 'true',
    }));
}

/** The persisted descriptor for the one open file tab. */
function storedFileTab() {
    const state = readUnifiedPanelState(WS);
    const tabs = [...state.workspaceTabs, ...Object.values(state.chatTabs).flat()];
    return tabs.find(tab => tab.kind === 'file');
}

describe('unified panel quick open', () => {
    beforeEach(() => {
        localStorage.clear();
        clearUnifiedPanelState();
        clearUnifiedTreeState();
        clearExplorerQuickOpenRegistry();
    });
    afterEach(() => {
        cleanup();
        clearUnifiedPanelState();
        clearUnifiedTreeState();
        clearExplorerQuickOpenRegistry();
    });

    it('opens Quick Open with the tree column collapsed — the regression', () => {
        renderPanel();
        expect(screen.queryByTestId('unified-panel-tree')).toBeNull();

        press('p');
        expect(screen.getByTestId('quick-open-dialog')).toBeTruthy();
    });

    it('opens Quick Open from the empty state, with no tabs at all', () => {
        renderPanel();
        expect(screen.getByTestId('unified-panel-empty')).toBeTruthy();

        press('p');
        expect(screen.getByTestId('quick-open-dialog')).toBeTruthy();
    });

    it('opens Exact Open on Ctrl+O, and only one dialog at a time', () => {
        renderPanel();
        press('o');
        expect(screen.getByTestId('exact-open-dialog')).toBeTruthy();
        expect(screen.queryByTestId('quick-open-dialog')).toBeNull();

        press('p');
        expect(screen.getByTestId('quick-open-dialog')).toBeTruthy();
        expect(screen.queryByTestId('exact-open-dialog')).toBeNull();
    });

    it('searches the tree column\'s target workspace, not the panel scope', () => {
        // A repo group: the panel is scoped to the group, but files come from
        // the member clone the dock points at.
        renderPanel({ workspaceId: 'group-1', dock: dockStub({ target: 'member-a' }) });
        press('p');
        expect(screen.getByTestId('quick-open-dialog').getAttribute('data-workspace')).toBe('member-a');
    });

    it('preventDefaults, so the browser print dialog never appears', () => {
        renderPanel();
        const event = press('p');
        expect(event.defaultPrevented).toBe(true);
    });

    it('opens a picked file as a preview tab and reveals it in the tree column', () => {
        renderPanel();
        press('p');
        fireEvent.click(screen.getByTestId('quick-open-pick'));

        expect(fileTabs()).toEqual([{ label: 'app.ts', preview: true }]);
        // The column is opened for the user, and persisted like a manual open.
        expect(readUnifiedTreeState(WS).open).toBe(true);
        expect(screen.getByTestId('unified-panel-tree')).toBeTruthy();
        // Reveal rides on the existing tracking prop: the new tab is active and
        // its path resolves in the tree's target, so the column follows it.
        expect(screen.queryByTestId('quick-open-dialog')).toBeNull();
    });

    it('opens an Exact Open pick pinned and read-only', () => {
        renderPanel();
        press('o');
        fireEvent.click(screen.getByTestId('exact-open-pick'));

        // Pinned, not preview — the distinction between the two entry points.
        expect(fileTabs()).toEqual([{ label: 'config.json', preview: false }]);
        const tab = storedFileTab();
        expect(tab?.readOnly).toBe(true);
        expect(tab?.resourceId).toBe('__trusted__:/home/me/.copilot/config.json');
    });

    it('keeps the tree open bit even when the panel is too narrow to show the column', () => {
        // The open bit is what the user asked for; a narrow panel hides the
        // column without discarding it, and the panel is never force-widened.
        renderPanel({ dock: dockStub({ width: 260 }) });
        press('p');
        fireEvent.click(screen.getByTestId('quick-open-pick'));

        expect(readUnifiedTreeState(WS).open).toBe(true);
        expect(screen.getByTestId('unified-panel-tree').getAttribute('style')).toContain('display: none');
    });

    it('stands aside for a mounted Explorer tab when focus is elsewhere', () => {
        renderPanel();
        registerExplorerQuickOpen(() => false);

        const event = press('p');
        expect(screen.queryByTestId('quick-open-dialog')).toBeNull();
        // Not claimed at all, so the Explorer tab's own listener still sees it.
        expect(event.defaultPrevented).toBe(false);
    });

    it('stands aside for a focused Explorer tab', () => {
        renderPanel();
        registerExplorerQuickOpen(() => true);

        press('p');
        expect(screen.queryByTestId('quick-open-dialog')).toBeNull();
    });

    it('wins, and stops the event, when the focus is inside the panel', () => {
        renderPanel();
        registerExplorerQuickOpen(() => false);
        const panel = screen.getByTestId('unified-right-panel');
        const focusable = panel.querySelector<HTMLElement>('[data-testid="unified-panel-resize-handle"]')!;
        focusable.focus();

        // A second listener standing in for the Explorer tab's document-level
        // one: the panel claims the event in the capture phase, so it never runs
        // and two dialogs can never stack.
        const bubbled = vi.fn();
        document.addEventListener('keydown', bubbled);
        try {
            press('p', focusable);
            expect(screen.getByTestId('quick-open-dialog')).toBeTruthy();
            expect(bubbled).not.toHaveBeenCalled();
        } finally {
            document.removeEventListener('keydown', bubbled);
        }
    });

    it('keeps its dialog while it is up, even though the dialog portals outside the panel', () => {
        renderPanel();
        registerExplorerQuickOpen(() => false);
        screen.getByTestId('unified-panel-resize-handle').focus();
        press('p');
        expect(screen.getByTestId('quick-open-dialog')).toBeTruthy();

        // Focus has left the panel root for the portalled dialog. Without the
        // "my dialog is up" clause the Explorer tab would take the next press
        // and a second dialog would appear beside this one.
        (document.activeElement as HTMLElement | null)?.blur();
        press('o');
        expect(screen.getByTestId('exact-open-dialog')).toBeTruthy();
    });

    it('does not listen while the panel is collapsed, and dismisses an open dialog', () => {
        const { rerender } = renderPanel();
        press('p');
        expect(screen.getByTestId('quick-open-dialog')).toBeTruthy();

        rerender(<UnifiedRightPanel workspaceId={WS} dock={dockStub({ isOpen: false })} />);
        expect(screen.queryByTestId('quick-open-dialog')).toBeNull();

        const event = press('p');
        expect(screen.queryByTestId('quick-open-dialog')).toBeNull();
        expect(event.defaultPrevented).toBe(false);
    });

    it('still opens with the tree column already expanded', () => {
        writeUnifiedTreeState(WS, { open: true, width: 220 });
        renderPanel();
        expect(screen.getByTestId('unified-panel-tree')).toBeTruthy();

        press('p');
        expect(screen.getByTestId('quick-open-dialog')).toBeTruthy();
    });
});
