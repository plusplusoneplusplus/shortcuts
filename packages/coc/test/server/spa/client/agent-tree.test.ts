import { describe, it, expect } from 'vitest';
import {
    defaultExpandedIds,
    findAgentNode,
    flattenVisibleAgentRows,
    pathToAgent,
} from '../../../../src/server/spa/client/react/features/chat/agent-canvas/agentTree';
import type { AgentRunNode } from '../../../../src/server/spa/client/react/features/chat/agent-canvas/types';

function node(id: string, children: AgentRunNode[] = []): AgentRunNode {
    return { id, name: id, role: 'agent', status: 'done', children };
}

describe('flattenVisibleAgentRows', () => {
    it('returns visible rows in tree order with depth and expansion metadata', () => {
        const root = node('root', [
            node('a', [node('a1')]),
            node('b', [node('b1')]),
        ]);
        const rows = flattenVisibleAgentRows(root, new Set(['root', 'a']));
        expect(rows.map((row) => [row.node.id, row.depth, row.hasChildren, row.expanded])).toEqual([
            ['root', 0, true, true],
            ['a', 1, true, true],
            ['a1', 2, false, false],
            ['b', 1, true, false],
        ]);
    });

    it('honors a collapsed root', () => {
        const root = node('root', [node('a')]);
        expect(flattenVisibleAgentRows(root, new Set()).map((row) => row.node.id)).toEqual(['root']);
    });
});

describe('defaultExpandedIds', () => {
    it('expands every parent in a small tree', () => {
        const root = node('root', [
            node('a', [node('a1')]),
            node('b', [node('b1')]),
        ]);
        expect([...defaultExpandedIds(root, null)].sort()).toEqual(['a', 'b', 'root']);
    });

    it('expands only the root and selected ancestor chain in a large tree', () => {
        const root = node('root', [
            node('p', [node('c', [node('target')])]),
            node('q', [node('q1')]),
            ...Array.from({ length: 9 }, (_, i) => node(`f${i}`)),
        ]);
        const expanded = defaultExpandedIds(root, 'target');
        expect(expanded.has('root')).toBe(true);
        expect(expanded.has('p')).toBe(true);
        expect(expanded.has('c')).toBe(true);
        expect(expanded.has('target')).toBe(true);
        expect(expanded.has('q')).toBe(false);
    });

    it('expands only the root in a large tree with no selected run', () => {
        const root = node('root', Array.from({ length: 12 }, (_, i) => node(`f${i}`)));
        expect([...defaultExpandedIds(root, null)]).toEqual(['root']);
    });
});

describe('findAgentNode', () => {
    it('finds a node at any depth and returns null for unknown ids', () => {
        const root = node('root', [node('l1', [node('l2')])]);
        expect(findAgentNode(root, 'l2')?.id).toBe('l2');
        expect(findAgentNode(root, 'root')?.id).toBe('root');
        expect(findAgentNode(root, 'nope')).toBeNull();
    });
});

describe('pathToAgent', () => {
    it('returns the ancestor chain root to node', () => {
        const root = node('root', [node('l1', [node('l2', [node('l3')])])]);
        expect(pathToAgent(root, 'l3').map((n) => n.id)).toEqual(['root', 'l1', 'l2', 'l3']);
        expect(pathToAgent(root, 'root').map((n) => n.id)).toEqual(['root']);
    });

    it('returns [] when the node is not present', () => {
        expect(pathToAgent(node('root'), 'missing')).toEqual([]);
    });
});
