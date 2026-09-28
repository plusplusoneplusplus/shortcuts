// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type {
    EditorNavigationController,
    EditorNavigationSnapshot,
} from '../../../../src/server/spa/client/react/shared/file-viewer/MonacoFileEditor';

const controllers = new Map<string, {
    controller: EditorNavigationController;
    restore: ReturnType<typeof vi.fn>;
}>();

// Files whose read fails: the mock reports an error and never mounts an editor.
const missingFiles = new Set<string>();

function snapshot(line: number, column = 1): EditorNavigationSnapshot {
    return {
        selection: {
            selectionStartLineNumber: line,
            selectionStartColumn: column,
            positionLineNumber: line,
            positionColumn: column,
        },
    };
}

vi.mock('../../../../src/server/spa/client/react/features/repo-detail/explorer/PreviewPane', () => ({
    PreviewPane: ({
        filePath,
        onNavigate,
        onNavigationMount,
        onNavigationLocation,
        onStatusChange,
    }: {
        filePath: string;
        onStatusChange?: (status: 'loading' | 'error' | 'ready') => void;
        onNavigate?: (target: { path: string; name: string; line: number; column: number }) => void;
        onNavigationMount?: (controller: EditorNavigationController | null) => void;
        onNavigationLocation?: (value: EditorNavigationSnapshot, reason: 'user' | 'jump') => void;
    }) => {
        const initial = filePath === 'a.ts' ? snapshot(1, 3) : snapshot(30, 5);
        const [current, setCurrent] = useState(initial);
        const currentRef = useRef(current);
        currentRef.current = current;
        const entry = useMemo(() => {
            const restore = vi.fn((value: EditorNavigationSnapshot) => {
                currentRef.current = value;
                setCurrent(value);
            });
            const controller: EditorNavigationController = {
                capture: () => currentRef.current,
                restore,
                subscribe: () => ({ dispose: () => undefined }),
            };
            return { controller, restore };
        }, []);
        const missing = missingFiles.has(filePath);
        useEffect(() => {
            if (missing) onStatusChange?.('error');
        }, [missing, onStatusChange]);
        if (!missing) controllers.set(filePath, entry);
        useEffect(() => {
            if (missing) return undefined;
            onNavigationMount?.(entry.controller);
            onNavigationLocation?.(currentRef.current, 'user');
            return () => onNavigationMount?.(null);
        }, [entry.controller, missing, onNavigationLocation, onNavigationMount]);
        return (
            <div>
                <button data-testid={`mock-file-${filePath}`}>{filePath}</button>
                {filePath === 'a.ts' && (
                    <>
                        <button
                            data-testid="jump-to-b"
                            onClick={() => {
                                onNavigationLocation?.(currentRef.current, 'jump');
                                onNavigate?.({ path: 'b.ts', name: 'b.ts', line: 30, column: 5 });
                            }}
                        >
                            jump
                        </button>
                        {(['references', 'symbol'] as const).map(kind => (
                            <button
                                key={kind}
                                data-testid={`${kind}-to-b`}
                                onClick={() => {
                                    onNavigationLocation?.(currentRef.current, 'jump');
                                    onNavigate?.({ path: 'b.ts', name: 'b.ts', line: 30, column: 5 });
                                }}
                            >
                                {kind}
                            </button>
                        ))}
                        <button
                            data-testid="jump-in-a"
                            onClick={() => {
                                onNavigationLocation?.(currentRef.current, 'jump');
                                const destination = snapshot(40, 9);
                                currentRef.current = destination;
                                setCurrent(destination);
                                onNavigationLocation?.(destination, 'jump');
                            }}
                        >
                            jump in file
                        </button>
                        <button
                            data-testid="move-near-in-a"
                            onClick={() => {
                                const line = currentRef.current.selection.positionLineNumber + 2;
                                const destination = snapshot(line, 1);
                                currentRef.current = destination;
                                setCurrent(destination);
                                onNavigationLocation?.(destination, 'user');
                            }}
                        >
                            move nearby
                        </button>
                        <button
                            data-testid="move-far-in-a"
                            onClick={() => {
                                const destination = snapshot(20, 1);
                                currentRef.current = destination;
                                setCurrent(destination);
                                onNavigationLocation?.(destination, 'user');
                            }}
                        >
                            move far
                        </button>
                    </>
                )}
            </div>
        );
    },
    type: {},
}));

vi.mock('../../../../src/server/spa/client/react/features/repo-detail/explorer/ExplorerPanel', () => ({
    ExplorerPanel: ({ onOpenFile }: {
        onOpenFile?: (file: { path: string; name: string }, options: { preview: boolean }) => void;
    }) => (
        <button
            data-testid="mock-explorer-open-b"
            onClick={() => onOpenFile?.({ path: 'b.ts', name: 'b.ts' }, { preview: true })}
        >
            explorer
        </button>
    ),
    getAncestorPaths: () => [],
}));
vi.mock('../../../../src/server/spa/client/react/features/repo-detail/explorer/ContentSearchPanel', () => ({
    ContentSearchPanel: ({ onOpenMatch }: { onOpenMatch: (path: string, line: number) => void }) => (
        <button data-testid="mock-search-open-b" onClick={() => onOpenMatch('b.ts', 30)}>
            search
        </button>
    ),
}));
vi.mock('../../../../src/server/spa/client/react/features/repo-detail/explorer/QuickOpen', () => ({
    QuickOpen: ({ open, onFileSelect }: {
        open: boolean;
        onFileSelect: (result: { path: string }) => void;
    }) => open ? (
        <button data-testid="mock-quick-open-b" onClick={() => onFileSelect({ path: 'b.ts' })}>
            quick open
        </button>
    ) : null,
}));
vi.mock('../../../../src/server/spa/client/react/features/repo-detail/explorer/explorerApi', () => ({
    explorerApi: {
        searchFiles: async () => ({ results: [] }),
        tree: async () => ({ entries: [] }),
    },
}));
vi.mock('../../../../src/server/spa/client/react/features/notes/NotesView', () => ({
    NotesView: () => <button data-testid="mock-notes">notes</button>,
}));
vi.mock('../../../../src/server/spa/client/react/repos/cloneRegistry', () => ({
    getCocClientForWorkspace: () => ({
        canvases: { list: async () => [], create: async () => ({ id: 'c1', title: 'c' }) },
    }),
    lookupCloneBaseUrl: () => null,
}));

import { UnifiedRightPanel } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/UnifiedRightPanel';
import {
    EMPTY_UNIFIED_PANEL,
    openTab,
    unifiedTabId,
} from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelTabsModel';
import {
    clearUnifiedPanelState,
    writeUnifiedPanelState,
} from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelStore';
import {
    clearUnifiedPanelNavigationHistory,
    readUnifiedPanelNavigationHistory,
    writeUnifiedPanelNavigationHistory,
} from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelNavigationStore';
import { openUnifiedPanelTab } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelOpen';
import { clearUnifiedTreeState } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelTree';
import type { WorkspaceDockController } from '../../../../src/server/spa/client/react/features/repo-detail/useWorkspaceDock';

const WS = 'ws-1';
const CHAT = 'chat-1';
const fileId = (path: string, workspaceId = WS) => unifiedTabId({
    kind: 'file', ownerWorkspaceId: workspaceId, chatId: CHAT, resourceId: path,
});

function dockStub(isOpen = true): WorkspaceDockController {
    return {
        isOpen,
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
    };
}

function seedFile(path = 'a.ts', workspaceId = WS) {
    writeUnifiedPanelState(workspaceId, openTab(EMPTY_UNIFIED_PANEL, {
        kind: 'file',
        ownerWorkspaceId: workspaceId,
        chatId: CHAT,
        resourceId: path,
        label: path,
    }));
}

function seedExhaustedHistory() {
    const location = (path: string) => ({
        scopeWorkspaceId: WS,
        tabId: fileId(path),
        file: { ownerWorkspaceId: WS, resourceId: path, label: path },
        ...snapshot(1),
    });
    writeUnifiedPanelNavigationHistory(WS, {
        entries: [location('c.ts'), location('b.ts'), location('a.ts')],
        index: 2,
        replaying: false,
    });
    missingFiles.add('b.ts');
    missingFiles.add('c.ts');
    seedFile();
}

function renderPanel(isOpen = true) {
    return render(<UnifiedRightPanel workspaceId={WS} chatId={CHAT} dock={dockStub(isOpen)} />);
}

function pressHistory(direction: 'back' | 'forward') {
    const event = new KeyboardEvent('keydown', {
        key: direction === 'back' ? 'ArrowLeft' : 'ArrowRight',
        altKey: true,
        bubbles: true,
        cancelable: true,
    });
    act(() => document.dispatchEvent(event));
    return event;
}

function pressMacHistory(direction: 'back' | 'forward') {
    const event = new KeyboardEvent('keydown', {
        key: direction === 'back' ? '-' : '_',
        code: 'Minus',
        ctrlKey: true,
        shiftKey: direction === 'forward',
        bubbles: true,
        cancelable: true,
    });
    act(() => document.dispatchEvent(event));
    return event;
}

function mouseHistory(target: HTMLElement, button: 3 | 4) {
    const down = new MouseEvent('mousedown', { button, bubbles: true, cancelable: true });
    const up = new MouseEvent('mouseup', { button, bubbles: true, cancelable: true });
    act(() => {
        target.dispatchEvent(down);
        target.dispatchEvent(up);
    });
    return { down, up };
}

async function expectRecordedTrip(fromPath = 'a.ts', toPath = 'b.ts') {
    await waitFor(() => expect(readUnifiedPanelNavigationHistory(WS).entries.map(entry => entry.file.resourceId))
        .toEqual(expect.arrayContaining([fromPath, toPath])));
    const destination = screen.getByTestId(`mock-file-${toPath}`);
    act(() => destination.focus());

    expect(pressHistory('back').defaultPrevented).toBe(true);
    await waitFor(() => expect(
        screen.getByTestId(`unified-panel-tab-${fileId(fromPath)}`),
    ).toHaveAttribute('aria-selected', 'true'));

    await act(async () => { await Promise.resolve(); });
    act(() => screen.getByTestId(`mock-file-${fromPath}`).focus());
    expect(pressHistory('forward').defaultPrevented).toBe(true);
    await waitFor(() => expect(
        screen.getByTestId(`unified-panel-tab-${fileId(toPath)}`),
    ).toHaveAttribute('aria-selected', 'true'));
}

function stubOffsetParent() {
    Object.defineProperty(HTMLElement.prototype, 'offsetParent', {
        configurable: true,
        get(this: HTMLElement) {
            return this.style.display === 'none' ? null : this.parentElement ?? document.body;
        },
    });
}

beforeEach(() => {
    localStorage.clear();
    controllers.clear();
    missingFiles.clear();
    clearUnifiedPanelState();
    clearUnifiedTreeState();
    stubOffsetParent();
});

afterEach(() => {
    cleanup();
    clearUnifiedPanelState();
    clearUnifiedTreeState();
});

describe('unified panel file navigation history', () => {
    it('replays exact cross-file locations with keyboard Back and Forward', async () => {
        seedFile();
        renderPanel();
        await screen.findByTestId('mock-file-a.ts');
        fireEvent.click(screen.getByTestId('jump-to-b'));
        const b = await screen.findByTestId('mock-file-b.ts');
        act(() => b.focus());

        expect(pressHistory('back').defaultPrevented).toBe(true);
        await waitFor(() => expect(
            screen.getByTestId(`unified-panel-tab-${fileId('a.ts')}`),
        ).toHaveAttribute('aria-selected', 'true'));
        expect(controllers.get('a.ts')?.restore).toHaveBeenCalledWith(snapshot(1, 3));

        act(() => screen.getByTestId('mock-file-a.ts').focus());
        expect(pressHistory('forward').defaultPrevented).toBe(true);
        await waitFor(() => expect(
            screen.getByTestId(`unified-panel-tab-${fileId('b.ts')}`),
        ).toHaveAttribute('aria-selected', 'true'));
        expect(controllers.get('b.ts')?.restore).toHaveBeenCalledWith(snapshot(30, 5));
    });

    it('uses Ctrl+- and Ctrl+Shift+- for Back and Forward on macOS', async () => {
        const platform = vi.spyOn(window.navigator, 'platform', 'get').mockReturnValue('MacIntel');
        try {
            seedFile();
            renderPanel();
            await screen.findByTestId('mock-file-a.ts');
            fireEvent.click(screen.getByTestId('jump-to-b'));
            const b = await screen.findByTestId('mock-file-b.ts');
            act(() => b.focus());

            expect(pressHistory('back').defaultPrevented).toBe(false);
            expect(pressMacHistory('back').defaultPrevented).toBe(true);
            await waitFor(() => expect(
                screen.getByTestId(`unified-panel-tab-${fileId('a.ts')}`),
            ).toHaveAttribute('aria-selected', 'true'));

            await act(async () => { await Promise.resolve(); });
            act(() => screen.getByTestId('mock-file-a.ts').focus());
            expect(pressMacHistory('forward').defaultPrevented).toBe(true);
            await waitFor(() => expect(
                screen.getByTestId(`unified-panel-tab-${fileId('b.ts')}`),
            ).toHaveAttribute('aria-selected', 'true'));
        } finally {
            platform.mockRestore();
        }
    });

    it.each(['references', 'symbol'] as const)('records a Go To %s cross-file jump', async kind => {
        seedFile();
        renderPanel();
        await screen.findByTestId('mock-file-a.ts');
        fireEvent.click(screen.getByTestId(`${kind}-to-b`));
        await screen.findByTestId('mock-file-b.ts');

        await expectRecordedTrip();
    });

    it('records an Explorer tree file open', async () => {
        seedFile();
        renderPanel();
        await screen.findByTestId('mock-file-a.ts');
        fireEvent.click(screen.getByTestId('mock-explorer-open-b'));
        await screen.findByTestId('mock-file-b.ts');

        await expectRecordedTrip();
    });

    it('records a Quick Open file selection', async () => {
        seedFile();
        renderPanel();
        const a = await screen.findByTestId('mock-file-a.ts');
        act(() => a.focus());
        fireEvent.keyDown(document, { key: 'p', ctrlKey: true });
        fireEvent.click(await screen.findByTestId('mock-quick-open-b'));
        await screen.findByTestId('mock-file-b.ts');

        await expectRecordedTrip();
    });

    it('records a Search result file-and-line open', async () => {
        seedFile();
        const view = renderPanel();
        await screen.findByTestId('mock-file-a.ts');
        fireEvent.click(screen.getByTestId('unified-panel-search-toggle'));
        view.rerender(
            <UnifiedRightPanel workspaceId={WS} chatId={CHAT} dock={{ ...dockStub(), mode: 'search' }} />,
        );
        fireEvent.click(await screen.findByTestId('mock-search-open-b'));
        await screen.findByTestId('mock-file-b.ts');

        await expectRecordedTrip();
        expect(controllers.get('b.ts')?.restore).toHaveBeenLastCalledWith(snapshot(30, 5));
    });

    it('records a file opened through the chat/tool-link panel seam', async () => {
        seedFile();
        renderPanel();
        await screen.findByTestId('mock-file-a.ts');
        act(() => {
            openUnifiedPanelTab(WS, {
                kind: 'file',
                ownerWorkspaceId: WS,
                chatId: CHAT,
                resourceId: 'b.ts',
                label: 'b.ts',
                line: 30,
                column: 5,
            });
        });
        await screen.findByTestId('mock-file-b.ts');

        await expectRecordedTrip();
    });

    it('records locations on both sides of a tab-strip click', async () => {
        const withA = openTab(EMPTY_UNIFIED_PANEL, {
            kind: 'file', ownerWorkspaceId: WS, chatId: CHAT, resourceId: 'a.ts', label: 'a.ts',
        });
        writeUnifiedPanelState(WS, openTab(withA, {
            kind: 'file', ownerWorkspaceId: WS, chatId: CHAT, resourceId: 'b.ts', label: 'b.ts',
        }));
        renderPanel();
        await screen.findByTestId('mock-file-b.ts');
        fireEvent.click(screen.getByTestId(`unified-panel-tab-${fileId('a.ts')}`));

        await expectRecordedTrip('b.ts', 'a.ts');
    });

    it('records a cursor move at least ten lines away in the same file', async () => {
        seedFile();
        renderPanel();
        const a = await screen.findByTestId('mock-file-a.ts');
        fireEvent.click(screen.getByTestId('move-far-in-a'));
        act(() => a.focus());

        expect(pressHistory('back').defaultPrevented).toBe(true);
        expect(controllers.get('a.ts')?.restore).toHaveBeenLastCalledWith(snapshot(1, 3));
        expect(pressHistory('forward').defaultPrevented).toBe(true);
        expect(controllers.get('a.ts')?.restore).toHaveBeenLastCalledWith(snapshot(20));
    });

    // Regression: a nearby cursor move after Back replaced the current entry and
    // truncated the forward branch, so Forward stopped working.
    it('keeps Forward available after a nearby cursor move following Back', async () => {
        seedFile();
        renderPanel();
        await screen.findByTestId('mock-file-a.ts');
        fireEvent.click(screen.getByTestId('jump-to-b'));
        const b = await screen.findByTestId('mock-file-b.ts');
        act(() => b.focus());

        expect(pressHistory('back').defaultPrevented).toBe(true);
        await waitFor(() => expect(
            screen.getByTestId(`unified-panel-tab-${fileId('a.ts')}`),
        ).toHaveAttribute('aria-selected', 'true'));
        await act(async () => { await Promise.resolve(); });
        fireEvent.click(screen.getByTestId('move-near-in-a'));

        act(() => screen.getByTestId('mock-file-a.ts').focus());
        expect(pressHistory('forward').defaultPrevented).toBe(true);
        await waitFor(() => expect(
            screen.getByTestId(`unified-panel-tab-${fileId('b.ts')}`),
        ).toHaveAttribute('aria-selected', 'true'));
        expect(controllers.get('b.ts')?.restore).toHaveBeenLastCalledWith(snapshot(30, 5));

        act(() => b.focus());
        expect(pressHistory('back').defaultPrevented).toBe(true);
        await waitFor(() => expect(controllers.get('a.ts')?.restore).toHaveBeenLastCalledWith(snapshot(3, 1)));
    });

    it('restores a same-file jump without creating replay visits', async () => {
        seedFile();
        renderPanel();
        const file = await screen.findByTestId('mock-file-a.ts');
        act(() => file.focus());
        fireEvent.click(screen.getByTestId('jump-in-a'));

        expect(pressHistory('back').defaultPrevented).toBe(true);
        expect(controllers.get('a.ts')?.restore).toHaveBeenCalledWith(snapshot(1, 3));
        expect(pressHistory('back').defaultPrevented).toBe(false);

        expect(pressHistory('forward').defaultPrevented).toBe(true);
        expect(controllers.get('a.ts')?.restore).toHaveBeenLastCalledWith(snapshot(40, 9));
        expect(pressHistory('forward').defaultPrevented).toBe(false);
    });

    it('shares history with auxiliary mouse buttons and claims both mouse events', async () => {
        seedFile();
        renderPanel();
        await screen.findByTestId('mock-file-a.ts');
        fireEvent.click(screen.getByTestId('jump-to-b'));
        const b = await screen.findByTestId('mock-file-b.ts');

        const back = mouseHistory(b, 3);
        expect(back.down.defaultPrevented).toBe(true);
        expect(back.up.defaultPrevented).toBe(true);
        await waitFor(() => expect(
            screen.getByTestId(`unified-panel-tab-${fileId('a.ts')}`),
        ).toHaveAttribute('aria-selected', 'true'));

        const a = screen.getByTestId('mock-file-a.ts');
        await act(async () => { await Promise.resolve(); });
        const forward = mouseHistory(a, 4);
        expect(forward.down.defaultPrevented).toBe(true);
        expect(forward.up.defaultPrevented).toBe(true);
        await waitFor(() => expect(
            screen.getByTestId(`unified-panel-tab-${fileId('b.ts')}`),
        ).toHaveAttribute('aria-selected', 'true'));
    });

    it('preserves native behavior outside the panel, when hidden, and at a boundary', async () => {
        seedFile();
        const view = renderPanel();
        const a = await screen.findByTestId('mock-file-a.ts');
        act(() => a.focus());

        expect(pressHistory('back').defaultPrevented).toBe(false);
        const outside = document.createElement('button');
        document.body.appendChild(outside);
        act(() => outside.focus());
        expect(pressHistory('back').defaultPrevented).toBe(false);
        expect(mouseHistory(outside, 3).down.defaultPrevented).toBe(false);

        view.rerender(<UnifiedRightPanel workspaceId={WS} chatId={CHAT} dock={dockStub(false)} />);
        act(() => a.focus());
        expect(pressHistory('back').defaultPrevented).toBe(false);
        expect(mouseHistory(a, 3).down.defaultPrevented).toBe(false);
        outside.remove();
    });

    it('does not claim history input while a non-file tab is active', async () => {
        seedFile();
        renderPanel();
        await screen.findByTestId('mock-file-a.ts');
        fireEvent.click(screen.getByTestId('unified-panel-open-menu'));
        fireEvent.click(screen.getByTestId('unified-panel-open-notes'));
        const notes = await screen.findByTestId('mock-notes');
        act(() => notes.focus());

        expect(pressHistory('back').defaultPrevented).toBe(false);
        expect(mouseHistory(notes, 3).down.defaultPrevented).toBe(false);
    });

    // Regression: the document-level capture handler stepped history before the
    // focused tab's own Alt+Arrow reorder handler could run.
    it('lets a focused strip tab keep Alt+Arrow for reordering and leaves history intact', async () => {
        seedFile();
        renderPanel();
        await screen.findByTestId('mock-file-a.ts');
        fireEvent.click(screen.getByTestId('jump-to-b'));
        await screen.findByTestId('mock-file-b.ts');
        const tabB = screen.getByTestId(`unified-panel-tab-${fileId('b.ts')}`);
        const order = () => screen.getAllByRole('tab').map(tab => tab.getAttribute('data-tab-id'));
        expect(order()).toEqual([fileId('a.ts'), fileId('b.ts')]);

        act(() => tabB.focus());
        const event = new KeyboardEvent('keydown', {
            key: 'ArrowLeft', altKey: true, bubbles: true, cancelable: true,
        });
        act(() => { tabB.dispatchEvent(event); });

        expect(order()).toEqual([fileId('b.ts'), fileId('a.ts')]);
        expect(screen.getByTestId(`unified-panel-tab-${fileId('b.ts')}`)).toHaveAttribute('aria-selected', 'true');
        expect(controllers.get('a.ts')?.restore).not.toHaveBeenCalled();

        act(() => screen.getByTestId('mock-file-b.ts').focus());
        expect(pressHistory('back').defaultPrevented).toBe(true);
        await waitFor(() => expect(
            screen.getByTestId(`unified-panel-tab-${fileId('a.ts')}`),
        ).toHaveAttribute('aria-selected', 'true'));
        expect(controllers.get('a.ts')?.restore).toHaveBeenCalledWith(snapshot(1, 3));
    });

    it('reopens a closed destination as a preview at its saved location', async () => {
        seedFile();
        renderPanel();
        await screen.findByTestId('mock-file-a.ts');
        fireEvent.click(screen.getByTestId('jump-to-b'));
        await screen.findByTestId('mock-file-b.ts');

        fireEvent.click(screen.getByTestId(`unified-panel-tab-close-${fileId('b.ts')}`));
        await waitFor(() => expect(
            screen.queryByTestId(`unified-panel-tab-${fileId('b.ts')}`),
        ).not.toBeInTheDocument());
        act(() => screen.getByTestId('mock-file-a.ts').focus());

        // Closing B landed on A, which is itself a visit: [A, B, A].
        expect(pressHistory('back').defaultPrevented).toBe(true);
        const reopened = await screen.findByTestId(`unified-panel-tab-${fileId('b.ts')}`);
        expect(reopened).toHaveAttribute('aria-selected', 'true');
        expect(reopened).toHaveAttribute('data-preview', 'true');
        await waitFor(() => expect(controllers.get('b.ts')?.restore).toHaveBeenCalledWith(snapshot(30, 5)));

        await act(async () => { await Promise.resolve(); });
        act(() => screen.getByTestId('mock-file-b.ts').focus());
        expect(pressHistory('forward').defaultPrevented).toBe(true);
        await waitFor(() => expect(
            screen.getByTestId(`unified-panel-tab-${fileId('a.ts')}`),
        ).toHaveAttribute('aria-selected', 'true'));
    });

    it('skips a closed destination whose file is gone and keeps stepping the same way', async () => {
        const location = (path: string, line: number) => ({
            scopeWorkspaceId: WS,
            tabId: fileId(path),
            file: { ownerWorkspaceId: WS, resourceId: path, label: path },
            ...snapshot(line),
        });
        writeUnifiedPanelNavigationHistory(WS, {
            entries: [location('c.ts', 7), location('b.ts', 12), location('a.ts', 1)],
            index: 2,
            replaying: false,
        });
        missingFiles.add('b.ts');
        seedFile();
        renderPanel();
        const a = await screen.findByTestId('mock-file-a.ts');
        act(() => a.focus());

        expect(pressHistory('back').defaultPrevented).toBe(true);
        const c = await screen.findByTestId(`unified-panel-tab-${fileId('c.ts')}`);
        expect(c).toHaveAttribute('data-preview', 'true');
        await waitFor(() => expect(controllers.get('c.ts')?.restore).toHaveBeenCalledWith(snapshot(7)));
        expect(screen.queryByTestId(`unified-panel-tab-${fileId('b.ts')}`)).not.toBeInTheDocument();

        // B's entries are gone: Forward goes straight back to A.
        await act(async () => { await Promise.resolve(); });
        act(() => screen.getByTestId('mock-file-c.ts').focus());
        expect(pressHistory('forward').defaultPrevented).toBe(true);
        await waitFor(() => expect(
            screen.getByTestId(`unified-panel-tab-${fileId('a.ts')}`),
        ).toHaveAttribute('aria-selected', 'true'));
        expect(screen.queryByTestId(`unified-panel-tab-${fileId('b.ts')}`)).not.toBeInTheDocument();
    });

    it('leaves a later keyboard Back unclaimed after exhausting missing files', async () => {
        seedExhaustedHistory();
        renderPanel();
        const a = await screen.findByTestId('mock-file-a.ts');
        act(() => a.focus());

        // The read fails after this event returns; it cannot undo preventDefault.
        expect(pressHistory('back').defaultPrevented).toBe(true);
        await waitFor(() => expect(readUnifiedPanelNavigationHistory(WS).entries.map(entry => entry.file.resourceId)).toEqual(['a.ts']));
        expect(screen.queryByTestId(`unified-panel-tab-${fileId('b.ts')}`)).not.toBeInTheDocument();
        expect(screen.queryByTestId(`unified-panel-tab-${fileId('c.ts')}`)).not.toBeInTheDocument();
        act(() => a.focus());
        expect(pressHistory('back').defaultPrevented).toBe(false);
        expect(screen.getByTestId(`unified-panel-tab-${fileId('a.ts')}`)).toHaveAttribute('aria-selected', 'true');
    });

    it('leaves later auxiliary mouse events unclaimed after exhausting missing files', async () => {
        seedExhaustedHistory();
        renderPanel();
        const a = await screen.findByTestId('mock-file-a.ts');

        const first = mouseHistory(a, 3);
        expect(first.down.defaultPrevented).toBe(true);
        expect(first.up.defaultPrevented).toBe(true);
        await waitFor(() => expect(readUnifiedPanelNavigationHistory(WS).entries.map(entry => entry.file.resourceId)).toEqual(['a.ts']));
        expect(screen.queryByTestId(`unified-panel-tab-${fileId('b.ts')}`)).not.toBeInTheDocument();
        expect(screen.queryByTestId(`unified-panel-tab-${fileId('c.ts')}`)).not.toBeInTheDocument();
        const next = mouseHistory(a, 3);
        expect(next.down.defaultPrevented).toBe(false);
        expect(next.up.defaultPrevented).toBe(false);
    });

    it('does not replay one workspace scope after switching to another', async () => {
        seedFile();
        const view = renderPanel();
        await screen.findByTestId('mock-file-a.ts');
        fireEvent.click(screen.getByTestId('jump-in-a'));

        const otherWorkspace = 'ws-2';
        seedFile('a.ts', otherWorkspace);
        view.rerender(
            <UnifiedRightPanel
                workspaceId={otherWorkspace}
                chatId={CHAT}
                dock={{ ...dockStub(), target: otherWorkspace }}
            />,
        );
        const otherFile = await screen.findByTestId('mock-file-a.ts');
        act(() => otherFile.focus());

        expect(pressHistory('back').defaultPrevented).toBe(false);
    });

    it('restores a workspace history persisted before a reload', async () => {
        seedFile();
        const first = renderPanel();
        await screen.findByTestId('mock-file-a.ts');
        fireEvent.click(screen.getByTestId('jump-to-b'));
        await screen.findByTestId('mock-file-b.ts');
        first.unmount();
        // A reload drops the in-memory cache; only localStorage survives.
        const saved = { ...localStorage };
        clearUnifiedPanelNavigationHistory();
        for (const [key, value] of Object.entries(saved)) localStorage.setItem(key, value);

        renderPanel();
        const b = await screen.findByTestId('mock-file-b.ts');
        act(() => b.focus());
        expect(pressHistory('back').defaultPrevented).toBe(true);
        await waitFor(() => expect(controllers.get('a.ts')?.restore).toHaveBeenCalledWith(snapshot(1, 3)));
    });

    it('keeps a workspace history in memory when its panel remounts', async () => {
        seedFile();
        const first = renderPanel();
        await screen.findByTestId('mock-file-a.ts');
        fireEvent.click(screen.getByTestId('jump-to-b'));
        await screen.findByTestId('mock-file-b.ts');
        first.unmount();

        renderPanel();
        const b = await screen.findByTestId('mock-file-b.ts');
        act(() => b.focus());
        expect(pressHistory('back').defaultPrevented).toBe(true);

        await waitFor(() => expect(
            screen.getByTestId(`unified-panel-tab-${fileId('a.ts')}`),
        ).toHaveAttribute('aria-selected', 'true'));
        await waitFor(() => expect(controllers.get('a.ts')?.restore).toHaveBeenCalledWith(snapshot(1, 3)));
    });
});
