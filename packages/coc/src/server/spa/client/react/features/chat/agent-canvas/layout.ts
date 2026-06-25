// Pure layout math for the Agents canvas — a tidy left→right tree over the
// recursive agent-run tree. Ported verbatim from the design prototype
// (coc-chat/agent-canvas.jsx) so the spatial output matches pixel-for-pixel.

import type { AgentRunNode } from './types';

// Geometry (px). COLW = horizontal stride per depth, ROWH = vertical stride per
// leaf, NODE* = node box size, PAD = world padding around the tree.
export const COLW = 250;
export const ROWH = 78;
export const NODEW = 202;
export const NODEH = 56;
export const PAD = 60;
// Extra vertical space inserted between two adjacent turn groups, giving the
// dotted divider line room to sit clear of either group's nodes.
export const TURN_GAP = 64;
// How far above the first group's first node its (line-less) turn label rises.
export const TURN_LABEL_RISE = 30;

export interface PositionedNode {
    x: number;
    y: number;
    depth: number;
    node: AgentRunNode;
}

export interface CanvasEdge {
    from: string;
    to: string;
    depth: number;
}

/** A contiguous run of top-level (depth-1) nodes sharing one spawning turn. */
export interface TurnGroup {
    /** The 1-based human turn ordinal, or undefined when the turn is unknown. */
    turn: number | undefined;
    runs: AgentRunNode[];
}

/**
 * A turn divider placed in world coordinates (pre-PAD, like node positions).
 * `y` is the vertical centerline of the label/rule row; `hasLine` is false for
 * the first (topmost) group, which shows its label but no dividing rule above it.
 */
export interface TurnGroupMarker {
    turn: number | undefined;
    y: number;
    hasLine: boolean;
}

export interface CanvasLayout {
    /** Positioned node keyed by node id. */
    pos: Record<string, PositionedNode>;
    /** Node ids in render order (root-first, depth-first). */
    order: string[];
    /** Parent→child connectors. */
    edges: CanvasEdge[];
    /** Per-turn-group divider markers (label + optional dotted rule). */
    groups: TurnGroupMarker[];
    /** Intrinsic world size for fit-to-view. */
    worldW: number;
    worldH: number;
}

/**
 * Partition top-level runs into contiguous groups by spawning turn. Distinct
 * turns are ordered ascending (unknown turns sort last); within each group the
 * runs keep their incoming (startedAt) order. Grouping by turn value — rather
 * than relying on startedAt contiguity — guarantees each turn forms exactly one
 * contiguous block even if start times happen to interleave across turns.
 */
export function groupRunsByTurn(runs: AgentRunNode[]): TurnGroup[] {
    const byTurn = new Map<number | undefined, AgentRunNode[]>();
    const seen: (number | undefined)[] = [];
    for (const run of runs) {
        if (!byTurn.has(run.turn)) {
            byTurn.set(run.turn, []);
            seen.push(run.turn);
        }
        byTurn.get(run.turn)!.push(run);
    }
    seen.sort((a, b) => {
        if (a === b) return 0;
        if (a === undefined) return 1;
        if (b === undefined) return -1;
        return a - b;
    });
    return seen.map((turn) => ({ turn, runs: byTurn.get(turn)! }));
}

/**
 * Tidy left→right layout over the run tree (including the synthetic root).
 * Each parent is vertically centered over its children; leaves stack one row
 * apart. x is driven purely by depth, so columns line up across branches.
 */
export function buildLayout(root: AgentRunNode): CanvasLayout {
    const pos: Record<string, PositionedNode> = {};
    const order: string[] = [];
    const edges: CanvasEdge[] = [];
    let cursorY = 0;

    // Lay out a subtree rooted at a non-root node (depth >= 1), post-order.
    function rec(node: AgentRunNode, depth: number, parentId: string): number {
        const x = depth * COLW;
        const kids = node.children || [];
        let y: number;
        if (kids.length) {
            const ys = kids.map((k) => rec(k, depth + 1, node.id));
            y = (ys[0] + ys[ys.length - 1]) / 2;
        } else {
            y = cursorY;
            cursorY += ROWH;
        }
        pos[node.id] = { x, y, depth, node };
        order.push(node.id);
        edges.push({ from: parentId, to: node.id, depth });
        return y;
    }

    // The orchestrator's direct children are partitioned into turn groups; an
    // extra gap + dotted divider separates adjacent groups, and every group
    // carries a `turn N` label. Deeper levels are laid out inside each subtree
    // (no turn boundaries below depth 1).
    const groups = groupRunsByTurn(root.children || []);
    const markers: TurnGroupMarker[] = [];
    const childYs: number[] = [];
    groups.forEach((group, gi) => {
        let dividerY: number;
        let hasLine: boolean;
        if (gi === 0) {
            // First group: label only, riding just above its first node row.
            dividerY = -TURN_LABEL_RISE;
            hasLine = false;
        } else {
            // Boundary divider sits in the middle of the inserted gap.
            dividerY = cursorY + TURN_GAP / 2;
            hasLine = true;
            cursorY += TURN_GAP;
        }
        for (const run of group.runs) {
            childYs.push(rec(run, 1, root.id));
        }
        markers.push({ turn: group.turn, y: dividerY, hasLine });
    });

    // Place the orchestrator root (depth 0), centered over its children.
    let rootY: number;
    if (childYs.length) {
        rootY = (childYs[0] + childYs[childYs.length - 1]) / 2;
    } else {
        rootY = cursorY;
        cursorY += ROWH;
    }
    pos[root.id] = { x: 0, y: rootY, depth: 0, node: root };
    order.push(root.id);

    let maxX = 0;
    let maxY = 0;
    for (const p of Object.values(pos)) {
        maxX = Math.max(maxX, p.x);
        maxY = Math.max(maxY, p.y);
    }
    return {
        pos,
        order,
        edges,
        groups: markers,
        worldW: maxX + NODEW + PAD * 2,
        worldH: maxY + NODEH + PAD * 2,
    };
}

/** Curved connector from a parent's right-center to a child's left-center. */
export function edgePath(a: PositionedNode, b: PositionedNode): string {
    const x1 = a.x + NODEW + PAD;
    const y1 = a.y + NODEH / 2 + PAD;
    const x2 = b.x + PAD;
    const y2 = b.y + NODEH / 2 + PAD;
    const dx = Math.max(40, (x2 - x1) * 0.5);
    return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
}

// Per-depth spine hue, cycling a ring — mirrors the thread's depth-spine colors
// so a node's depth reads the same in both views.
const DEPTH_HUES = [252, 292, 162, 28, 200];

// CSS custom-property bag spread into a node's inline style. Built via bracket
// assignment because `--`-prefixed keys aren't valid camelCase identifiers.
export type SpineVars = Record<string, string>;

export function spineVars(depth: number): SpineVars {
    const h = DEPTH_HUES[depth % DEPTH_HUES.length];
    const vars: SpineVars = {};
    vars['--spine'] = `oklch(0.55 0.16 ${h})`;
    vars['--spine-soft'] = `oklch(0.95 0.04 ${h})`;
    return vars;
}
