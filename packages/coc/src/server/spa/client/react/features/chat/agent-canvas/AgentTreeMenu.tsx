// Header popover for navigating a chat's agent-run tree. It keeps the parent
// -> child structure visible with indentation and routes every agent selection
// into the shared sub-agent detail view.

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { cn } from '../../../ui/cn';
import { countRuns } from './buildAgentRunTree';
import { defaultExpandedIds, flattenVisibleAgentRows, findAgentNode, pathToAgent } from './agentTree';
import { formatRunDuration } from './format';
import { AcIcons, roleIcon } from './icons';
import type { AgentRunNode, AgentRunStatus } from './types';

export interface AgentTreeMenuProps {
    root: AgentRunNode;
    selectedAgentId: string | null;
    mapOpen: boolean;
    onSelectAgent: (agentId: string | null) => void;
    onOpenMap: () => void;
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

function Twisty({ open, visible }: { open: boolean; visible: boolean }) {
    if (!visible) {
        return <span className="h-4 w-4 shrink-0" aria-hidden="true" />;
    }
    return (
        <span
            className={cn(
                'inline-flex h-4 w-4 shrink-0 items-center justify-center text-[#8a8a8a] transition-transform dark:text-[#8f8f8f]',
                open && 'rotate-90',
            )}
            aria-hidden="true"
        >
            <svg width={10} height={10} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <path d="M6 4l4 4-4 4" />
            </svg>
        </span>
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

function statusLabel(status: AgentRunStatus): string {
    switch (status) {
        case 'running': return 'running';
        case 'failed': return 'failed';
        case 'queued': return 'queued';
        default: return 'done';
    }
}

function durationText(node: AgentRunNode): string {
    if (node.status === 'running' && node.startedAt !== undefined) {
        return formatRunDuration(Date.now() - node.startedAt);
    }
    if (node.startedAt !== undefined && node.completedAt !== undefined) {
        return formatRunDuration(node.completedAt - node.startedAt);
    }
    return statusLabel(node.status);
}

function countRunningSubAgents(node: AgentRunNode): number {
    const self = !node.isRoot && node.status === 'running' ? 1 : 0;
    return self + (node.children || []).reduce((sum, child) => sum + countRunningSubAgents(child), 0);
}

function anyRunning(node: AgentRunNode): boolean {
    return node.status === 'running' || (node.children || []).some(anyRunning);
}

export function AgentTreeMenu({ root, selectedAgentId, mapOpen, onSelectAgent, onOpenMap }: AgentTreeMenuProps) {
    const [open, setOpen] = useState(false);
    const rootRef = useRef(root);
    const [expanded, setExpanded] = useState<Set<string>>(() => defaultExpandedIds(root, selectedAgentId));
    const [activeIndex, setActiveIndex] = useState(0);
    const wrapRef = useRef<HTMLDivElement>(null);
    const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
    const pendingFocusIdRef = useRef<string | null>(null);

    useEffect(() => {
        rootRef.current = root;
    }, [root]);

    useEffect(() => {
        if (!selectedAgentId) {
            return;
        }
        pendingFocusIdRef.current = selectedAgentId;
        setExpanded((prev) => {
            const next = new Set(prev);
            for (const node of pathToAgent(rootRef.current, selectedAgentId)) {
                next.add(node.id);
            }
            return next;
        });
    }, [selectedAgentId]);

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

    const rows = useMemo(() => flattenVisibleAgentRows(root, expanded), [root, expanded]);
    const selectedNode = selectedAgentId ? findAgentNode(root, selectedAgentId) : null;
    const totalRuns = countRuns(root);
    const subAgentCount = Math.max(0, totalRuns - 1);
    const runningCount = countRunningSubAgents(root);
    const hasLiveRun = anyRunning(root);
    const countLabel = runningCount > 0 ? runningCount : subAgentCount;

    useEffect(() => {
        if (!open) {
            return;
        }
        const selectedIndex = rows.findIndex((row) => row.node.isRoot
            ? selectedAgentId === null && !mapOpen
            : row.node.id === selectedAgentId);
        setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0);
    }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        if (!open) {
            return;
        }
        const pendingId = pendingFocusIdRef.current;
        if (pendingId) {
            const nextIndex = rows.findIndex((row) => row.node.id === pendingId);
            if (nextIndex >= 0) {
                pendingFocusIdRef.current = null;
                setActiveIndex(nextIndex);
            }
            return;
        }
        if (activeIndex >= rows.length) {
            setActiveIndex(Math.max(0, rows.length - 1));
        }
    }, [activeIndex, open, rows]);

    useEffect(() => {
        if (!open) {
            return;
        }
        itemRefs.current[activeIndex]?.focus();
    }, [activeIndex, open, rows.length]);

    if (root.children.length === 0) {
        return null;
    }

    const toggleNode = (id: string) => {
        setExpanded((prev) => {
            const next = new Set(prev);
            if (next.has(id)) {
                next.delete(id);
            } else {
                next.add(id);
            }
            return next;
        });
    };

    const choose = (node: AgentRunNode) => {
        onSelectAgent(node.isRoot ? null : node.id);
        setOpen(false);
    };

    const handleRowKeyDown = (event: KeyboardEvent, index: number) => {
        const row = rows[index];
        if (!row) {
            return;
        }
        if (event.key === 'ArrowDown') {
            event.preventDefault();
            setActiveIndex((i) => Math.min(rows.length - 1, i + 1));
        } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            setActiveIndex((i) => Math.max(0, i - 1));
        } else if (event.key === 'ArrowRight' && row.hasChildren && !row.expanded) {
            event.preventDefault();
            toggleNode(row.node.id);
        } else if (event.key === 'ArrowLeft' && row.hasChildren && row.expanded) {
            event.preventDefault();
            toggleNode(row.node.id);
        } else if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            choose(row.node);
        }
    };

    const triggerLabel = selectedNode?.name ?? 'Agents';
    const footerText = `${subAgentCount} ${subAgentCount === 1 ? 'sub-agent' : 'sub-agents'} - nesting shown by indent`;

    return (
        <div ref={wrapRef} className="relative inline-flex" data-testid="agent-tree">
            <button
                type="button"
                data-testid="agent-tree-trigger"
                aria-haspopup="tree"
                aria-expanded={open}
                onClick={() => setOpen((o) => !o)}
                title="Browse sub-agents"
                className={cn(
                    'mr-1 inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium transition-colors',
                    'border-[#e0e0e0] bg-[#f3f3f3] text-[#444] hover:text-[#1e1e1e]',
                    'dark:border-[#3c3c3c] dark:bg-[#2a2a2b] dark:text-[#cccccc]',
                )}
            >
                <AcIcons.Tree size={13} />
                <span className="max-w-[140px] truncate">{triggerLabel}</span>
                <span
                    className={cn(
                        'inline-flex min-w-[1.25rem] items-center justify-center rounded-full px-1.5 py-px text-[10px] leading-4',
                        'bg-white text-[#6b6b6b] dark:bg-[#1e1e1e] dark:text-[#bdbdbd]',
                    )}
                    data-testid="agent-tree-count"
                >
                    {countLabel}
                </span>
                {hasLiveRun && <span className="h-1.5 w-1.5 rounded-full bg-blue-500 animate-pulse" data-testid="agent-tree-live-dot" />}
                <Chevron open={open} />
            </button>
            {open && (
                <div
                    data-testid="agent-tree-popover"
                    className="absolute right-0 top-[calc(100%+6px)] z-30 flex min-w-[360px] flex-col overflow-hidden rounded-lg border border-[#e0e0e0] bg-white shadow-lg dark:border-[#3c3c3c] dark:bg-[#252526]"
                >
                    <div role="tree" aria-label="Agent runs" className="max-h-[340px] overflow-y-auto py-1">
                        {rows.map((row, index) => {
                            const node = row.node;
                            const isRoot = !!node.isRoot;
                            const Icon = isRoot ? AcIcons.Thread : roleIcon(node.role);
                            const selected = isRoot ? selectedAgentId === null && !mapOpen : selectedAgentId === node.id;
                            return (
                                <button
                                    key={node.id}
                                    ref={(el) => { itemRefs.current[index] = el; }}
                                    type="button"
                                    role="treeitem"
                                    aria-level={row.depth + 1}
                                    aria-expanded={row.hasChildren ? row.expanded : undefined}
                                    aria-selected={selected}
                                    tabIndex={open && index === activeIndex ? 0 : -1}
                                    data-testid={`agent-tree-row-${node.id}`}
                                    onClick={() => choose(node)}
                                    onKeyDown={(event) => handleRowKeyDown(event, index)}
                                    className={cn(
                                        'flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs outline-none',
                                        selected
                                            ? 'bg-[#eef3fb] text-[#1e1e1e] dark:bg-[#2a3344] dark:text-[#cccccc]'
                                            : 'text-[#444] hover:bg-[#f5f5f5] focus:bg-[#f5f5f5] dark:text-[#bbb] dark:hover:bg-[#2a2a2a] dark:focus:bg-[#2a2a2a]',
                                    )}
                                    style={{ paddingLeft: 12 + row.depth * 18 }}
                                >
                                    <span
                                        data-testid={`agent-tree-toggle-${node.id}`}
                                        onClick={(event) => {
                                            if (!row.hasChildren) {
                                                return;
                                            }
                                            event.stopPropagation();
                                            toggleNode(node.id);
                                        }}
                                    >
                                        <Twisty open={row.expanded} visible={row.hasChildren} />
                                    </span>
                                    <span className="shrink-0 text-[#6b6b6b] dark:text-[#9d9d9d]"><Icon size={14} /></span>
                                    <span className="min-w-0 flex-1">
                                        <span className="block truncate font-medium">{isRoot ? 'Main thread' : node.name}</span>
                                        <span className="block truncate text-[10px] text-[#8a8a8a] dark:text-[#9d9d9d]">
                                            {isRoot ? 'orchestrator' : node.role}
                                        </span>
                                    </span>
                                    <span className="hidden max-w-[64px] shrink-0 truncate text-[10px] tabular-nums text-[#8a8a8a] dark:text-[#9d9d9d] sm:inline">
                                        {durationText(node)}
                                    </span>
                                    <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', statusDot(node.status))} />
                                </button>
                            );
                        })}
                    </div>
                    <div className="flex items-center justify-between gap-3 border-t border-[#ededed] px-3 py-2 text-[10.5px] text-[#8a8a8a] dark:border-[#333] dark:text-[#9d9d9d]">
                        <span>{footerText}</span>
                        {totalRuns > 6 && (
                            <button
                                type="button"
                                data-testid="agent-tree-open-map"
                                aria-pressed={mapOpen}
                                onClick={() => {
                                    onOpenMap();
                                    setOpen(false);
                                }}
                                className={cn(
                                    'inline-flex shrink-0 items-center gap-1 rounded border px-2 py-1 text-[10.5px] font-medium',
                                    mapOpen
                                        ? 'border-[#8bb7f0] bg-[#eef3fb] text-[#1e1e1e] dark:border-[#3f5f8f] dark:bg-[#2a3344] dark:text-[#cccccc]'
                                        : 'border-[#e0e0e0] text-[#555] hover:bg-[#f5f5f5] dark:border-[#3c3c3c] dark:text-[#cccccc] dark:hover:bg-[#2a2a2a]',
                                )}
                            >
                                <AcIcons.Expand size={11} />Open map
                            </button>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
