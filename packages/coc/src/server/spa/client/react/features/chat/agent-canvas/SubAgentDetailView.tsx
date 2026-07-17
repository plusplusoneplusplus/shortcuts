// Read-only, in-place view of one sub-agent's conversation. A breadcrumb
// (orchestrator → … → this agent) sits above the very same ConversationArea the
// main thread uses, fed synthetic turns from buildSubAgentTurns — so tool calls
// render identically. There is no follow-up input: this view is read-only.

import { useEffect, useRef, useState } from 'react';
import { cn } from '../../../ui/cn';
import { ConversationArea } from '../ConversationArea';
import type { ChatProvider } from '../ProviderBadge';
import type { ClientConversationTurn } from '../../../types/dashboard';
import { AcIcons, roleIcon } from './icons';
import { formatRunDuration } from './format';
import type { AgentRunNode, AgentRunStatus } from './types';

interface SubAgentDetailViewProps {
    /** The selected sub-agent. */
    node: AgentRunNode;
    /** Ancestor chain `[root, …, node]` for the breadcrumb. */
    path: AgentRunNode[];
    /** Synthetic turns from buildSubAgentTurns(turns, node.id). */
    turns: ClientConversationTurn[];
    /** Click an ancestor crumb: a sub-agent id, or null for the orchestrator root. */
    onNavigate: (agentId: string | null) => void;
    task: any;
    taskId: string;
    wsId?: string;
    processId?: string;
    processType?: string;
    provider?: ChatProvider;
    variant: 'inline' | 'floating';
}

function statusDot(status: AgentRunStatus): string {
    switch (status) {
        case 'running': return 'bg-blue-500';
        case 'failed': return 'bg-red-500';
        case 'queued': return 'bg-gray-400';
        default: return 'bg-green-500';
    }
}

const STATUS_LABEL: Record<AgentRunStatus, string> = {
    running: 'Running',
    done: 'Done',
    failed: 'Failed',
    queued: 'Queued',
};

function durationText(node: AgentRunNode, now: number): string | null {
    if (node.status === 'running' && node.startedAt !== undefined) {
        return formatRunDuration((now || node.startedAt) - node.startedAt);
    }
    if (node.startedAt !== undefined && node.completedAt !== undefined) {
        return formatRunDuration(node.completedAt - node.startedAt);
    }
    return null;
}

export function SubAgentDetailView({
    node, path, turns, onNavigate, task, taskId, wsId, processId, processType, provider, variant,
}: SubAgentDetailViewProps) {
    const scrollRef = useRef<HTMLDivElement>(null);
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        if (node.status !== 'running') {
            return;
        }
        setNow(Date.now());
        const id = window.setInterval(() => setNow(Date.now()), 1000);
        return () => window.clearInterval(id);
    }, [node.status]);

    // Shape the task status so ConversationArea's running-tail reflects THIS
    // sub-agent's state, not the orchestrator's (which may still be running).
    const subTask = { ...(task || {}), status: node.status === 'running' ? 'running' : 'completed' };
    const dur = durationText(node, now);
    const spawned = (node.children || []).length;

    return (
        <div className="flex flex-1 min-h-0 flex-col overflow-hidden min-w-0" data-testid="sub-agent-detail">
            <div className="border-b border-[#e0e0e0] px-3 py-2 text-xs dark:border-[#3c3c3c]">
                <div className="flex flex-wrap items-center gap-1">
                    {path.map((n, i) => {
                        const last = i === path.length - 1;
                        const Icon = n.isRoot ? AcIcons.Orchestr : roleIcon(n.role);
                        return (
                            <span key={n.id} className="inline-flex items-center gap-1">
                                {i > 0 && <span className="text-[#b0b0b0] dark:text-[#666]">/</span>}
                                <button
                                    type="button"
                                    data-testid={`sub-agent-crumb-${n.id}`}
                                    disabled={last}
                                    onClick={() => onNavigate(n.isRoot ? null : n.id)}
                                    className={cn(
                                        'inline-flex items-center gap-1 rounded px-1.5 py-0.5',
                                        last
                                            ? 'cursor-default font-medium text-[#1e1e1e] dark:text-[#cccccc]'
                                            : 'text-[#6b6b6b] hover:bg-[#f0f0f0] hover:text-[#1e1e1e] dark:text-[#9d9d9d] dark:hover:bg-[#2d2d2d] dark:hover:text-[#cccccc]',
                                    )}
                                >
                                    <Icon size={13} />
                                    <span className="max-w-[220px] truncate">{n.isRoot ? 'Orchestrator' : n.name}</span>
                                </button>
                            </span>
                        );
                    })}
                    <span className="ml-2 inline-flex items-center gap-1 text-[10px] text-[#9d9d9d]">
                        <span className={cn('h-1.5 w-1.5 rounded-full', statusDot(node.status))} />
                        read-only
                    </span>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-[#6b6b6b] dark:text-[#9d9d9d]">
                    <span
                        data-testid="sub-agent-status"
                        data-status={node.status}
                        className="inline-flex items-center gap-1 rounded-full bg-[#f3f3f3] px-2 py-0.5 font-medium text-[#444] dark:bg-[#2a2a2b] dark:text-[#cccccc]"
                    >
                        <span className={cn('h-1.5 w-1.5 rounded-full', statusDot(node.status))} />
                        {STATUS_LABEL[node.status]}
                    </span>
                    {dur && (
                        <span data-testid="sub-agent-duration" className="inline-flex items-center gap-1 font-mono">
                            <AcIcons.Clock size={12} />{dur}
                        </span>
                    )}
                    {node.model && <span data-testid="sub-agent-model" className="max-w-[220px] truncate font-mono">Model {node.model}</span>}
                    {node.mode && <span data-testid="sub-agent-mode" className="font-mono">Mode {node.mode}</span>}
                    {spawned > 0 && (
                        <span data-testid="sub-agent-spawned" className="inline-flex items-center gap-1 font-mono">
                            <AcIcons.Spawn size={12} />{spawned} spawned
                        </span>
                    )}
                </div>
            </div>
            <ConversationArea
                loading={false}
                error={null}
                turns={turns}
                pendingQueue={[]}
                isScrolledUp={false}
                scrollRef={scrollRef}
                onScrollToBottom={() => { /* read-only */ }}
                isPending={false}
                task={subTask}
                fullTask={null}
                onCancel={() => { /* read-only */ }}
                onMoveToTop={() => { /* read-only */ }}
                variant={variant}
                taskId={taskId}
                wsId={wsId}
                processId={processId}
                processType={processType}
                provider={provider}
            />
        </div>
    );
}
