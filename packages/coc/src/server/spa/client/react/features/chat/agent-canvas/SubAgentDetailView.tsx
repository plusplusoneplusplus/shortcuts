// Read-only, in-place view of one sub-agent's conversation. A breadcrumb
// (orchestrator → … → this agent) sits above the very same ConversationArea the
// main thread uses, fed synthetic turns from buildSubAgentTurns — so tool calls
// render identically. There is no follow-up input: this view is read-only.

import { useRef } from 'react';
import { cn } from '../../../ui/cn';
import { ConversationArea } from '../ConversationArea';
import type { ChatProvider } from '../ProviderBadge';
import type { ClientConversationTurn } from '../../../types/dashboard';
import { AcIcons, roleIcon } from './icons';
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

export function SubAgentDetailView({
    node, path, turns, onNavigate, task, taskId, wsId, processId, processType, provider, variant,
}: SubAgentDetailViewProps) {
    const scrollRef = useRef<HTMLDivElement>(null);
    // Shape the task status so ConversationArea's running-tail reflects THIS
    // sub-agent's state, not the orchestrator's (which may still be running).
    const subTask = { ...(task || {}), status: node.status === 'running' ? 'running' : 'completed' };

    return (
        <div className="flex flex-1 min-h-0 flex-col overflow-hidden min-w-0" data-testid="sub-agent-detail">
            <div className="flex flex-wrap items-center gap-1 border-b border-[#e0e0e0] px-3 py-2 text-xs dark:border-[#3c3c3c]">
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
