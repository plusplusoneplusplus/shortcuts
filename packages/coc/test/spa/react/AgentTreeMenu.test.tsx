// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AgentTreeMenu } from '../../../src/server/spa/client/react/features/chat/agent-canvas/AgentTreeMenu';
import type { AgentRunNode } from '../../../src/server/spa/client/react/features/chat/agent-canvas/types';

function node(id: string, extra: Partial<AgentRunNode> = {}): AgentRunNode {
    return { id, name: id, role: 'agent', status: 'done', children: [], ...extra };
}

function root(children: AgentRunNode[] = []): AgentRunNode {
    return node('root', { isRoot: true, role: 'orchestrator', name: 'Orch', status: 'running', children });
}

function baseTree(): AgentRunNode {
    return root([
        node('a', { name: 'alpha-agent', role: 'explore', children: [node('a1', { name: 'alpha-child' })] }),
        node('b', { name: 'beta-agent', role: 'review' }),
    ]);
}

function cloneTree(tree: AgentRunNode): AgentRunNode {
    return { ...tree, children: tree.children.map(cloneTree) };
}

function openMenu(props: Partial<Parameters<typeof AgentTreeMenu>[0]> = {}) {
    const onSelectAgent = vi.fn();
    const onOpenMap = vi.fn();
    const result = render(
        <AgentTreeMenu
            root={baseTree()}
            selectedAgentId={null}
            mapOpen={false}
            onSelectAgent={onSelectAgent}
            onOpenMap={onOpenMap}
            {...props}
        />,
    );
    fireEvent.click(screen.getByTestId('agent-tree-trigger'));
    return { ...result, onSelectAgent, onOpenMap };
}

describe('AgentTreeMenu', () => {
    it('opens a real ARIA tree with indented parent/child rows', () => {
        openMenu();
        expect(screen.getByRole('tree', { name: 'Agent runs' })).toBeTruthy();
        expect(screen.getByTestId('agent-tree-row-root').getAttribute('aria-level')).toBe('1');
        expect(screen.getByTestId('agent-tree-row-a').getAttribute('aria-level')).toBe('2');
        expect(screen.getByTestId('agent-tree-row-a1').getAttribute('aria-level')).toBe('3');
        expect(screen.getByTestId('agent-tree-row-root').textContent).toContain('Main thread');
        expect(parseInt(screen.getByTestId('agent-tree-row-a1').style.paddingLeft, 10))
            .toBeGreaterThan(parseInt(screen.getByTestId('agent-tree-row-a').style.paddingLeft, 10));
    });

    it('collapses and expands a subtree with the twisty', () => {
        openMenu();
        fireEvent.click(screen.getByTestId('agent-tree-toggle-a'));
        expect(screen.queryByTestId('agent-tree-row-a1')).toBeNull();
        fireEvent.click(screen.getByTestId('agent-tree-toggle-a'));
        expect(screen.getByTestId('agent-tree-row-a1')).toBeTruthy();
    });

    it('selects sub-agents and the main thread', () => {
        const { onSelectAgent } = openMenu({ selectedAgentId: 'a' });
        expect(screen.getByTestId('agent-tree-row-a').getAttribute('aria-selected')).toBe('true');
        fireEvent.click(screen.getByTestId('agent-tree-row-b'));
        expect(onSelectAgent).toHaveBeenCalledWith('b');

        fireEvent.click(screen.getByTestId('agent-tree-trigger'));
        fireEvent.click(screen.getByTestId('agent-tree-row-root'));
        expect(onSelectAgent).toHaveBeenCalledWith(null);
    });

    it('shows a running count and live dot while sub-agents are running', () => {
        openMenu({
            root: root([
                node('a', { status: 'running' }),
                node('b'),
            ]),
        });
        expect(screen.getByTestId('agent-tree-count').textContent).toBe('1');
        expect(screen.getByTestId('agent-tree-live-dot')).toBeTruthy();
    });

    it('shows the map footer only past six total runs and opens the map', () => {
        const { onOpenMap } = openMenu({
            root: root(Array.from({ length: 6 }, (_, i) => node(`a${i}`))),
        });
        fireEvent.click(screen.getByTestId('agent-tree-open-map'));
        expect(onOpenMap).toHaveBeenCalledTimes(1);

        render(
            <AgentTreeMenu
                root={root(Array.from({ length: 5 }, (_, i) => node(`b${i}`)))}
                selectedAgentId={null}
                mapOpen={false}
                onSelectAgent={vi.fn()}
                onOpenMap={vi.fn()}
            />,
        );
        fireEvent.click(screen.getAllByTestId('agent-tree-trigger')[1]);
        expect(screen.queryAllByTestId('agent-tree-open-map')).toHaveLength(0);
    });

    it('supports keyboard navigation and selection', () => {
        const { onSelectAgent } = openMenu();
        expect(document.activeElement).toBe(screen.getByTestId('agent-tree-row-root'));
        fireEvent.keyDown(document.activeElement as Element, { key: 'ArrowDown' });
        expect(document.activeElement).toBe(screen.getByTestId('agent-tree-row-a'));
        fireEvent.keyDown(document.activeElement as Element, { key: 'Enter' });
        expect(onSelectAgent).toHaveBeenCalledWith('a');
    });

    it('expands a collapsed child with ArrowRight', () => {
        const largeRoot = root([
            node('a', { children: [node('a1')] }),
            ...Array.from({ length: 11 }, (_, i) => node(`f${i}`)),
        ]);
        openMenu({ root: largeRoot });
        expect(screen.queryByTestId('agent-tree-row-a1')).toBeNull();
        fireEvent.keyDown(screen.getByTestId('agent-tree-row-root'), { key: 'ArrowDown' });
        fireEvent.keyDown(document.activeElement as Element, { key: 'ArrowRight' });
        expect(screen.getByTestId('agent-tree-row-a1')).toBeTruthy();
    });

    it('keeps user collapse state when the root object identity changes', () => {
        const initial = baseTree();
        const { rerender } = openMenu({ root: initial });
        fireEvent.click(screen.getByTestId('agent-tree-toggle-a'));
        expect(screen.queryByTestId('agent-tree-row-a1')).toBeNull();

        rerender(
            <AgentTreeMenu
                root={cloneTree(initial)}
                selectedAgentId={null}
                mapOpen={false}
                onSelectAgent={vi.fn()}
                onOpenMap={vi.fn()}
            />,
        );
        expect(screen.queryByTestId('agent-tree-row-a1')).toBeNull();
    });
});
