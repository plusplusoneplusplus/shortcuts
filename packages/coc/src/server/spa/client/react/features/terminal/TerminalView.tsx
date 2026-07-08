/**
 * Multi-tab terminal container. Manages an array of terminal sessions
 * as tabs, with a toolbar for creating/closing/switching terminals.
 * Each TerminalPanel is rendered with display:none/block to preserve
 * state when switching tabs.
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { cn } from '../../ui/cn';
import { TerminalPanel } from './TerminalPanel';
import { useCocClient } from '../../repos/cloneRouting';
import { CocApiError } from '@plusplusoneplusplus/coc-client';
import type { TerminalSessionInfo } from './hooks/useTerminalWebSocket';

export interface TerminalViewProps {
    workspaceId: string;
}

interface TerminalTab {
    id: string;
    serverSessionId?: string;
    connectionMode: 'create' | 'attach';
    workspaceId: string;
    title: string;
    pinned: boolean;
}


export function TerminalView({ workspaceId }: TerminalViewProps) {
    // Route terminal REST (list/pin) to the workspace's clone (AC-07). The PTY
    // socket itself is routed inside useTerminalWebSocket via the same registry.
    const client = useCocClient(workspaceId);
    const [terminals, setTerminals] = useState<TerminalTab[]>([]);
    const [activeId, setActiveId] = useState<string>('');
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editValue, setEditValue] = useState('');
    const [pinningIds, setPinningIds] = useState<Set<string>>(() => new Set());
    const [pinError, setPinError] = useState<string | null>(null);
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
        setTerminals(prev => [...prev, { id, connectionMode: 'create', workspaceId, title, pinned: false }]);
        setActiveId(id);
    }, [workspaceId]);

    useEffect(() => {
        let cancelled = false;

        async function hydratePinnedTerminals() {
            const body = await client.workspaces.listTerminals(workspaceId);
            const pinnedSessions = (Array.isArray(body.sessions) ? body.sessions : [])
                .filter(session => session.pinned);
            if (cancelled) return;

            setTerminals(prev => {
                const pinnedSessionIds = new Set(pinnedSessions.map(session => session.id));
                const retainedTabs = prev.filter(tab =>
                    tab.workspaceId === workspaceId &&
                    (tab.connectionMode !== 'attach' ||
                        (tab.serverSessionId != null && pinnedSessionIds.has(tab.serverSessionId)))
                );
                const retainedServerSessionIds = new Set(
                    retainedTabs
                        .map(tab => tab.serverSessionId)
                        .filter((id): id is string => id != null),
                );
                const hydratedTabs: TerminalTab[] = pinnedSessions
                    .filter(session => !retainedServerSessionIds.has(session.id))
                    .map(session => ({
                        id: `server-${session.id}`,
                        serverSessionId: session.id,
                        connectionMode: 'attach',
                        workspaceId,
                        title: `Terminal ${session.id.slice(0, 6)}`,
                        pinned: true,
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

        hydratePinnedTerminals().catch(err => {
            console.error('Failed to hydrate pinned terminal sessions:', err);
        });

        return () => {
            cancelled = true;
        };
    }, [workspaceId, client]);

    const closeTerminal = useCallback((id: string) => {
        setTerminals(prev => {
            const next = prev.filter(t => t.id !== id);
            if (next.length === 0) {
                setActiveId('');
            } else if (id === activeId) {
                setActiveId(next[next.length - 1].id);
            }
            return next;
        });
    }, [activeId]);

    const handleExit = useCallback((id: string, code: number) => {
        setTerminals(prev =>
            prev.map(t => t.id === id ? { ...t, title: `${t.title} (exited)`, pinned: false } : t)
        );
    }, []);

    const markPinning = useCallback((id: string, pinning: boolean) => {
        setPinningIds(prev => {
            const next = new Set(prev);
            if (pinning) {
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
                return { ...t, title, pinned: false, serverSessionId: undefined };
            })
        );
    }, []);

    const togglePin = useCallback(async (id: string) => {
        const tab = terminals.find(t => t.id === id);
        if (!tab || !tab.serverSessionId || pinningIds.has(id)) return;

        const requestedPinned = !tab.pinned;
        setPinError(null);
        markPinning(id, true);
        try {
            let body: { sessionId: string; pinned: boolean };
            try {
                body = await client.workspaces.pinTerminal(workspaceId, tab.serverSessionId, requestedPinned);
            } catch (err) {
                if (err instanceof CocApiError && err.status === 404) {
                    markSessionMissing(id);
                    setPinError('Terminal session no longer exists.');
                    return;
                }
                throw err;
            }

            if (body.sessionId !== tab.serverSessionId || typeof body.pinned !== 'boolean') {
                throw new Error('Terminal pin response did not match the requested session.');
            }

            setTerminals(prev =>
                prev.map(t => t.id === id ? { ...t, pinned: body.pinned } : t)
            );
        } catch (err) {
            console.error('Failed to update terminal pin state:', err);
            setPinError(`Failed to ${requestedPinned ? 'pin' : 'unpin'} terminal.`);
        } finally {
            markPinning(id, false);
        }
    }, [markPinning, markSessionMissing, pinningIds, terminals, workspaceId, client]);

    const handleServerSessionCreated = useCallback((id: string, session: TerminalSessionInfo) => {
        setTerminals(prev =>
            prev.map(t =>
                t.id === id
                    ? { ...t, serverSessionId: session.id, pinned: session.pinned }
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

    return (
        <div className="flex flex-col h-full" data-testid="terminal-view">
            {/* Toolbar: compact terminal picker + new-terminal action */}
            <div
                ref={toolbarRef}
                className="flex items-center gap-1 px-2 py-1 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 shrink-0"
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
                                <span className="h-1.5 w-1.5 rounded-full bg-green-500 shrink-0" aria-hidden="true" />
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
                                                tab.id === activeId ? "bg-green-500" : "bg-gray-400 dark:bg-gray-500"
                                            )}
                                            aria-hidden="true"
                                        />
                                        <span className="flex-1 truncate" data-testid={`terminal-menu-title-${tab.id}`}>
                                            {tab.title}
                                        </span>
                                        <span
                                            className={cn(
                                                "cursor-pointer",
                                                (!tab.serverSessionId || pinningIds.has(tab.id)) && "cursor-not-allowed opacity-40",
                                                tab.pinned
                                                    ? "opacity-80 hover:opacity-100 text-blue-500 dark:text-blue-400"
                                                    : "opacity-0 group-hover:opacity-50 hover:!opacity-100"
                                            )}
                                            onClick={(e) => { e.stopPropagation(); void togglePin(tab.id); }}
                                            title={!tab.serverSessionId ? 'Waiting for terminal session' : tab.pinned ? 'Unpin terminal' : 'Pin terminal'}
                                            aria-disabled={!tab.serverSessionId || pinningIds.has(tab.id)}
                                            data-testid={`terminal-tab-pin-${tab.id}`}
                                        >
                                            📌
                                        </span>
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
                {pinError ? (
                    <span className="text-xs text-red-600 dark:text-red-400 truncate" data-testid="terminal-pin-error">
                        {pinError}
                    </span>
                ) : null}
            </div>

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
