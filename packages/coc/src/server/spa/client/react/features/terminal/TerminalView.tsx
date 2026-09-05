/**
 * Multi-tab terminal container. Manages an array of terminal sessions
 * as tabs, with a toolbar for creating/closing/switching terminals.
 * Each TerminalPanel is rendered with display:none/block to preserve
 * state when switching tabs.
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../../ui/cn';
import { TerminalPanel } from './TerminalPanel';
import { useCocClient } from '../../repos/cloneRouting';
import { CocApiError } from '@plusplusoneplusplus/coc-client';
import type { TerminalSessionInfo } from './hooks/useTerminalWebSocket';

export interface TerminalViewProps {
    workspaceId: string;
    /**
     * When set, the toolbar (terminal picker + new-terminal action) renders into
     * this element via a portal instead of inline. The workspace dock uses it to
     * merge the toolbar into its single-row header next to the Terminal/Explorer
     * tabs; standalone usage (the classic Terminal sub-tab) leaves it undefined
     * and keeps the inline bordered toolbar.
     */
    toolbarPortalTarget?: HTMLElement | null;
}

interface TerminalTab {
    id: string;
    serverSessionId?: string;
    connectionMode: 'create' | 'attach';
    workspaceId: string;
    title: string;
    /**
     * Lifecycle state mirrored from the server (AC-05). An `exited` tab is a
     * tombstone: its scrollback still replays, input is refused, and the only
     * action left is "Restart shell here".
     */
    status: 'running' | 'exited';
}


export function TerminalView({ workspaceId, toolbarPortalTarget }: TerminalViewProps) {
    // Route terminal REST (list/restart/delete) to the workspace's clone. The PTY
    // socket itself is routed inside useTerminalWebSocket via the same registry.
    const client = useCocClient(workspaceId);
    const [terminals, setTerminals] = useState<TerminalTab[]>([]);
    const [activeId, setActiveId] = useState<string>('');
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editValue, setEditValue] = useState('');
    const [restartingIds, setRestartingIds] = useState<Set<string>>(() => new Set());
    const [terminalNotice, setTerminalNotice] = useState<string | null>(null);
    // Compact picker: the terminal list collapses into a "Terminal N ▾" dropdown
    // so a narrow dock never overflows with a horizontal tab strip.
    const [menuOpen, setMenuOpen] = useState(false);
    const editInputRef = useRef<HTMLInputElement>(null);
    const toolbarRef = useRef<HTMLDivElement>(null);
    const counterRef = useRef(0);

    const createTerminal = useCallback(() => {
        counterRef.current += 1;
        const id = crypto.randomUUID();
        const title = `Terminal ${counterRef.current}`;
        setTerminals(prev => [...prev, { id, connectionMode: 'create', workspaceId, title, status: 'running' }]);
        setActiveId(id);
    }, [workspaceId]);

    useEffect(() => {
        let cancelled = false;

        // AC-05/AC-06: list *every* session for the workspace, live and exited.
        // Pin no longer exists, so there is nothing to filter on — an exited
        // session is a restartable tombstone, not something to hide.
        async function hydrateTerminals() {
            const body = await client.workspaces.listTerminals(workspaceId);
            const sessions = Array.isArray(body.sessions) ? body.sessions : [];
            if (cancelled) return;

            setTerminals(prev => {
                const sessionIds = new Set(sessions.map(session => session.id));
                const retainedTabs = prev.filter(tab =>
                    tab.workspaceId === workspaceId &&
                    (tab.connectionMode !== 'attach' ||
                        (tab.serverSessionId != null && sessionIds.has(tab.serverSessionId)))
                );
                const retainedServerSessionIds = new Set(
                    retainedTabs
                        .map(tab => tab.serverSessionId)
                        .filter((id): id is string => id != null),
                );
                const hydratedTabs: TerminalTab[] = sessions
                    .filter(session => !retainedServerSessionIds.has(session.id))
                    .map(session => ({
                        id: `server-${session.id}`,
                        serverSessionId: session.id,
                        connectionMode: 'attach',
                        workspaceId,
                        title: `Terminal ${session.id.slice(0, 6)}`,
                        status: session.status === 'exited' ? 'exited' : 'running',
                    }));
                const next = [...retainedTabs, ...hydratedTabs];
                setActiveId(currentActiveId =>
                    currentActiveId && next.some(tab => tab.id === currentActiveId)
                        ? currentActiveId
                        : next[0]?.id ?? '',
                );
                return next;
            });
        }

        hydrateTerminals().catch(err => {
            console.error('Failed to hydrate terminal sessions:', err);
        });

        return () => {
            cancelled = true;
        };
    }, [workspaceId, client]);

    // The tab's ✕ is the explicit kill (AC-02): panel unmount only detaches now,
    // so the server session has to be ended here or the PTY would outlive its tab.
    const closeTerminal = useCallback((id: string) => {
        const serverSessionId = terminals.find(t => t.id === id)?.serverSessionId;
        setTerminals(prev => {
            const next = prev.filter(t => t.id !== id);
            if (next.length === 0) {
                setActiveId('');
            } else if (id === activeId) {
                setActiveId(next[next.length - 1].id);
            }
            return next;
        });
        if (serverSessionId) {
            client.workspaces.deleteTerminal(workspaceId, serverSessionId).catch(err => {
                // A 404 just means the session is already gone — nothing to kill.
                if (err instanceof CocApiError && err.status === 404) return;
                console.error('Failed to close terminal session:', err);
            });
        }
    }, [activeId, client, terminals, workspaceId]);

    // A PTY that ends leaves a server-side tombstone (AC-05), so the tab stays
    // in the list — badged, read-only, and restartable — instead of dying.
    const handleExit = useCallback((id: string, _code: number) => {
        setTerminals(prev =>
            prev.map(t => t.id === id ? { ...t, status: 'exited' } : t)
        );
    }, []);

    const markRestarting = useCallback((id: string, restarting: boolean) => {
        setRestartingIds(prev => {
            const next = new Set(prev);
            if (restarting) {
                next.add(id);
            } else {
                next.delete(id);
            }
            return next;
        });
    }, []);

    const markSessionMissing = useCallback((id: string) => {
        setTerminals(prev =>
            prev.map(t => {
                if (t.id !== id) return t;
                const title = t.title.includes('(missing)') ? t.title : `${t.title} (missing)`;
                return { ...t, title, status: 'exited', serverSessionId: undefined };
            })
        );
    }, []);

    /**
     * "Restart shell here" (AC-05): respawn the exited session in its recorded
     * cwd. The replacement carries a new server id and the old scrollback, so
     * the tab is re-keyed to force a fresh attach rather than replaying on top
     * of what is already on screen.
     */
    const restartTerminal = useCallback(async (id: string) => {
        const tab = terminals.find(t => t.id === id);
        if (!tab || !tab.serverSessionId || tab.status !== 'exited' || restartingIds.has(id)) return;

        setTerminalNotice(null);
        markRestarting(id, true);
        try {
            const body = await client.workspaces.restartTerminal(workspaceId, tab.serverSessionId);
            const session = body?.session;
            if (!session || typeof session.id !== 'string') {
                throw new Error('Terminal restart response did not include a session.');
            }
            const nextTabId = `server-${session.id}`;
            setTerminals(prev =>
                prev.map(t => t.id === id
                    ? { ...t, id: nextTabId, serverSessionId: session.id, connectionMode: 'attach', status: 'running' }
                    : t)
            );
            setActiveId(current => (current === id ? nextTabId : current));
            if (body.notice) setTerminalNotice(body.notice);
        } catch (err) {
            if (err instanceof CocApiError && err.status === 404) {
                markSessionMissing(id);
                setTerminalNotice('Terminal session no longer exists.');
                return;
            }
            console.error('Failed to restart terminal session:', err);
            setTerminalNotice('Failed to restart terminal.');
        } finally {
            markRestarting(id, false);
        }
    }, [client, markRestarting, markSessionMissing, restartingIds, terminals, workspaceId]);

    const handleServerSessionCreated = useCallback((id: string, session: TerminalSessionInfo) => {
        setTerminals(prev =>
            prev.map(t =>
                t.id === id
                    ? { ...t, serverSessionId: session.id, status: session.status === 'exited' ? 'exited' : 'running' }
                    : t
            )
        );
    }, []);

    const startRename = useCallback((tab: TerminalTab) => {
        setMenuOpen(false);
        setEditingId(tab.id);
        setEditValue(tab.title);
    }, []);

    const commitRename = useCallback(() => {
        if (!editingId) return;
        const trimmed = editValue.trim();
        if (trimmed) {
            setTerminals(prev =>
                prev.map(t => t.id === editingId ? { ...t, title: trimmed } : t)
            );
        }
        setEditingId(null);
    }, [editingId, editValue]);

    const cancelRename = useCallback(() => {
        setEditingId(null);
    }, []);

    // Focus the rename input when it appears
    useEffect(() => {
        if (editingId && editInputRef.current) {
            editInputRef.current.focus();
            editInputRef.current.select();
        }
    }, [editingId]);

    // Close the picker menu on outside click (anywhere below the toolbar) or Escape.
    // The toolbar itself — including the "+" button — counts as "inside" so those
    // clicks don't dismiss it mid-interaction.
    useEffect(() => {
        if (!menuOpen) return;
        function handlePointerDown(event: MouseEvent) {
            if (toolbarRef.current && !toolbarRef.current.contains(event.target as Node)) {
                setMenuOpen(false);
            }
        }
        function handleKeyDown(event: KeyboardEvent) {
            if (event.key === 'Escape') setMenuOpen(false);
        }
        document.addEventListener('mousedown', handlePointerDown);
        document.addEventListener('keydown', handleKeyDown);
        return () => {
            document.removeEventListener('mousedown', handlePointerDown);
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, [menuOpen]);

    const activeTab = terminals.find(t => t.id === activeId) ?? null;

    // Toolbar: compact terminal picker + new-terminal action. Rendered inline by
    // default; the workspace dock portals it into its single-row header so the
    // Terminal/Explorer tabs and the picker share one bar (no bordered wrapper /
    // background then — the header supplies those).
    const toolbar = (
        <div
            ref={toolbarRef}
            className={cn(
                "flex items-center gap-1",
                toolbarPortalTarget
                    ? "h-full w-full px-1"
                    : "px-2 py-1 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 shrink-0",
            )}
        >
                {terminals.length > 0 ? (
                    <div className="relative min-w-0">
                        {editingId && activeTab ? (
                            <input
                                ref={editInputRef}
                                className="text-xs bg-transparent border border-blue-400 dark:border-blue-500 rounded px-1.5 py-1 outline-none w-32"
                                value={editValue}
                                onChange={(e) => setEditValue(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter') { e.preventDefault(); commitRename(); }
                                    if (e.key === 'Escape') { e.preventDefault(); cancelRename(); }
                                }}
                                onBlur={commitRename}
                                data-testid={`terminal-tab-rename-input-${activeTab.id}`}
                            />
                        ) : (
                            <button
                                type="button"
                                className="flex items-center gap-1.5 px-2 py-1 max-w-[220px] text-xs rounded text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-700"
                                onClick={() => setMenuOpen(open => !open)}
                                title="Switch terminal"
                                aria-haspopup="menu"
                                aria-expanded={menuOpen}
                                data-menu-open={menuOpen ? 'true' : 'false'}
                                data-testid="terminal-picker-btn"
                            >
                                <span
                                    className={cn(
                                        "h-1.5 w-1.5 rounded-full shrink-0",
                                        activeTab?.status === 'exited' ? "bg-gray-400 dark:bg-gray-500" : "bg-green-500",
                                    )}
                                    aria-hidden="true"
                                />
                                <span
                                    className="truncate"
                                    onDoubleClick={(e) => { e.stopPropagation(); if (activeTab) startRename(activeTab); }}
                                    data-testid={`terminal-tab-title-${activeTab?.id ?? ''}`}
                                >
                                    {activeTab?.title ?? 'Terminal'}
                                </span>
                                {terminals.length > 1 ? (
                                    <span className="text-[10px] leading-none px-1 py-0.5 rounded bg-gray-200 dark:bg-gray-700 text-gray-500 dark:text-gray-400 shrink-0" data-testid="terminal-count-badge">
                                        {terminals.length}
                                    </span>
                                ) : null}
                                <svg className="w-3 h-3 shrink-0 opacity-60" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                    <polyline points="4,6 8,10 12,6" />
                                </svg>
                            </button>
                        )}

                        {menuOpen ? (
                            <div
                                className="absolute left-0 top-full z-20 mt-1 min-w-[200px] max-w-[280px] rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 py-1 shadow-lg"
                                role="menu"
                                data-testid="terminal-picker-menu"
                            >
                                {terminals.map(tab => (
                                    <div
                                        key={tab.id}
                                        role="menuitemradio"
                                        aria-checked={tab.id === activeId}
                                        className={cn(
                                            "group mx-1 flex items-center gap-1.5 rounded px-2 py-1.5 text-xs cursor-pointer",
                                            "hover:bg-gray-100 dark:hover:bg-gray-700",
                                            tab.id === activeId
                                                ? "bg-gray-100 dark:bg-gray-700/60 font-medium text-gray-800 dark:text-gray-100"
                                                : "text-gray-600 dark:text-gray-300"
                                        )}
                                        onClick={() => { setActiveId(tab.id); setMenuOpen(false); }}
                                        data-testid={`terminal-menu-item-${tab.id}`}
                                    >
                                        <span
                                            className={cn(
                                                "h-1.5 w-1.5 rounded-full shrink-0",
                                                tab.status === 'exited'
                                                    ? "bg-gray-400 dark:bg-gray-500"
                                                    : tab.id === activeId ? "bg-green-500" : "bg-gray-400 dark:bg-gray-500"
                                            )}
                                            aria-hidden="true"
                                        />
                                        <span className="flex-1 truncate" data-testid={`terminal-menu-title-${tab.id}`}>
                                            {tab.title}
                                        </span>
                                        {tab.status === 'exited' ? (
                                            <span
                                                className="shrink-0 rounded bg-gray-200 px-1 py-0.5 text-[10px] leading-none text-gray-500 dark:bg-gray-700 dark:text-gray-400"
                                                data-testid={`terminal-tab-exited-badge-${tab.id}`}
                                            >
                                                exited
                                            </span>
                                        ) : null}
                                        {tab.status === 'exited' ? (
                                            <span
                                                className={cn(
                                                    "shrink-0 cursor-pointer text-blue-600 opacity-80 hover:opacity-100 dark:text-blue-400",
                                                    (!tab.serverSessionId || restartingIds.has(tab.id)) && "cursor-not-allowed opacity-40",
                                                )}
                                                onClick={(e) => { e.stopPropagation(); void restartTerminal(tab.id); }}
                                                title={tab.serverSessionId ? 'Restart shell here' : 'Terminal session no longer exists'}
                                                aria-disabled={!tab.serverSessionId || restartingIds.has(tab.id)}
                                                data-testid={`terminal-tab-restart-${tab.id}`}
                                            >
                                                ⟳
                                            </span>
                                        ) : null}
                                        <span
                                            className="opacity-50 hover:opacity-100"
                                            onClick={(e) => { e.stopPropagation(); closeTerminal(tab.id); }}
                                            title="Close terminal"
                                            data-testid={`terminal-tab-close-${tab.id}`}
                                        >
                                            ✕
                                        </span>
                                    </div>
                                ))}
                                <div className="my-1 border-t border-gray-200 dark:border-gray-700" />
                                <button
                                    type="button"
                                    className="mx-1 flex w-[calc(100%-0.5rem)] items-center gap-1.5 rounded px-2 py-1.5 text-xs text-blue-600 dark:text-blue-400 hover:bg-gray-100 dark:hover:bg-gray-700"
                                    onClick={() => { createTerminal(); setMenuOpen(false); }}
                                    data-testid="terminal-menu-new"
                                >
                                    <span className="text-sm leading-none">+</span>
                                    New terminal
                                </button>
                            </div>
                        ) : null}
                    </div>
                ) : (
                    <span className="px-1 text-xs text-gray-400 dark:text-gray-500 select-none">
                        No terminals
                    </span>
                )}

                <div className="min-w-0 flex-1" />

                {/* New Terminal button */}
                <button
                    className="flex items-center gap-1 px-2 py-1 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-700 rounded shrink-0"
                    onClick={createTerminal}
                    title="New Terminal"
                    data-testid="terminal-new-btn"
                >
                    <span>+</span>
                </button>
                {terminalNotice ? (
                    <span className="text-xs text-amber-600 dark:text-amber-400 truncate" data-testid="terminal-notice">
                        {terminalNotice}
                    </span>
                ) : null}
        </div>
    );

    return (
        <div className="flex flex-col h-full" data-testid="terminal-view">
            {toolbarPortalTarget ? createPortal(toolbar, toolbarPortalTarget) : toolbar}

            {/* Terminal panels — all rendered, visibility toggled */}
            <div className="flex-1 min-h-0 relative">
                {terminals.length === 0 ? (
                    <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-400 dark:text-gray-500" data-testid="terminal-empty-state">
                        <span className="text-lg mb-1">⬛</span>
                        <span className="text-sm font-medium">No terminals open</span>
                        <span className="text-xs mt-1">Click + to create a terminal</span>
                    </div>
                ) : terminals.map(tab => (
                    <div
                        key={tab.id}
                        style={{ display: tab.id === activeId ? undefined : 'none' }}
                        className="absolute inset-0"
                    >
                        <TerminalPanel
                            sessionId={tab.id}
                            serverSessionId={tab.serverSessionId}
                            connectionMode={tab.connectionMode}
                            workspaceId={workspaceId}
                            isActive={tab.id === activeId}
                            readOnly={tab.status === 'exited'}
                            onExit={(code) => handleExit(tab.id, code)}
                            onTitleChange={(title) =>
                                setTerminals(prev =>
                                    prev.map(t => t.id === tab.id ? { ...t, title } : t)
                                )
                            }
                            onServerSessionCreated={(session) => handleServerSessionCreated(tab.id, session)}
                        />
                    </div>
                ))}
            </div>
        </div>
    );
}
