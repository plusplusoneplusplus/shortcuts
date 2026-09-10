/**
 * Terminal session survival in the unified panel (AC-05).
 *
 * The close guard (UnifiedPanelTerminalClose.test.tsx) pins what happens when a
 * user asks to end a session. This file pins the other half of the slice: every
 * navigation that is NOT a close must leave the PTY alone — a tab switch, a chat
 * switch, a dock collapse, and workspace navigation. And when a view does come
 * back, it must ATTACH to the session that is already there rather than spawn a
 * second one.
 *
 * The terminal view is stubbed by a fake that keeps the two behaviors the panel
 * actually depends on: it hydrates from the server on mount (`listTerminals`)
 * and creates a PTY only from its own explicit "+" (`spawnTerminal`). That is
 * what makes the assertions honest — "attached once more" and "spawned again"
 * are different counters here, exactly as they are in the real view.
 *
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

// ---------------------------------------------------------------------------
// A fake terminal server, shared by the stub view and the clone registry mock.
// ---------------------------------------------------------------------------
interface FakeSession { id: string; status: 'running' | 'exited' }
const server: { sessions: FakeSession[]; next: number } = { sessions: [], next: 0 };
const listTerminals = vi.fn(async (_ws: string) => ({ sessions: server.sessions.map(s => ({ ...s })) }));
const deleteTerminal = vi.fn(async (_ws: string, id: string) => {
    server.sessions = server.sessions.filter(session => session.id !== id);
});
const spawnTerminal = vi.fn(() => {
    server.next += 1;
    const id = `s-${server.next}`;
    server.sessions.push({ id, status: 'running' });
    return id;
});
/** Every mount of the terminal view, in order — one entry per attach. */
const terminalMounts: string[] = [];
const terminalUnmounts: string[] = [];

vi.mock('../../../../src/server/spa/client/react/features/terminal/TerminalView', async () => {
    const { useEffect, useState } = await import('react');
    return {
        TerminalView: ({ workspaceId, onSessionsChange }: {
            workspaceId: string;
            onSessionsChange?: (sessions: readonly { id: string; serverSessionId?: string; status: string }[]) => void;
        }) => {
            const [sessions, setSessions] = useState<{ id: string; serverSessionId: string; status: string }[]>([]);
            useEffect(() => {
                terminalMounts.push(workspaceId);
                let cancelled = false;
                void listTerminals(workspaceId).then(body => {
                    if (cancelled) return;
                    setSessions(body.sessions.map(session => ({
                        id: `server-${session.id}`, serverSessionId: session.id, status: session.status,
                    })));
                });
                return () => { cancelled = true; terminalUnmounts.push(workspaceId); };
            }, [workspaceId]);
            useEffect(() => { onSessionsChange?.(sessions); }, [sessions, onSessionsChange]);
            return (
                <div data-testid="mock-terminal" data-sessions={sessions.map(s => s.serverSessionId).join(',')}>
                    <button
                        type="button"
                        data-testid="mock-terminal-spawn"
                        onClick={() => {
                            const id = spawnTerminal();
                            setSessions(prev => [...prev, { id: `server-${id}`, serverSessionId: id, status: 'running' }]);
                        }}
                    />
                </div>
            );
        },
    };
});
vi.mock('../../../../src/server/spa/client/react/features/repo-detail/explorer/ExplorerPanel', () => ({
    ExplorerPanel: () => <div data-testid="mock-explorer" />,
}));
vi.mock('../../../../src/server/spa/client/react/features/notes/dock/DockNotesPanel', () => ({
    DockNotesPanel: () => <div data-testid="mock-notes" />,
}));
vi.mock('../../../../src/server/spa/client/react/features/repo-detail/explorer/explorerApi', () => ({
    explorerApi: {
        searchFiles: async () => ({ results: [] }),
        readBlob: async () => ({ content: 'hello', encoding: 'utf-8', mimeType: 'text/plain' }),
        writeBlob: async () => ({ success: true }),
        readTrustedBlob: async () => ({ content: '', encoding: 'utf-8', mimeType: 'text/plain' }),
    },
}));
vi.mock('../../../../src/server/spa/client/react/shared/file-viewer/MonacoFileEditor', () => ({
    MonacoFileEditor: () => <div data-testid="mock-monaco" />,
    getMonacoLanguage: () => 'plaintext',
}));
vi.mock('../../../../src/server/spa/client/react/repos/cloneRegistry', () => ({
    getCocClientForWorkspace: () => ({
        canvases: { list: async () => [], create: async () => ({ id: 'c1', title: 'c' }) },
        workspaces: {
            listTerminals: (ws: string) => listTerminals(ws),
            deleteTerminal: (ws: string, id: string) => deleteTerminal(ws, id),
        },
    }),
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
    writeUnifiedPanelState,
} from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelStore';
import { openTab, unifiedTabId } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelTabsModel';
import type { WorkspaceDockController } from '../../../../src/server/spa/client/react/features/repo-detail/useWorkspaceDock';

const WS = 'ws-1';
const OTHER_WS = 'ws-2';
const CHAT_A = 'chat-a';
const CHAT_B = 'chat-b';
const TERMINAL_TAB_ID = unifiedTabId({
    kind: 'terminal', ownerWorkspaceId: WS, chatId: null, resourceId: 'terminal',
});

function dockStub(overrides: Partial<WorkspaceDockController> = {}): WorkspaceDockController {
    return {
        isOpen: true,
        toggleOpen: vi.fn(),
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

function openViaMenu(testId: string) {
    fireEvent.click(screen.getByTestId('unified-panel-open-menu'));
    fireEvent.click(screen.getByTestId(testId));
}

/** Open a terminal tab and start one live session in it, as a user would. */
async function startSession() {
    openViaMenu('unified-panel-open-terminal');
    await waitFor(() => expect(listTerminals).toHaveBeenCalled());
    fireEvent.click(screen.getByTestId('mock-terminal-spawn'));
    await waitFor(() => expect(screen.getByTestId('mock-terminal').getAttribute('data-sessions')).toBe('s-1'));
}

/** The state that matters: one PTY on the server, never killed behind our back. */
function expectSingleLiveSession() {
    expect(server.sessions).toEqual([{ id: 's-1', status: 'running' }]);
    expect(spawnTerminal).toHaveBeenCalledTimes(1);
    expect(deleteTerminal).not.toHaveBeenCalled();
}

describe('UnifiedRightPanel terminal session lifecycle', () => {
    beforeEach(() => {
        localStorage.clear();
        clearUnifiedPanelState();
        server.sessions = [];
        server.next = 0;
        listTerminals.mockClear();
        deleteTerminal.mockClear();
        spawnTerminal.mockClear();
        terminalMounts.length = 0;
        terminalUnmounts.length = 0;
    });
    afterEach(() => {
        cleanup();
        clearUnifiedPanelState();
    });

    it('survives a tab switch without re-attaching or duplicating the PTY', async () => {
        render(<UnifiedRightPanel workspaceId={WS} dock={dockStub()} />);
        await startSession();
        const view = screen.getByTestId('mock-terminal');

        openViaMenu('unified-panel-open-notes');
        fireEvent.click(screen.getByTestId(`unified-panel-tab-${TERMINAL_TAB_ID}`));
        openViaMenu('unified-panel-open-explorer');

        // Same DOM node throughout: the view was hidden, never remounted, so it
        // neither listed the workspace again nor opened a second socket.
        expect(screen.getByTestId('mock-terminal')).toBe(view);
        expect(terminalMounts).toHaveLength(1);
        expect(listTerminals).toHaveBeenCalledTimes(1);
        expectSingleLiveSession();
    });

    it('survives a chat switch, while the chat-owned tabs around it change', async () => {
        const { rerender } = render(
            <UnifiedRightPanel workspaceId={WS} chatId={CHAT_A} dock={dockStub()} />,
        );
        await startSession();
        const view = screen.getByTestId('mock-terminal');

        // A file tab of chat A, so the switch has something chat-owned to swap.
        const fileTabId = unifiedTabId({
            kind: 'file', ownerWorkspaceId: WS, chatId: CHAT_A, resourceId: 'src/a.ts',
        });
        act(() => {
            writeUnifiedPanelState(WS, openTab(readUnifiedPanelState(WS), {
                kind: 'file', ownerWorkspaceId: WS, chatId: CHAT_A, resourceId: 'src/a.ts', label: 'a.ts',
            }));
        });
        expect(screen.getByTestId(`unified-panel-tab-${fileTabId}`)).toBeTruthy();

        rerender(<UnifiedRightPanel workspaceId={WS} chatId={CHAT_B} dock={dockStub()} />);
        // Chat B shows none of chat A's resources, while the workspace-owned
        // terminal stays visible AND stays mounted.
        expect(screen.queryByTestId(`unified-panel-tab-${fileTabId}`)).toBeNull();
        expect(screen.getByTestId(`unified-panel-tab-${TERMINAL_TAB_ID}`)).toBeTruthy();
        expect(screen.getByTestId('mock-terminal')).toBe(view);

        rerender(<UnifiedRightPanel workspaceId={WS} chatId={CHAT_A} dock={dockStub()} />);
        expect(screen.getByTestId(`unified-panel-tab-${fileTabId}`)).toBeTruthy();
        expect(screen.getByTestId('mock-terminal')).toBe(view);
        expect(terminalMounts).toHaveLength(1);
        expectSingleLiveSession();
    });

    it('survives a dock collapse and reopen', async () => {
        const { rerender } = render(<UnifiedRightPanel workspaceId={WS} dock={dockStub()} />);
        await startSession();
        const view = screen.getByTestId('mock-terminal');

        rerender(<UnifiedRightPanel workspaceId={WS} dock={dockStub({ isOpen: false })} />);
        expect(screen.getByTestId('unified-right-panel').getAttribute('data-open')).toBe('false');
        // Collapse hides the column; it does not unmount the view under it.
        expect(screen.getByTestId('mock-terminal')).toBe(view);

        rerender(<UnifiedRightPanel workspaceId={WS} dock={dockStub()} />);
        expect(screen.getByTestId('mock-terminal')).toBe(view);
        expect(terminalMounts).toHaveLength(1);
        expectSingleLiveSession();
    });

    it('re-attaches to the same session after workspace navigation, without spawning a second', async () => {
        const { rerender } = render(<UnifiedRightPanel workspaceId={WS} dock={dockStub()} />);
        await startSession();

        // Away to another workspace: that panel has its own (empty) tab session,
        // and leaving must not terminate anything.
        rerender(<UnifiedRightPanel workspaceId={OTHER_WS} dock={dockStub({ target: OTHER_WS })} />);
        expect(screen.queryByTestId('mock-terminal')).toBeNull();
        expect(screen.getByTestId('unified-panel-empty')).toBeTruthy();
        expect(terminalUnmounts).toEqual([WS]);
        expectSingleLiveSession();

        // Back: the persisted descriptor restores as a tab and the view attaches
        // to the PTY that was left running.
        rerender(<UnifiedRightPanel workspaceId={WS} dock={dockStub()} />);
        expect(screen.getByTestId(`unified-panel-tab-${TERMINAL_TAB_ID}`)).toBeTruthy();
        await waitFor(() =>
            expect(screen.getByTestId('mock-terminal').getAttribute('data-sessions')).toBe('s-1'));
        expect(terminalMounts).toEqual([WS, WS]);
        expectSingleLiveSession();
    });
});
