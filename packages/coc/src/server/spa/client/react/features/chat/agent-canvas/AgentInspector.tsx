// AgentInspector — a right-side detail panel for a selected run on the Agents
// canvas. Shows the run's role/status/timing, the task it was handed, its
// result/conclusion, and its spawned children (clickable to drill in).

import { AcIcons, roleIcon } from './icons';
import type { AgentRunNode, AgentRunStatus } from './types';

const STATUS_LABEL: Record<AgentRunStatus, string> = {
    running: 'Running',
    done: 'Done',
    failed: 'Failed',
    queued: 'Queued',
};

function fmtDuration(ms: number): string {
    const s = Math.max(0, Math.round(ms / 1000));
    const m = Math.floor(s / 60);
    return `${m}:${String(s % 60).padStart(2, '0')}`;
}

function durationText(node: AgentRunNode, now: number): string | null {
    if (node.status === 'running' && node.startedAt !== undefined) {
        return fmtDuration((now || node.startedAt) - node.startedAt);
    }
    if (node.startedAt !== undefined && node.completedAt !== undefined) {
        return fmtDuration(node.completedAt - node.startedAt);
    }
    return null;
}

function resultText(node: AgentRunNode): string {
    if (node.result) {
        return node.result;
    }
    if (node.status === 'running') {
        return 'Running…';
    }
    if (node.status === 'queued') {
        return 'Queued — waiting for a worker.';
    }
    return 'No result recorded.';
}

export interface AgentInspectorProps {
    node: AgentRunNode;
    /** Live clock (epoch ms) so a running node's elapsed time ticks. */
    now: number;
    onClose: () => void;
    /** Select a child run (drill in). */
    onSelectChild?: (node: AgentRunNode) => void;
    /** Jump to this run's turn in the linear thread. */
    onOpenInThread?: (node: AgentRunNode) => void;
}

export function AgentInspector({ node, now, onClose, onSelectChild, onOpenInThread }: AgentInspectorProps) {
    const isRoot = !!node.isRoot;
    const RoleIcon = isRoot ? AcIcons.Orchestr : roleIcon(node.role);
    const kids = node.children || [];
    const dur = durationText(node, now);
    const terminal = node.status === 'done' || node.status === 'failed';

    return (
        <aside className="agent-inspector" data-testid="agent-inspector" data-no-drag>
            <div className="ai-head">
                <span className="ai-badge"><RoleIcon size={16} /></span>
                <div className="ai-title">
                    <div className="ai-name" title={node.name}>{node.name}</div>
                    <div className="ai-role">{isRoot ? 'orchestrator' : node.role}</div>
                </div>
                <button type="button" className="ai-close" onClick={onClose} title="Close" aria-label="Close inspector">
                    <AcIcons.X size={14} />
                </button>
            </div>

            <div className="ai-meta">
                <span className="ai-pill" data-status={node.status}>
                    <span className="ai-dot" data-status={node.status} />{STATUS_LABEL[node.status]}
                </span>
                {dur && <span className="ai-stat"><AcIcons.Clock size={12} />{dur}</span>}
                {kids.length > 0 && <span className="ai-stat"><AcIcons.Spawn size={12} />{kids.length} spawned</span>}
            </div>

            {(node.model || node.mode || node.description) && (
                <dl className="ai-fields">
                    {node.model && (<><dt>Model</dt><dd>{node.model}</dd></>)}
                    {node.mode && (<><dt>Mode</dt><dd>{node.mode}</dd></>)}
                    {node.description && (<><dt>Summary</dt><dd>{node.description}</dd></>)}
                </dl>
            )}

            {node.prompt && (
                <section className="ai-section">
                    <h4>Task</h4>
                    <p className="ai-text">{node.prompt}</p>
                </section>
            )}

            {!isRoot && (
                <section className="ai-section">
                    <h4>{terminal ? 'Result' : 'Status'}</h4>
                    <p className="ai-text">{resultText(node)}</p>
                </section>
            )}

            {kids.length > 0 && (
                <section className="ai-section">
                    <h4>Sub-agents · {kids.length}</h4>
                    <ul className="ai-children">
                        {kids.map((k) => {
                            const KidIcon = roleIcon(k.role);
                            return (
                                <li key={k.id}>
                                    <button type="button" onClick={() => onSelectChild?.(k)} data-testid={`agent-inspector-child-${k.id}`}>
                                        <span className="ai-cbadge"><KidIcon size={12} /></span>
                                        <span className="ai-cname" title={k.name}>{k.name}</span>
                                        <span className="ai-cstate" data-status={k.status} />
                                    </button>
                                </li>
                            );
                        })}
                    </ul>
                </section>
            )}

            {onOpenInThread && !isRoot && (
                <button type="button" className="ai-open-thread" onClick={() => onOpenInThread(node)} data-testid="agent-inspector-open-thread">
                    <AcIcons.Thread size={13} />Open in thread
                </button>
            )}
        </aside>
    );
}
