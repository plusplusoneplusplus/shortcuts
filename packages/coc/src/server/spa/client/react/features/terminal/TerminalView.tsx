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
    const editInputRef = useRef<HTMLInputElement>(null);
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

    return (
        <div className="flex flex-col h-full" data-testid="terminal-view">
            {/* Toolbar */}
            <div className="flex items-center gap-1 px-2 py-1 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 shrink-0">
                {/* Tab strip */}
                <div className="flex items-center gap-0.5 overflow-x-auto flex-1 min-w-0">
                    {terminals.map(tab => (
                        <button
                            key={tab.id}
                            className={cn(
                                "flex items-center gap-1.5 px-3 py-1 text-xs rounded-t whitespace-nowrap group",
                                "hover:bg-gray-200 dark:hover:bg-gray-700",
                                tab.id === activeId
                                    ? "bg-white dark:bg-gray-800 border border-b-0 border-gray-200 dark:border-gray-700 font-medium"
                                    : "text-gray-500 dark:text-gray-400"
                            )}
                            onClick={() => setActiveId(tab.id)}
                            data-testid={`terminal-tab-${tab.id}`}
                        >
                            <span className="text-xs">⬛</span>
                            {editingId === tab.id ? (
                                <input
                                    ref={editInputRef}
                                    className="text-xs bg-transparent border border-blue-400 dark:border-blue-500 rounded px-1 py-0 outline-none w-24"
                                    value={editValue}
                                    onChange={(e) => setEditValue(e.target.value)}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter') { e.preventDefault(); commitRename(); }
                                        if (e.key === 'Escape') { e.preventDefault(); cancelRename(); }
                                    }}
                                    onBlur={commitRename}
                                    onClick={(e) => e.stopPropagation()}
                                    data-testid={`terminal-tab-rename-input-${tab.id}`}
                                />
                            ) : (
                                <span
                                    onDoubleClick={(e) => { e.stopPropagation(); startRename(tab); }}
                                    data-testid={`terminal-tab-title-${tab.id}`}
                                >
                                    {tab.title}
                                </span>
                            )}
                            <span
                                className={cn(
                                    "ml-0.5 cursor-pointer",
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
                                className="ml-0.5 opacity-50 hover:opacity-100"
                                onClick={(e) => { e.stopPropagation(); closeTerminal(tab.id); }}
                                data-testid={`terminal-tab-close-${tab.id}`}
                            >
                                ✕
                            </span>
                        </button>
                    ))}
                </div>

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
