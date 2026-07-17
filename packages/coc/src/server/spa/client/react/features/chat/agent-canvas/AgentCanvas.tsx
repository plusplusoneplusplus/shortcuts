// AgentCanvas — a pannable / zoomable spatial map of a chat's recursive
// sub-agent runs. The orchestrator root branches left→right into its
// sub-agents, recursively. Driven by live run status; clicking a node routes
// to the shared detail/thread destination.
//
// Ported from the coc-chat design (agent-canvas.jsx), with pan/zoom delegated
// to the repo's shared useZoomPan hook and the prototype's clock scrubber
// dropped (the real app is live-streaming, not replayable).

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useZoomPan } from '../../../hooks/ui/useZoomPan';
import { buildLayout, edgePath, spineVars, COLW, NODEW, PAD, type PositionedNode } from './layout';
import type { AgentRunNode } from './types';
import { AcIcons, roleIcon } from './icons';
import { formatRunDuration } from './format';
import './agent-canvas.css';

export interface AgentCanvasProps {
    /** The orchestrator root whose subtree is the agent run tree. */
    root: AgentRunNode;
    /** Open a run in the shared read-only sub-agent detail view. */
    onOpenAgentDetail?: (node: AgentRunNode) => void;
}

// Preset zoom levels offered by the % menu (within useZoomPan's 25%–220% range).
const ZOOM_PRESETS = [25, 50, 75, 100, 150, 200];


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
            return node.startedAt !== undefined ? formatRunDuration((now || node.startedAt) - node.startedAt) : 'running';
        case 'done':
            return node.startedAt !== undefined && node.completedAt !== undefined ? formatRunDuration(node.completedAt - node.startedAt) : 'done';
        case 'failed':
            return 'failed';
        case 'queued':
            return 'queued';
        default:
            return '';
    }
}

function CanvasNode({ entry, onSelect, now }: {
    entry: PositionedNode;
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
            className={'cnode' + (isRoot ? ' root' : '')}
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

export function AgentCanvas({ root, onOpenAgentDetail }: AgentCanvasProps) {
    const layout = useMemo(() => buildLayout(root), [root]);

    const { containerRef, state, zoomIn, zoomOut, fitToView, centerContent, zoomTo, zoomLabel } = useZoomPan({
        contentWidth: layout.worldW,
        contentHeight: layout.worldH,
        minZoom: 0.25,
        maxZoom: 2.2,
    });

    const [zoomMenuOpen, setZoomMenuOpen] = useState(false);
    useEffect(() => {
        if (!zoomMenuOpen) {
            return;
        }
        const close = (e: MouseEvent) => {
            if (!(e.target as HTMLElement).closest('.cz-wrap')) {
                setZoomMenuOpen(false);
            }
        };
        document.addEventListener('mousedown', close);
        return () => document.removeEventListener('mousedown', close);
    }, [zoomMenuOpen]);
    const currentPct = Math.round(state.scale * 100);

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
                {layout.groups.map((g, i) => (
                    typeof g.turn === 'number' && (
                        <div
                            key={`turn-divider-${i}`}
                            className={'turn-divider' + (g.hasLine ? '' : ' no-line')}
                            data-testid="agent-canvas-turn-divider"
                            data-turn={g.turn}
                            data-has-line={g.hasLine}
                            style={{
                                left: COLW + PAD,
                                top: g.y + PAD,
                                width: Math.max(NODEW, layout.worldW - COLW - PAD * 2),
                            }}
                        >
                            <span className="turn-divider-label">turn <strong>{g.turn}</strong></span>
                            {g.hasLine && <span className="turn-divider-rule" />}
                        </div>
                    )
                ))}
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
                        onSelect={onOpenAgentDetail}
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
                <span className="cz-wrap">
                    <button
                        type="button"
                        className="cz"
                        aria-haspopup="menu"
                        aria-expanded={zoomMenuOpen}
                        onClick={() => setZoomMenuOpen((o) => !o)}
                        title="Set zoom level"
                        data-testid="agent-canvas-zoom-label"
                    >
                        {zoomLabel}
                    </button>
                    {zoomMenuOpen && (
                        <div className="canvas-zoom-menu" role="menu" data-testid="agent-canvas-zoom-menu">
                            {ZOOM_PRESETS.map((p) => (
                                <button
                                    key={p}
                                    type="button"
                                    role="menuitemradio"
                                    aria-checked={currentPct === p}
                                    className={currentPct === p ? 'on' : ''}
                                    onClick={() => { interactedRef.current = true; zoomTo(p / 100); setZoomMenuOpen(false); }}
                                >
                                    {p}%
                                </button>
                            ))}
                            <span className="czm-sep" />
                            <button
                                type="button"
                                role="menuitem"
                                onClick={() => { interactedRef.current = true; fitToView(); setZoomMenuOpen(false); }}
                            >
                                Fit to screen
                            </button>
                        </div>
                    )}
                </span>
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
