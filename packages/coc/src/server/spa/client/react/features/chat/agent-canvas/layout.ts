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

export interface CanvasLayout {
    /** Positioned node keyed by node id. */
    pos: Record<string, PositionedNode>;
    /** Node ids in render order (root-first, depth-first). */
    order: string[];
    /** Parent→child connectors. */
    edges: CanvasEdge[];
    /** Intrinsic world size for fit-to-view. */
    worldW: number;
    worldH: number;
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

    function rec(node: AgentRunNode, depth: number, parentId: string | null): number {
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
        if (parentId !== null) {
            edges.push({ from: parentId, to: node.id, depth });
        }
        return y;
    }
    rec(root, 0, null);

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
