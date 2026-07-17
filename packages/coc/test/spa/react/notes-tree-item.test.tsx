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
    it('renders folder rows in bold weight', () => {
        const { getByTestId } = render(
            <NotesTreeItem node={makeNode({ type: 'notebook', name: 'NB' })} selectedPath={null} isExpanded={false} depth={0}
                onToggleExpand={vi.fn()} onSelectPage={vi.fn()} onContextMenu={vi.fn()} />,
        );
        expect(getByTestId('notes-tree-item-NB').className).toContain('font-semibold');
    });

    it('renders a recursive page-count badge on folder rows when pageCount > 0', () => {
        const { getByTestId } = render(
            <NotesTreeItem
                node={makeNode({ type: 'section', name: 'Sec' })}
                selectedPath={null}
                isExpanded={false}
                depth={0}
                pageCount={5}
                onToggleExpand={vi.fn()}
                onSelectPage={vi.fn()}
                onContextMenu={vi.fn()}
            />,
        );
        const badge = getByTestId('folder-page-count');
        expect(badge.textContent).toBe('5');
    });

    it('does not render a page-count badge on page rows', () => {
        const { queryByTestId } = render(
            <NotesTreeItem
                node={makeNode({ type: 'page', name: 'Pg' })}
                selectedPath={null}
                isExpanded={false}
                depth={0}
                pageCount={3}
                onToggleExpand={vi.fn()}
                onSelectPage={vi.fn()}
                onContextMenu={vi.fn()}
            />,
        );
        expect(queryByTestId('folder-page-count')).toBeNull();
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

    it('applies selected class with accent stripe when selectedPath matches', () => {
        const node = makeNode({ path: 'nb/page1', name: 'page1' });
        const { getByTestId } = render(
            <NotesTreeItem node={node} selectedPath="nb/page1" isExpanded={false} depth={0}
                onToggleExpand={vi.fn()} onSelectPage={vi.fn()} onContextMenu={vi.fn()} />,
        );
        const el = getByTestId('notes-tree-item-page1');
        expect(el.className).toContain('bg-[#ddf4ff]');
        expect(el.className).toContain('shadow-[inset_3px_0_0_#0969da]');
        expect(el.getAttribute('aria-selected')).toBe('true');
    });

    it('does not apply selected class when selectedPath does not match', () => {
        const node = makeNode({ path: 'nb/page1', name: 'page1' });
        const { getByTestId } = render(
            <NotesTreeItem node={node} selectedPath="nb/other" isExpanded={false} depth={0}
                onToggleExpand={vi.fn()} onSelectPage={vi.fn()} onContextMenu={vi.fn()} />,
        );
        const el = getByTestId('notes-tree-item-page1');
        expect(el.className).not.toContain('bg-[#ddf4ff]');
        expect(el.className).not.toContain('shadow-[inset_3px_0_0_#0969da]');
        expect(el.getAttribute('aria-selected')).toBe('false');
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

    it('prevents right-button mousedown so sidebar context menus do not steal editor focus', () => {
        const node = makeNode({ path: 'x', name: 'X' });
        const { getByTestId } = render(
            <NotesTreeItem node={node} selectedPath={null} isExpanded={false} depth={0}
                onToggleExpand={vi.fn()} onSelectPage={vi.fn()} onContextMenu={vi.fn()} />,
        );

        expect(fireEvent.mouseDown(getByTestId('notes-tree-item-X'), { button: 2 })).toBe(false);
    });

    it('does not prevent left-button or shift right-button mousedown', () => {
        const node = makeNode({ path: 'x', name: 'X' });
        const { getByTestId } = render(
            <NotesTreeItem node={node} selectedPath={null} isExpanded={false} depth={0}
                onToggleExpand={vi.fn()} onSelectPage={vi.fn()} onContextMenu={vi.fn()} />,
        );
        const item = getByTestId('notes-tree-item-X');

        expect(fireEvent.mouseDown(item, { button: 0 })).toBe(true);
        expect(fireEvent.mouseDown(item, { button: 2, shiftKey: true })).toBe(true);
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

    it('applies correct paddingLeft based on depth (10px base + 16px per depth)', () => {
        const node = makeNode({ name: 'deep', path: 'a/b/deep' });
        const { getByTestId } = render(
            <NotesTreeItem node={node} selectedPath={null} isExpanded={false} depth={2}
                onToggleExpand={vi.fn()} onSelectPage={vi.fn()} onContextMenu={vi.fn()} />,
        );
        expect(getByTestId('notes-tree-item-deep').style.paddingLeft).toBe('42px');
    });

    it('renders a subtle update indicator when hasUpdate is true', () => {
        const node = makeNode({ name: 'Updated', path: 'nb/updated.md' });
        const { getByTestId } = render(
            <NotesTreeItem node={node} selectedPath={null} isExpanded={false} depth={0}
                hasUpdate
                onToggleExpand={vi.fn()} onSelectPage={vi.fn()} onContextMenu={vi.fn()} />,
        );

        const indicator = getByTestId('note-update-indicator');
        expect(indicator.className).toContain('rounded-full');
        expect(indicator.getAttribute('aria-label')).toBe('Updated since last viewed');
    });

    it('does not render an update indicator by default', () => {
        const node = makeNode({ name: 'Current', path: 'nb/current.md' });
        const { queryByTestId } = render(
            <NotesTreeItem node={node} selectedPath={null} isExpanded={false} depth={0}
                onToggleExpand={vi.fn()} onSelectPage={vi.fn()} onContextMenu={vi.fn()} />,
        );

        expect(queryByTestId('note-update-indicator')).toBeNull();
    });

    it('applies multi-selected highlight class without left accent bar when isMultiSelected', () => {
        const node = makeNode({ path: 'nb/page1', name: 'page1' });
        const { getByTestId } = render(
            <NotesTreeItem node={node} selectedPath={null} isExpanded={false} depth={0}
                isMultiSelected
                onToggleExpand={vi.fn()} onSelectPage={vi.fn()} onContextMenu={vi.fn()} />,
        );
        const el = getByTestId('notes-tree-item-page1');
        expect(el.className).toContain('bg-[#ddf4ff]');
        expect(el.className).not.toContain('shadow-[inset_3px_0_0_#0969da]');
        expect(el.getAttribute('aria-selected')).toBe('true');
    });

    it('does not apply multi-selected highlight when isMultiSelected is false', () => {
        const node = makeNode({ path: 'nb/page1', name: 'page1' });
        const { getByTestId } = render(
            <NotesTreeItem node={node} selectedPath={null} isExpanded={false} depth={0}
                isMultiSelected={false}
                onToggleExpand={vi.fn()} onSelectPage={vi.fn()} onContextMenu={vi.fn()} />,
        );
        const el = getByTestId('notes-tree-item-page1');
        expect(el.className).not.toContain('bg-[#ddf4ff]');
    });

    it('calls onSelectWithModifiers with modifier keys on shift-click', () => {
        const onSelectWithModifiers = vi.fn();
        const node = makeNode({ path: 'nb/page1', name: 'page1', type: 'page' });
        const { getByTestId } = render(
            <NotesTreeItem node={node} selectedPath={null} isExpanded={false} depth={0}
                onToggleExpand={vi.fn()} onSelectPage={vi.fn()} onContextMenu={vi.fn()}
                onSelectWithModifiers={onSelectWithModifiers} />,
        );
        fireEvent.click(getByTestId('notes-tree-item-page1'), { shiftKey: true });
        expect(onSelectWithModifiers).toHaveBeenCalledWith('nb/page1', true, false);
    });

    it('calls onSelectWithModifiers with modifier keys on ctrl-click', () => {
        const onSelectWithModifiers = vi.fn();
        const node = makeNode({ path: 'nb/page1', name: 'page1', type: 'page' });
        const { getByTestId } = render(
            <NotesTreeItem node={node} selectedPath={null} isExpanded={false} depth={0}
                onToggleExpand={vi.fn()} onSelectPage={vi.fn()} onContextMenu={vi.fn()}
                onSelectWithModifiers={onSelectWithModifiers} />,
        );
        fireEvent.click(getByTestId('notes-tree-item-page1'), { ctrlKey: true });
        expect(onSelectWithModifiers).toHaveBeenCalledWith('nb/page1', false, true);
    });

    it('calls onSelectPage (not onSelectWithModifiers) on plain click', () => {
        const onSelectWithModifiers = vi.fn();
        const onSelectPage = vi.fn();
        const node = makeNode({ path: 'nb/page1', name: 'page1', type: 'page' });
        const { getByTestId } = render(
            <NotesTreeItem node={node} selectedPath={null} isExpanded={false} depth={0}
                onToggleExpand={vi.fn()} onSelectPage={onSelectPage} onContextMenu={vi.fn()}
                onSelectWithModifiers={onSelectWithModifiers} />,
        );
        fireEvent.click(getByTestId('notes-tree-item-page1'));
        expect(onSelectPage).toHaveBeenCalledWith('nb/page1');
        expect(onSelectWithModifiers).not.toHaveBeenCalled();
    });

    // --- AC-02: folders are selectable ---

    it('plain-click on a folder expands AND single-selects it', () => {
        const onToggleExpand = vi.fn();
        const onSelectWithModifiers = vi.fn();
        const node = makeNode({ path: 'mynotebook', name: 'NB', type: 'notebook' });
        const { getByTestId } = render(
            <NotesTreeItem node={node} selectedPath={null} isExpanded={false} depth={0}
                onToggleExpand={onToggleExpand} onSelectPage={vi.fn()} onContextMenu={vi.fn()}
                onSelectWithModifiers={onSelectWithModifiers} />,
        );
        fireEvent.click(getByTestId('notes-tree-item-NB'));
        expect(onToggleExpand).toHaveBeenCalledWith('mynotebook');
        expect(onSelectWithModifiers).toHaveBeenCalledWith('mynotebook', false, false);
    });

    it('shift-click on a folder selects (range) without toggling expand', () => {
        const onToggleExpand = vi.fn();
        const onSelectWithModifiers = vi.fn();
        const node = makeNode({ path: 'mynotebook', name: 'NB', type: 'notebook' });
        const { getByTestId } = render(
            <NotesTreeItem node={node} selectedPath={null} isExpanded={false} depth={0}
                onToggleExpand={onToggleExpand} onSelectPage={vi.fn()} onContextMenu={vi.fn()}
                onSelectWithModifiers={onSelectWithModifiers} />,
        );
        fireEvent.click(getByTestId('notes-tree-item-NB'), { shiftKey: true });
        expect(onSelectWithModifiers).toHaveBeenCalledWith('mynotebook', true, false);
        expect(onToggleExpand).not.toHaveBeenCalled();
    });

    it('ctrl-click on a folder toggles it in selection without toggling expand', () => {
        const onToggleExpand = vi.fn();
        const onSelectWithModifiers = vi.fn();
        const node = makeNode({ path: 'mynotebook', name: 'NB', type: 'section' });
        const { getByTestId } = render(
            <NotesTreeItem node={node} selectedPath={null} isExpanded={false} depth={0}
                onToggleExpand={onToggleExpand} onSelectPage={vi.fn()} onContextMenu={vi.fn()}
                onSelectWithModifiers={onSelectWithModifiers} />,
        );
        fireEvent.click(getByTestId('notes-tree-item-NB'), { ctrlKey: true });
        expect(onSelectWithModifiers).toHaveBeenCalledWith('mynotebook', false, true);
        expect(onToggleExpand).not.toHaveBeenCalled();
    });

    it('applies the multi-selected highlight to a folder row', () => {
        const node = makeNode({ path: 'mynotebook', name: 'NB', type: 'notebook' });
        const { getByTestId } = render(
            <NotesTreeItem node={node} selectedPath={null} isExpanded={false} depth={0}
                isMultiSelected
                onToggleExpand={vi.fn()} onSelectPage={vi.fn()} onContextMenu={vi.fn()} />,
        );
        const el = getByTestId('notes-tree-item-NB');
        expect(el.className).toContain('bg-[#ddf4ff]');
        expect(el.getAttribute('aria-selected')).toBe('true');
    });
});
