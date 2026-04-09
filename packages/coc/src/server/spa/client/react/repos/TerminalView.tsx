/**
 * Multi-tab terminal container. Manages an array of terminal sessions
 * as tabs, with a toolbar for creating/closing/switching terminals.
 * Each TerminalPanel is rendered with display:none/block to preserve
 * state when switching tabs.
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { cn } from '../shared/cn';
import { TerminalPanel } from './TerminalPanel';

export interface TerminalViewProps {
    workspaceId: string;
}

interface TerminalTab {
    id: string;
    title: string;
}

export function TerminalView({ workspaceId }: TerminalViewProps) {
    const [terminals, setTerminals] = useState<TerminalTab[]>([]);
    const [activeId, setActiveId] = useState<string>('');
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editValue, setEditValue] = useState('');
    const editInputRef = useRef<HTMLInputElement>(null);
    const counterRef = useRef(0);

    const createTerminal = useCallback(() => {
        counterRef.current += 1;
        const id = crypto.randomUUID();
        const title = `Terminal ${counterRef.current}`;
        setTerminals(prev => [...prev, { id, title }]);
        setActiveId(id);
    }, []);

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
            prev.map(t => t.id === id ? { ...t, title: `${t.title} (exited)` } : t)
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
                                "flex items-center gap-1.5 px-3 py-1 text-xs rounded-t whitespace-nowrap",
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
                                className="ml-1 opacity-50 hover:opacity-100"
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
                            workspaceId={workspaceId}
                            isActive={tab.id === activeId}
                            onExit={(code) => handleExit(tab.id, code)}
                            onTitleChange={(title) =>
                                setTerminals(prev =>
                                    prev.map(t => t.id === tab.id ? { ...t, title } : t)
                                )
                            }
                        />
                    </div>
                ))}
            </div>
        </div>
    );
}
