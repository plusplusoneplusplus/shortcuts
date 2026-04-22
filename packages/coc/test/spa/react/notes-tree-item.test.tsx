/**
 * NotesTreeItem — unit tests for the single tree row component.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { NotesTreeItem } from '../../../src/server/spa/client/react/features/notes/editor/NotesTreeItem';
import type { NoteTreeNode } from '../../../src/server/spa/client/react/features/notes/notesApi';

// Mock useBreakpoint (ContextMenu / Dialog may use it transitively)
vi.mock('../../../src/server/spa/client/react/hooks/ui/useBreakpoint', () => ({
    useBreakpoint: () => ({ isMobile: false, isTablet: false, isDesktop: true, breakpoint: 'desktop' }),
}));

function makeNode(overrides: Partial<NoteTreeNode> = {}): NoteTreeNode {
    return { name: 'Test', path: 'test', type: 'page', ...overrides };
}

describe('NotesTreeItem', () => {
    it('renders notebook icon for type notebook', () => {
        const { getByTestId } = render(
            <NotesTreeItem node={makeNode({ type: 'notebook', name: 'NB' })} selectedPath={null} isExpanded={false} depth={0}
                onToggleExpand={vi.fn()} onSelectPage={vi.fn()} onContextMenu={vi.fn()} />,
        );
        expect(getByTestId('node-icon').textContent).toBe('📓');
    });

    it('renders section icon for type section', () => {
        const { getByTestId } = render(
            <NotesTreeItem node={makeNode({ type: 'section', name: 'Sec' })} selectedPath={null} isExpanded={false} depth={0}
                onToggleExpand={vi.fn()} onSelectPage={vi.fn()} onContextMenu={vi.fn()} />,
        );
        expect(getByTestId('node-icon').textContent).toBe('📁');
    });

    it('renders page icon for type page', () => {
        const { getByTestId } = render(
            <NotesTreeItem node={makeNode({ type: 'page', name: 'Pg' })} selectedPath={null} isExpanded={false} depth={0}
                onToggleExpand={vi.fn()} onSelectPage={vi.fn()} onContextMenu={vi.fn()} />,
        );
        expect(getByTestId('node-icon').textContent).toBe('📄');
    });

    it('shows expand chevron for folder types', () => {
        const { getByTestId } = render(
            <NotesTreeItem node={makeNode({ type: 'notebook', name: 'NB' })} selectedPath={null} isExpanded={false} depth={0}
                onToggleExpand={vi.fn()} onSelectPage={vi.fn()} onContextMenu={vi.fn()} />,
        );
        const chevron = getByTestId('chevron');
        expect(chevron).toBeTruthy();
        expect(chevron.textContent).toBe('▸');
    });

    it('shows expanded chevron when isExpanded is true', () => {
        const { getByTestId } = render(
            <NotesTreeItem node={makeNode({ type: 'notebook', name: 'NB' })} selectedPath={null} isExpanded={true} depth={0}
                onToggleExpand={vi.fn()} onSelectPage={vi.fn()} onContextMenu={vi.fn()} />,
        );
        expect(getByTestId('chevron').textContent).toBe('▾');
    });

    it('hides chevron for page type', () => {
        const { queryByTestId } = render(
            <NotesTreeItem node={makeNode({ type: 'page' })} selectedPath={null} isExpanded={false} depth={0}
                onToggleExpand={vi.fn()} onSelectPage={vi.fn()} onContextMenu={vi.fn()} />,
        );
        expect(queryByTestId('chevron')).toBeNull();
    });

    it('applies selected class when selectedPath matches', () => {
        const node = makeNode({ path: 'nb/page1', name: 'page1' });
        const { getByTestId } = render(
            <NotesTreeItem node={node} selectedPath="nb/page1" isExpanded={false} depth={0}
                onToggleExpand={vi.fn()} onSelectPage={vi.fn()} onContextMenu={vi.fn()} />,
        );
        const el = getByTestId('notes-tree-item-page1');
        expect(el.className).toContain('bg-[#0078d4]/10');
    });

    it('does not apply selected class when selectedPath does not match', () => {
        const node = makeNode({ path: 'nb/page1', name: 'page1' });
        const { getByTestId } = render(
            <NotesTreeItem node={node} selectedPath="nb/other" isExpanded={false} depth={0}
                onToggleExpand={vi.fn()} onSelectPage={vi.fn()} onContextMenu={vi.fn()} />,
        );
        const el = getByTestId('notes-tree-item-page1');
        expect(el.className).not.toContain('bg-[#0078d4]/10');
    });

    it('fires onContextMenu with node and coordinates on right-click', () => {
        const onCtx = vi.fn();
        const node = makeNode({ path: 'x', name: 'X' });
        const { getByTestId } = render(
            <NotesTreeItem node={node} selectedPath={null} isExpanded={false} depth={0}
                onToggleExpand={vi.fn()} onSelectPage={vi.fn()} onContextMenu={onCtx} />,
        );
        fireEvent.contextMenu(getByTestId('notes-tree-item-X'), { clientX: 100, clientY: 200 });
        expect(onCtx).toHaveBeenCalledWith(node, 100, 200);
    });

    it('fires onSelectPage on page click', () => {
        const onSelect = vi.fn();
        const node = makeNode({ path: 'nb/page1', name: 'page1', type: 'page' });
        const { getByTestId } = render(
            <NotesTreeItem node={node} selectedPath={null} isExpanded={false} depth={0}
                onToggleExpand={vi.fn()} onSelectPage={onSelect} onContextMenu={vi.fn()} />,
        );
        fireEvent.click(getByTestId('notes-tree-item-page1'));
        expect(onSelect).toHaveBeenCalledWith('nb/page1');
    });

    it('fires onToggleExpand on folder click', () => {
        const onToggle = vi.fn();
        const node = makeNode({ path: 'mynotebook', name: 'NB', type: 'notebook' });
        const { getByTestId } = render(
            <NotesTreeItem node={node} selectedPath={null} isExpanded={false} depth={0}
                onToggleExpand={onToggle} onSelectPage={vi.fn()} onContextMenu={vi.fn()} />,
        );
        fireEvent.click(getByTestId('notes-tree-item-NB'));
        expect(onToggle).toHaveBeenCalledWith('mynotebook');
    });

    it('applies correct paddingLeft based on depth', () => {
        const node = makeNode({ name: 'deep', path: 'a/b/deep' });
        const { getByTestId } = render(
            <NotesTreeItem node={node} selectedPath={null} isExpanded={false} depth={2}
                onToggleExpand={vi.fn()} onSelectPage={vi.fn()} onContextMenu={vi.fn()} />,
        );
        expect(getByTestId('notes-tree-item-deep').style.paddingLeft).toBe('32px');
    });
});
