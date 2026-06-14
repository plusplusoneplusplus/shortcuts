import { describe, it, expect } from 'vitest';
import {
    buildLayout,
    edgePath,
    spineVars,
    COLW,
    ROWH,
    NODEW,
    NODEH,
    PAD,
} from '../../../../src/server/spa/client/react/features/chat/agent-canvas/layout';
import type { AgentRunNode } from '../../../../src/server/spa/client/react/features/chat/agent-canvas/types';

function node(id: string, children: AgentRunNode[] = []): AgentRunNode {
    return { id, name: id, role: 'agent', status: 'done', children };
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
