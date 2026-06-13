// AgentCanvas — a pannable / zoomable spatial map of a chat's recursive
// sub-agent runs. The orchestrator root branches left→right into its
// sub-agents, recursively. Driven by live run status; clicking a node calls
// onSelect (the host scrolls the thread to the matching turn).
//
// Ported from the coc-chat design (agent-canvas.jsx), with pan/zoom delegated
// to the repo's shared useZoomPan hook and the prototype's clock scrubber
// dropped (the real app is live-streaming, not replayable).

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useZoomPan } from '../../../hooks/ui/useZoomPan';
import { buildLayout, edgePath, spineVars, PAD, type PositionedNode } from './layout';
import type { AgentRunNode } from './types';
import { AcIcons, roleIcon } from './icons';
import './agent-canvas.css';

export interface AgentCanvasProps {
    /** The orchestrator root whose subtree is the agent run tree. */
    root: AgentRunNode;
    /** Currently selected run id (highlighted), or null. */
    selectedId?: string | null;
    /** Called when a node is clicked. */
    onSelect?: (node: AgentRunNode) => void;
}

function fmtDuration(ms: number): string {
    const s = Math.max(0, Math.round(ms / 1000));
    const m = Math.floor(s / 60);
    return `${m}:${String(s % 60).padStart(2, '0')}`;
}

function anyRunning(node: AgentRunNode): boolean {
    if (node.status === 'running') {
        return true;
    }
    return (node.children || []).some(anyRunning);
}

/** Short status/elapsed label shown under a node's name. */
function nodeTimeText(node: AgentRunNode, now: number): string {
    if (node.isRoot) {
        if (node.status === 'running') {
            return 'live';
        }
        return node.status === 'failed' ? 'failed' : 'done';
    }
    switch (node.status) {
        case 'running':
            return node.startedAt ? fmtDuration((now || node.startedAt) - node.startedAt) : 'running';
        case 'done':
            return node.startedAt && node.completedAt ? fmtDuration(node.completedAt - node.startedAt) : 'done';
        case 'failed':
            return 'failed';
        case 'queued':
            return 'queued';
        default:
            return '';
    }
}

function CanvasNode({ entry, selected, onSelect, now }: {
    entry: PositionedNode;
    selected: boolean;
    onSelect?: (node: AgentRunNode) => void;
    now: number;
}) {
    const { node, depth } = entry;
    const isRoot = !!node.isRoot;
    const status = node.status;
    const RoleIcon = isRoot ? AcIcons.Orchestr : roleIcon(node.role);
    const kids = node.children || [];
    const pct = status === 'queued' ? 0 : 100;
    const styleVars = spineVars(depth) as CSSProperties;

    return (
        <button
            type="button"
            className={'cnode' + (selected ? ' sel' : '') + (isRoot ? ' root' : '')}
            data-status={status}
            data-testid={`agent-canvas-node-${node.id}`}
            style={{ left: entry.x + PAD, top: entry.y + PAD, ...styleVars }}
            onClick={(e) => { e.stopPropagation(); onSelect?.(node); }}
        >
            <span className="cn-badge"><RoleIcon size={15} /></span>
            <span className="cn-body">
                <span className="cn-name">{node.name}</span>
                <span className="cn-sub">
                    <span className="cn-role">{isRoot ? 'orchestrator' : node.role}</span>
                    <span className="cn-dot">·</span>
                    <span className="cn-t">{nodeTimeText(node, now)}</span>
                </span>
            </span>
            {kids.length > 0 && (
                <span className="cn-spawn" title={`${kids.length} spawned`}>
                    <AcIcons.Spawn size={11} />{kids.length}
                </span>
            )}
            <span className="cn-state" data-status={status} />
            <span className="cn-bar"><i style={{ width: `${pct}%` }} /></span>
        </button>
    );
}

export function AgentCanvas({ root, selectedId, onSelect }: AgentCanvasProps) {
    const layout = useMemo(() => buildLayout(root), [root]);

    const { containerRef, state, zoomIn, zoomOut, fitToView, centerContent, zoomLabel } = useZoomPan({
        contentWidth: layout.worldW,
        contentHeight: layout.worldH,
        minZoom: 0.25,
        maxZoom: 2.2,
    });

    // Default view: 100% zoom, content centered in the viewport. Re-centers on
    // mount, tree growth, and container resize — until the user takes over
    // (wheel/drag/zoom or the Fit button).
    const interactedRef = useRef(false);

    useLayoutEffect(() => {
        if (!interactedRef.current) {
            centerContent(1);
        }
    }, [layout.worldW, layout.worldH, centerContent]);

    useEffect(() => {
        const el = containerRef.current;
        if (!el) {
            return;
        }
        const markInteracted = () => { interactedRef.current = true; };
        el.addEventListener('wheel', markInteracted, { passive: true });
        el.addEventListener('pointerdown', markInteracted);
        const ro = new ResizeObserver(() => {
            if (!interactedRef.current) {
                centerContent(1);
            }
        });
        ro.observe(el);
        return () => {
            el.removeEventListener('wheel', markInteracted);
            el.removeEventListener('pointerdown', markInteracted);
            ro.disconnect();
        };
    }, [containerRef, centerContent]);

    // Live clock so running nodes' elapsed time ticks; idle when nothing runs.
    const hasRunning = useMemo(() => anyRunning(root), [root]);
    const [now, setNow] = useState(0);
    useEffect(() => {
        if (!hasRunning) {
            return;
        }
        setNow(Date.now());
        const id = window.setInterval(() => setNow(Date.now()), 1000);
        return () => window.clearInterval(id);
    }, [hasRunning]);

    const worldTransform = `translate(${state.translateX}px, ${state.translateY}px) scale(${state.scale})`;

    return (
        <div
            className="agent-canvas"
            ref={containerRef}
            data-testid="agent-canvas"
            style={{ cursor: state.isDragging ? 'grabbing' : 'grab' }}
        >
            <div className="world" style={{ transform: worldTransform }}>
                <svg className="canvas-edges" width={layout.worldW} height={layout.worldH}>
                    {layout.edges.map((e) => {
                        const a = layout.pos[e.from];
                        const b = layout.pos[e.to];
                        const childStatus = b.node.status;
                        const active = childStatus === 'running';
                        const queued = childStatus === 'queued';
                        const spine = spineVars(e.depth)['--spine'];
                        return (
                            <path
                                key={e.to}
                                d={edgePath(a, b)}
                                fill="none"
                                stroke={queued ? 'var(--border-strong)' : spine}
                                strokeWidth={2}
                                strokeOpacity={queued ? 0.5 : 0.85}
                                strokeDasharray={active ? '6 5' : queued ? '3 4' : undefined}
                                className={active ? 'edge-active' : undefined}
                            />
                        );
                    })}
                </svg>
                {layout.order.map((id) => (
                    <CanvasNode
                        key={id}
                        entry={layout.pos[id]}
                        now={now}
                        selected={selectedId === id}
                        onSelect={onSelect}
                    />
                ))}
            </div>

            {root.children.length === 0 && (
                <div className="canvas-empty">
                    <span className="ce-title">No sub-agent runs</span>
                    <span>Agents this chat spawns will appear here as a tree.</span>
                </div>
            )}

            <div className="canvas-toolbar" data-no-drag>
                <button type="button" onClick={zoomOut} title="Zoom out"><AcIcons.Collapse size={14} /></button>
                <span className="cz">{zoomLabel}</span>
                <button type="button" onClick={zoomIn} title="Zoom in"><AcIcons.Expand size={14} /></button>
                <span className="cz-sep" />
                <button
                    type="button"
                    onClick={() => { interactedRef.current = true; fitToView(); }}
                    title="Fit to screen"
                >
                    <AcIcons.Replay size={14} />Fit
                </button>
            </div>

            <div className="canvas-legend" data-no-drag>
                <span className="cl-item"><span className="cl-dot" data-status="running" />running</span>
                <span className="cl-item"><span className="cl-dot" data-status="done" />done</span>
                <span className="cl-item"><span className="cl-dot" data-status="queued" />queued</span>
                <span className="cl-hint">drag to pan · scroll to zoom</span>
            </div>
        </div>
    );
}
