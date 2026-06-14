import { describe, it, expect } from 'vitest';
import {
    flattenAgentLevels,
    findAgentNode,
    pathToAgent,
} from '../../../../src/server/spa/client/react/features/chat/agent-canvas/agentLevels';
import type { AgentRunNode } from '../../../../src/server/spa/client/react/features/chat/agent-canvas/types';

function node(id: string, children: AgentRunNode[] = [], startedAt?: number): AgentRunNode {
    return { id, name: id, role: 'agent', status: 'done', children, startedAt };
}

describe('flattenAgentLevels', () => {
    it('returns a single L0 level for a lone orchestrator root', () => {
        const root = { ...node('root'), isRoot: true, role: 'orchestrator' };
        const levels = flattenAgentLevels(root);
        expect(levels).toHaveLength(1);
        expect(levels[0]).toMatchObject({ depth: 0, label: 'L0 · orchestrator' });
        expect(levels[0].agents.map((a) => a.id)).toEqual(['root']);
    });

    it('groups nodes into contiguous levels L0…Ln', () => {
        const root = node('root', [
            node('l1', [
                node('l2', [node('l3')]),
            ]),
        ]);
        const levels = flattenAgentLevels(root);
        expect(levels.map((l) => l.depth)).toEqual([0, 1, 2, 3]);
        expect(levels.map((l) => l.label)).toEqual(['L0 · orchestrator', 'L1', 'L2', 'L3']);
        expect(levels[1].agents.map((a) => a.id)).toEqual(['l1']);
        expect(levels[3].agents.map((a) => a.id)).toEqual(['l3']);
    });

    it('places every node at the same depth in one level (siblings + cousins)', () => {
        const root = node('root', [
            node('a', [node('a1')]),
            node('b', [node('b1')]),
        ]);
        const levels = flattenAgentLevels(root);
        expect(levels[1].agents.map((a) => a.id).sort()).toEqual(['a', 'b']);
        expect(levels[2].agents.map((a) => a.id).sort()).toEqual(['a1', 'b1']);
    });

    it('orders each level by start time (unknown last)', () => {
        const root = node('root', [
            node('late', [], 200),
            node('early', [], 100),
            node('unknown'),
        ]);
        expect(flattenAgentLevels(root)[1].agents.map((a) => a.id)).toEqual(['early', 'late', 'unknown']);
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
    it('returns the ancestor chain root→…→node', () => {
        const root = node('root', [node('l1', [node('l2', [node('l3')])])]);
        expect(pathToAgent(root, 'l3').map((n) => n.id)).toEqual(['root', 'l1', 'l2', 'l3']);
        expect(pathToAgent(root, 'root').map((n) => n.id)).toEqual(['root']);
    });

    it('returns [] when the node is not present', () => {
        expect(pathToAgent(node('root'), 'missing')).toEqual([]);
    });
});
