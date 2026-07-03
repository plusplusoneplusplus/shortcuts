/**
 * @vitest-environment jsdom
 *
 * Tests for SpawnedTreeRow — the recursive chat-list row that nests
 * `send_to_conversation`-spawned descendants under their root chat.
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';

vi.mock('../../../../src/server/spa/client/react/ui/cn', () => ({
    cn: (...classes: any[]) => classes.filter(Boolean).join(' '),
}));

import { SpawnedTreeRow } from '../../../../src/server/spa/client/react/features/chat/SpawnedTreeRow';
import {
    groupBySpawnedTree,
    isSpawnedTreeEntry,
    type SpawnedTreeEntry,
} from '../../../../src/server/spa/client/react/features/chat/spawned-tree-grouping';

function chat(id: string, overrides: Record<string, unknown> = {}): any {
    return { id, processId: id, title: `chat ${id}`, lastActivityAt: 1_000, ...overrides };
}

/** Build a 3-level tree entry: root → child → grandchild, plus a sibling child. */
function buildEntry(): SpawnedTreeEntry {
    const entries = groupBySpawnedTree([
        chat('root'),
        chat('child-a', { parentProcessId: 'root' }),
        chat('child-b', { parentProcessId: 'root' }),
        chat('grandchild', { parentProcessId: 'child-a' }),
    ]);
    const entry = entries.find(e => isSpawnedTreeEntry(e) && e.rootProcessId === 'root');
    if (!entry) {throw new Error('no spawned-tree entry for root');}
    return entry as SpawnedTreeEntry;
}

const renderTaskCard = (
    task: any,
    options: { isGroupChild: boolean; leadingElement?: React.ReactNode },
) => (
    <div data-testid={`chatrow-${task.id}`} data-group-child={options.isGroupChild ? 'true' : 'false'}>
        {options.leadingElement}
        {task.title}
    </div>
);

function renderRow(overrides: Partial<React.ComponentProps<typeof SpawnedTreeRow>> = {}) {
    const onToggleCollapsed = vi.fn();
    const props = {
        entry: buildEntry(),
        collapsedIds: new Set<string>(),
        onToggleCollapsed,
        renderTaskCard,
        ...overrides,
    };
    const utils = render(<SpawnedTreeRow {...props} />);
    return { ...utils, onToggleCollapsed, props };
}

describe('SpawnedTreeRow', () => {
    it('renders the root chat and all descendants nested', () => {
        renderRow();
        expect(screen.getByTestId('chatrow-root')).toBeTruthy();
        expect(screen.getByTestId('chatrow-child-a')).toBeTruthy();
        expect(screen.getByTestId('chatrow-child-b')).toBeTruthy();
        expect(screen.getByTestId('chatrow-grandchild')).toBeTruthy();
    });

    it('shows the recursive total-descendant count on the root', () => {
        renderRow();
        const root = screen.getByTestId('spawned-tree-row');
        const rootNode = within(root).getAllByTestId('spawned-tree-node')[0];
        // root has 3 descendants total (child-a, child-b, grandchild).
        const count = within(rootNode).getAllByTestId('spawned-tree-child-count')[0];
        expect(count.textContent).toBe('3');
        expect(count.getAttribute('title')).toBe('3 sub-jobs');
    });

    it('nests the grandchild one level deeper than the children', () => {
        renderRow();
        const grandchildNode = screen.getByTestId('chatrow-grandchild').closest('[data-testid="spawned-tree-node"]');
        expect(grandchildNode?.getAttribute('data-depth')).toBe('2');
        const childNode = screen.getByTestId('chatrow-child-a').closest('[data-testid="spawned-tree-node"]');
        expect(childNode?.getAttribute('data-depth')).toBe('1');
    });

    it('renders descendants as group children (muted) and the root as a top-level row', () => {
        renderRow();
        expect(screen.getByTestId('chatrow-root').getAttribute('data-group-child')).toBe('false');
        expect(screen.getByTestId('chatrow-child-a').getAttribute('data-group-child')).toBe('true');
    });

    it('renders a chevron only on nodes with children', () => {
        renderRow();
        // root + child-a have children → 2 chevrons (child-b and grandchild are leaves).
        expect(screen.getAllByTestId('spawned-tree-chevron')).toHaveLength(2);
    });

    it('renders the chevron inside the task card (dot column) so the avatar stays aligned', () => {
        renderRow();
        // The chevron is passed as the card's `leadingElement`, so it must live
        // inside the rendered chat row — not as a sibling prepended before it.
        const rootCard = screen.getByTestId('chatrow-root');
        expect(within(rootCard).getByTestId('spawned-tree-chevron')).toBeTruthy();
        // Leaf rows pass no leading element → no chevron inside their card.
        const leafCard = screen.getByTestId('chatrow-child-b');
        expect(within(leafCard).queryByTestId('spawned-tree-chevron')).toBeNull();
    });

    it('hides descendants when the root is collapsed', () => {
        renderRow({ collapsedIds: new Set(['root']) });
        expect(screen.getByTestId('chatrow-root')).toBeTruthy();
        expect(screen.queryByTestId('chatrow-child-a')).toBeNull();
        expect(screen.queryByTestId('chatrow-grandchild')).toBeNull();
    });

    it('keeps the root expanded but collapses a nested subtree when only the child is collapsed', () => {
        renderRow({ collapsedIds: new Set(['child-a']) });
        expect(screen.getByTestId('chatrow-child-a')).toBeTruthy();
        expect(screen.getByTestId('chatrow-child-b')).toBeTruthy();
        // child-a is collapsed → its grandchild is hidden.
        expect(screen.queryByTestId('chatrow-grandchild')).toBeNull();
    });

    it('calls onToggleCollapsed with the node id when its chevron is clicked', () => {
        const { onToggleCollapsed } = renderRow();
        const rootNode = screen.getByTestId('chatrow-root').closest('[data-testid="spawned-tree-node"]')!;
        const rootChevron = within(rootNode as HTMLElement).getAllByTestId('spawned-tree-chevron')[0];
        fireEvent.click(rootChevron);
        expect(onToggleCollapsed).toHaveBeenCalledWith('root');
    });
});
