// Cascading dropdown on the chat top bar's Agents control. Left pane lists the
// tree's depth levels (L0 orchestrator, L1, L2, …); the right pane lists that
// level's agents. Picking an agent opens its in-place detail view; picking the
// orchestrator (L0) returns to the thread/canvas. Styled with the app's
// light/dark utility palette to match ChatViewToggle (it renders in the header,
// outside the `.agent-canvas` scope).

import { useEffect, useRef, useState } from 'react';
import { cn } from '../../../ui/cn';
import { AcIcons, roleIcon } from './icons';
import type { AgentLevel } from './agentLevels';
import type { AgentRunStatus } from './types';

interface AgentCascadeMenuProps {
    levels: AgentLevel[];
    /** Currently-open sub-agent id, or null when viewing the orchestrator. */
    selectedAgentId: string | null;
    /** Open a sub-agent (id) or return to the orchestrator (null). */
    onSelectAgent: (agentId: string | null) => void;
}

function Chevron({ open }: { open: boolean }) {
    return (
        <svg
            width={10}
            height={10}
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            className={cn('transition-transform', open && 'rotate-180')}
        >
            <path d="M4 6l4 4 4-4" />
        </svg>
    );
}

function statusDot(status: AgentRunStatus): string {
    switch (status) {
        case 'running': return 'bg-blue-500';
        case 'failed': return 'bg-red-500';
        case 'queued': return 'bg-gray-400';
        default: return 'bg-green-500';
    }
}

export function AgentCascadeMenu({ levels, selectedAgentId, onSelectAgent }: AgentCascadeMenuProps) {
    const [open, setOpen] = useState(false);
    // Default the open pane to L1 (the first sub-agent level) when it exists.
    const [activeDepth, setActiveDepth] = useState(1);
    const wrapRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!open) {
            return;
        }
        const onDown = (e: MouseEvent) => {
            if (!wrapRef.current?.contains(e.target as Node)) {
                setOpen(false);
            }
        };
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                setOpen(false);
            }
        };
        document.addEventListener('mousedown', onDown);
        document.addEventListener('keydown', onKey);
        return () => {
            document.removeEventListener('mousedown', onDown);
            document.removeEventListener('keydown', onKey);
        };
    }, [open]);

    // Only sub-agent levels make this useful; with just L0 there's nothing to browse.
    if (levels.length <= 1) {
        return null;
    }

    const activeLevel = levels.find((l) => l.depth === activeDepth) ?? levels[0];
    const selectedName = selectedAgentId
        ? levels.flatMap((l) => l.agents).find((a) => a.id === selectedAgentId)?.name
        : null;

    const toggle = () => {
        setOpen((o) => !o);
        setActiveDepth(levels.length > 1 ? 1 : 0);
    };
    const choose = (agentId: string | null) => {
        onSelectAgent(agentId);
        setOpen(false);
    };

    return (
        <div ref={wrapRef} className="relative inline-flex" data-testid="agent-cascade">
            <button
                type="button"
                data-testid="agent-cascade-trigger"
                aria-haspopup="menu"
                aria-expanded={open}
                onClick={toggle}
                title="Browse sub-agents by level"
                className={cn(
                    'inline-flex items-center gap-1 rounded-md border px-1.5 py-1 text-xs font-medium transition-colors mr-1',
                    'border-[#e0e0e0] dark:border-[#3c3c3c] bg-[#f3f3f3] dark:bg-[#2a2a2b]',
                    selectedAgentId
                        ? 'text-[#1e1e1e] dark:text-[#cccccc]'
                        : 'text-[#6b6b6b] dark:text-[#9d9d9d] hover:text-[#1e1e1e] dark:hover:text-[#cccccc]',
                )}
            >
                <AcIcons.Spawn size={13} />
                {selectedName && <span className="max-w-[120px] truncate">{selectedName}</span>}
                <Chevron open={open} />
            </button>
            {open && (
                <div
                    role="menu"
                    data-testid="agent-cascade-menu"
                    className="absolute right-0 top-[calc(100%+6px)] z-30 flex min-w-[330px] overflow-hidden rounded-lg border border-[#e0e0e0] bg-white shadow-lg dark:border-[#3c3c3c] dark:bg-[#252526]"
                >
                    <div className="flex w-[124px] shrink-0 flex-col border-r border-[#ededed] py-1 dark:border-[#333]">
                        {levels.map((lvl) => (
                            <button
                                key={lvl.depth}
                                type="button"
                                role="menuitem"
                                data-testid={`agent-cascade-level-${lvl.depth}`}
                                onMouseEnter={() => setActiveDepth(lvl.depth)}
                                onFocus={() => setActiveDepth(lvl.depth)}
                                onClick={() => setActiveDepth(lvl.depth)}
                                className={cn(
                                    'flex items-center justify-between gap-2 px-3 py-1.5 text-left text-xs',
                                    lvl.depth === activeDepth
                                        ? 'bg-[#f0f0f0] text-[#1e1e1e] dark:bg-[#2d2d2d] dark:text-[#cccccc]'
                                        : 'text-[#6b6b6b] hover:bg-[#f5f5f5] dark:text-[#9d9d9d] dark:hover:bg-[#2a2a2a]',
                                )}
                            >
                                <span className="font-medium">{lvl.label}</span>
                                <span className="text-[#9d9d9d]">{lvl.agents.length}</span>
                            </button>
                        ))}
                    </div>
                    <div className="flex max-h-[300px] min-w-[206px] flex-1 flex-col overflow-y-auto py-1">
                        {activeLevel.agents.map((a) => {
                            const Icon = a.isRoot ? AcIcons.Orchestr : roleIcon(a.role);
                            const isSel = a.isRoot ? selectedAgentId === null : selectedAgentId === a.id;
                            return (
                                <button
                                    key={a.id}
                                    type="button"
                                    role="menuitemradio"
                                    aria-checked={isSel}
                                    data-testid={`agent-cascade-agent-${a.id}`}
                                    onClick={() => choose(a.isRoot ? null : a.id)}
                                    className={cn(
                                        'flex items-center gap-2 px-3 py-1.5 text-left text-xs',
                                        isSel
                                            ? 'bg-[#eef3fb] text-[#1e1e1e] dark:bg-[#2a3344] dark:text-[#cccccc]'
                                            : 'text-[#444] hover:bg-[#f5f5f5] dark:text-[#bbb] dark:hover:bg-[#2a2a2a]',
                                    )}
                                >
                                    <span className="shrink-0 text-[#6b6b6b] dark:text-[#9d9d9d]"><Icon size={14} /></span>
                                    <span className="flex min-w-0 flex-col">
                                        <span className="truncate font-medium">
                                            {a.isRoot ? 'Orchestrator (back to thread)' : a.name}
                                        </span>
                                        <span className="truncate text-[10px] text-[#9d9d9d]">
                                            {a.isRoot ? 'orchestrator' : a.role}
                                        </span>
                                    </span>
                                    <span className={cn('ml-auto h-1.5 w-1.5 shrink-0 rounded-full', statusDot(a.status))} />
                                </button>
                            );
                        })}
                    </div>
                </div>
            )}
        </div>
    );
}
