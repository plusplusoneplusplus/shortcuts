/**
 * NotesTreeItem drag-and-drop — tests for the extended drag-drop props.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { NotesTreeItem } from '../../../src/server/spa/client/react/features/notes/editor/NotesTreeItem';
import type { NoteTreeNode } from '../../../src/server/spa/client/react/features/notes/notesApi';

vi.mock('../../../src/server/spa/client/react/hooks/ui/useBreakpoint', () => ({
    useBreakpoint: () => ({ isMobile: false, isTablet: false, isDesktop: true, breakpoint: 'desktop' }),
}));

function makeNode(overrides: Partial<NoteTreeNode> = {}): NoteTreeNode {
    return { name: 'Test', path: 'test', type: 'page', ...overrides };
}

describe('NotesTreeItem — drag and drop props', () => {
    it('renders without draggable attribute by default', () => {
        const { getByTestId } = render(
            <NotesTreeItem
                node={makeNode()}
                selectedPath={null}
                isExpanded={false}
                depth={0}
                onToggleExpand={vi.fn()}
                onSelectPage={vi.fn()}
                onContextMenu={vi.fn()}
            />,
        );
        // draggable attribute absent or false when not provided
        const el = getByTestId('notes-tree-item-Test');
        expect(el.getAttribute('draggable')).not.toBe('true');
    });

    it('sets draggable=true when draggable prop is true', () => {
        const { getByTestId } = render(
            <NotesTreeItem
                node={makeNode()}
                selectedPath={null}
                isExpanded={false}
                depth={0}
                onToggleExpand={vi.fn()}
                onSelectPage={vi.fn()}
                onContextMenu={vi.fn()}
                draggable
            />,
        );
        const el = getByTestId('notes-tree-item-Test');
        expect(el.getAttribute('draggable')).toBe('true');
    });

    it('calls onDragStart when drag starts', () => {
        const onDragStart = vi.fn();
        const { getByTestId } = render(
            <NotesTreeItem
                node={makeNode()}
                selectedPath={null}
                isExpanded={false}
                depth={0}
                onToggleExpand={vi.fn()}
                onSelectPage={vi.fn()}
                onContextMenu={vi.fn()}
                draggable
                onDragStart={onDragStart}
            />,
        );
        fireEvent.dragStart(getByTestId('notes-tree-item-Test'));
        expect(onDragStart).toHaveBeenCalledOnce();
    });

    it('calls onDrop when item is dropped on it', () => {
        const onDrop = vi.fn();
        const { getByTestId } = render(
            <NotesTreeItem
                node={makeNode()}
                selectedPath={null}
                isExpanded={false}
                depth={0}
                onToggleExpand={vi.fn()}
                onSelectPage={vi.fn()}
                onContextMenu={vi.fn()}
                draggable
                onDrop={onDrop}
            />,
        );
        fireEvent.drop(getByTestId('notes-tree-item-Test'));
        expect(onDrop).toHaveBeenCalledOnce();
    });

    it('renders before drop indicator when isDragOver=true and dropPosition=before', () => {
        const { getByTestId } = render(
            <NotesTreeItem
                node={makeNode()}
                selectedPath={null}
                isExpanded={false}
                depth={0}
                onToggleExpand={vi.fn()}
                onSelectPage={vi.fn()}
                onContextMenu={vi.fn()}
                isDragOver
                dropPosition="before"
            />,
        );
        expect(getByTestId('drop-indicator-before')).toBeTruthy();
    });

    it('renders after drop indicator when isDragOver=true and dropPosition=after', () => {
        const { getByTestId } = render(
            <NotesTreeItem
                node={makeNode()}
                selectedPath={null}
                isExpanded={false}
                depth={0}
                onToggleExpand={vi.fn()}
                onSelectPage={vi.fn()}
                onContextMenu={vi.fn()}
                isDragOver
                dropPosition="after"
            />,
        );
        expect(getByTestId('drop-indicator-after')).toBeTruthy();
    });

    it('applies folder-highlight class when isDragOver=true and dropPosition=inside for a folder', () => {
        const node = makeNode({ type: 'notebook', name: 'NB', path: 'NB' });
        const { getByTestId } = render(
            <NotesTreeItem
                node={node}
                selectedPath={null}
                isExpanded={false}
                depth={0}
                onToggleExpand={vi.fn()}
                onSelectPage={vi.fn()}
                onContextMenu={vi.fn()}
                isDragOver
                dropPosition="inside"
            />,
        );
        const el = getByTestId('notes-tree-item-NB');
        expect(el.className).toContain('ring-[#0969da]');
    });

    it('does not render drop indicators when isDragOver is false', () => {
        const { queryByTestId } = render(
            <NotesTreeItem
                node={makeNode()}
                selectedPath={null}
                isExpanded={false}
                depth={0}
                onToggleExpand={vi.fn()}
                onSelectPage={vi.fn()}
                onContextMenu={vi.fn()}
                isDragOver={false}
                dropPosition="before"
            />,
        );
        expect(queryByTestId('drop-indicator-before')).toBeNull();
        expect(queryByTestId('drop-indicator-after')).toBeNull();
    });
});
