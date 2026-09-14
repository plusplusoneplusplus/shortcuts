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

function snapshot(line: number, column = 1): EditorNavigationSnapshot {
    return {
        selection: {
            selectionStartLineNumber: line,
            selectionStartColumn: column,
            positionLineNumber: line,
            positionColumn: column,
        },
        viewState: {
            cursorState: [{
                inSelectionMode: false,
                selectionStart: { lineNumber: line, column },
                position: { lineNumber: line, column },
            }],
            viewState: {
                scrollLeft: 0,
                scrollTop: line * 20,
                firstPosition: { lineNumber: line, column: 1 },
                firstPositionDeltaTop: 0,
            },
            contributionsState: {},
        },
    };
}

vi.mock('../../../../src/server/spa/client/react/features/repo-detail/explorer/PreviewPane', () => ({
    PreviewPane: ({
        filePath,
        onNavigate,
        onNavigationMount,
        onNavigationLocation,
    }: {
        filePath: string;
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
        controllers.set(filePath, entry);
        useEffect(() => {
            onNavigationMount?.(entry.controller);
            onNavigationLocation?.(currentRef.current, 'user');
            return () => onNavigationMount?.(null);
        }, [entry.controller, onNavigationLocation, onNavigationMount]);
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
                    </>
                )}
            </div>
        );
    },
    type: {},
}));

vi.mock('../../../../src/server/spa/client/react/features/repo-detail/explorer/ExplorerPanel', () => ({
    ExplorerPanel: () => <div data-testid="mock-explorer" />,
    getAncestorPaths: () => [],
}));
vi.mock('../../../../src/server/spa/client/react/features/repo-detail/explorer/explorerApi', () => ({
    explorerApi: {
        searchFiles: async () => ({ results: [] }),
        tree: async () => ({ entries: [] }),
    },
}));
vi.mock('../../../../src/server/spa/client/react/features/notes/dock/DockNotesPanel', () => ({
    DockNotesPanel: () => <button data-testid="mock-notes">notes</button>,
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

function mouseHistory(target: HTMLElement, button: 3 | 4) {
    const down = new MouseEvent('mousedown', { button, bubbles: true, cancelable: true });
    const up = new MouseEvent('mouseup', { button, bubbles: true, cancelable: true });
    act(() => {
        target.dispatchEvent(down);
        target.dispatchEvent(up);
    });
    return { down, up };
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

    it('prunes a closed destination instead of reopening it', async () => {
        seedFile();
        renderPanel();
        await screen.findByTestId('mock-file-a.ts');
        fireEvent.click(screen.getByTestId('jump-to-b'));
        const b = await screen.findByTestId('mock-file-b.ts');
        act(() => b.focus());
        pressHistory('back');
        await waitFor(() => expect(
            screen.getByTestId(`unified-panel-tab-${fileId('a.ts')}`),
        ).toHaveAttribute('aria-selected', 'true'));

        fireEvent.click(screen.getByTestId(`unified-panel-tab-close-${fileId('b.ts')}`));
        await waitFor(() => expect(
            screen.queryByTestId(`unified-panel-tab-${fileId('b.ts')}`),
        ).not.toBeInTheDocument());
        act(() => screen.getByTestId('mock-file-a.ts').focus());

        expect(pressHistory('forward').defaultPrevented).toBe(false);
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
