import { describe, it, expect } from 'vitest';
import {
    buildLayout,
    edgePath,
    spineVars,
    groupRunsByTurn,
    COLW,
    ROWH,
    NODEW,
    NODEH,
    PAD,
    TURN_GAP,
    TURN_LABEL_RISE,
} from '../../../../src/server/spa/client/react/features/chat/agent-canvas/layout';
import type { AgentRunNode } from '../../../../src/server/spa/client/react/features/chat/agent-canvas/types';

function node(id: string, children: AgentRunNode[] = []): AgentRunNode {
    return { id, name: id, role: 'agent', status: 'done', children };
}

function turnNode(id: string, turn: number, children: AgentRunNode[] = []): AgentRunNode {
    return { ...node(id, children), turn };
}

describe('buildLayout', () => {
    it('lays out a lone root at the origin with padded world size', () => {
        const layout = buildLayout(node('root'));
        expect(layout.order).toEqual(['root']);
        expect(layout.edges).toEqual([]);
        expect(layout.pos.root).toMatchObject({ x: 0, y: 0, depth: 0 });
        expect(layout.worldW).toBe(NODEW + PAD * 2);
        expect(layout.worldH).toBe(NODEH + PAD * 2);
    });

    it('stacks leaf children one row apart and centers the parent over them', () => {
        const root = node('root', [node('a'), node('b')]);
        const layout = buildLayout(root);

        // children sit at depth 1 (x = COLW), stacked ROWH apart
        expect(layout.pos.a).toMatchObject({ x: COLW, y: 0, depth: 1 });
        expect(layout.pos.b).toMatchObject({ x: COLW, y: ROWH, depth: 1 });
        // parent is vertically centered over its children
        expect(layout.pos.root).toMatchObject({ x: 0, y: ROWH / 2, depth: 0 });

        // post-order: children before parent
        expect(layout.order).toEqual(['a', 'b', 'root']);
        expect(layout.edges).toEqual([
            { from: 'root', to: 'a', depth: 1 },
            { from: 'root', to: 'b', depth: 1 },
        ]);
        expect(layout.worldW).toBe(COLW + NODEW + PAD * 2);
        expect(layout.worldH).toBe(ROWH + NODEH + PAD * 2);
    });

    it('handles arbitrary nesting depth', () => {
        const root = node('root', [node('a', [node('a1'), node('a2')])]);
        const layout = buildLayout(root);

        expect(layout.pos.a1).toMatchObject({ x: COLW * 2, y: 0, depth: 2 });
        expect(layout.pos.a2).toMatchObject({ x: COLW * 2, y: ROWH, depth: 2 });
        expect(layout.pos.a).toMatchObject({ x: COLW, y: ROWH / 2, depth: 1 });
        expect(layout.pos.root).toMatchObject({ x: 0, y: ROWH / 2, depth: 0 });

        expect(layout.order).toEqual(['a1', 'a2', 'a', 'root']);
        expect(layout.edges).toContainEqual({ from: 'a', to: 'a1', depth: 2 });
        expect(layout.edges).toContainEqual({ from: 'a', to: 'a2', depth: 2 });
        expect(layout.edges).toContainEqual({ from: 'root', to: 'a', depth: 1 });
        expect(layout.worldW).toBe(COLW * 2 + NODEW + PAD * 2);
    });
});

describe('groupRunsByTurn (AC-01)', () => {
    it('partitions top-level runs into contiguous groups ordered by turn, preserving within-group order', () => {
        const groups = groupRunsByTurn([
            turnNode('a', 1),
            turnNode('b', 1),
            turnNode('c', 2),
        ]);
        expect(groups).toHaveLength(2);
        expect(groups[0].turn).toBe(1);
        expect(groups[0].runs.map((r) => r.id)).toEqual(['a', 'b']);
        expect(groups[1].turn).toBe(2);
        expect(groups[1].runs.map((r) => r.id)).toEqual(['c']);
    });

    it('yields exactly one group when every run shares a turn', () => {
        const groups = groupRunsByTurn([turnNode('a', 3), turnNode('b', 3)]);
        expect(groups).toHaveLength(1);
        expect(groups[0].turn).toBe(3);
        expect(groups[0].runs.map((r) => r.id)).toEqual(['a', 'b']);
    });

    it('keeps each turn contiguous and ascending even when input start order interleaves turns', () => {
        const groups = groupRunsByTurn([
            turnNode('a', 2),
            turnNode('b', 1),
            turnNode('c', 2),
        ]);
        expect(groups.map((g) => g.turn)).toEqual([1, 2]);
        expect(groups[0].runs.map((r) => r.id)).toEqual(['b']);
        // both turn-2 runs collapse into one contiguous group, original order kept
        expect(groups[1].runs.map((r) => r.id)).toEqual(['a', 'c']);
    });

    it('sorts unknown-turn runs into a trailing group', () => {
        const groups = groupRunsByTurn([node('x'), turnNode('a', 1)]);
        expect(groups.map((g) => g.turn)).toEqual([1, undefined]);
    });
});

describe('buildLayout turn dividers (AC-02)', () => {
    it('emits one label marker with no line for a single-turn root', () => {
        const layout = buildLayout(node('root', [turnNode('a', 1), turnNode('b', 1)]));
        expect(layout.groups).toHaveLength(1);
        expect(layout.groups[0]).toMatchObject({ turn: 1, hasLine: false, y: -TURN_LABEL_RISE });
        // no extra gap is inserted for a lone group: rows stack one ROWH apart
        expect(layout.pos.a.y).toBe(0);
        expect(layout.pos.b.y).toBe(ROWH);
    });

    it('inserts a gap and a lined divider between two turn groups', () => {
        const layout = buildLayout(node('root', [turnNode('a', 1), turnNode('b', 2)]));
        expect(layout.groups).toHaveLength(2);
        expect(layout.groups[0]).toMatchObject({ turn: 1, hasLine: false });
        expect(layout.groups[1]).toMatchObject({ turn: 2, hasLine: true });
        // the second group's leaf is pushed down by the inserted gap
        expect(layout.pos.b.y).toBe(ROWH + TURN_GAP);
        // the boundary divider sits in the middle of that gap
        expect(layout.groups[1].y).toBe(ROWH + TURN_GAP / 2);
        // root stays centered over its (now further-apart) children
        expect(layout.pos.root.y).toBe((ROWH + TURN_GAP) / 2);
    });

    it('has no group markers for a lone root with no sub-agents', () => {
        const layout = buildLayout(node('root'));
        expect(layout.groups).toEqual([]);
    });
});

describe('edgePath', () => {
    it('draws a cubic bezier from parent right-center to child left-center', () => {
        const a = { x: 0, y: ROWH / 2, depth: 0, node: node('root') };
        const b = { x: COLW, y: 0, depth: 1, node: node('a') };
        // x1 = 0+202+60=262, y1 = 39+28+60=127, x2 = 250+60=310, y2 = 0+28+60=88, dx=max(40,24)=40
        expect(edgePath(a, b)).toBe('M 262 127 C 302 127, 270 88, 310 88');
    });

    it('uses a minimum horizontal control offset of 40', () => {
        const a = { x: 0, y: 0, depth: 0, node: node('root') };
        const b = { x: 0, y: 0, depth: 1, node: node('a') };
        // dx clamps to 40 even when columns overlap: x1=262, x2=60 → controls 302 and 20
        expect(edgePath(a, b)).toBe('M 262 88 C 302 88, 20 88, 60 88');
    });
});

describe('spineVars', () => {
    it('returns oklch spine colors keyed off depth', () => {
        expect(spineVars(0)).toEqual({
            '--spine': 'oklch(0.55 0.16 252)',
            '--spine-soft': 'oklch(0.95 0.04 252)',
        });
        expect(spineVars(1)['--spine']).toBe('oklch(0.55 0.16 292)');
    });

    it('cycles the hue ring (5 hues) for deep nesting', () => {
        expect(spineVars(5)).toEqual(spineVars(0));
        expect(spineVars(6)).toEqual(spineVars(1));
    });
});
