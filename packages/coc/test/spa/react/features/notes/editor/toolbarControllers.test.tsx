/**
 * Tests for the toolbar's extracted controllers and the shared dropdown
 * primitive, at the hook/component level rather than through the whole toolbar.
 *
 * These cover the invariants that are easy to lose when the toolbar's render
 * tree is rearranged: closing find always clears the search, source mode
 * force-closes it, the table strip reads nothing off the editor when the caret
 * is outside a table, and the menu primitive keeps its roving focus keys.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, renderHook, act } from '@testing-library/react';
import type { Editor } from '@tiptap/react';
import { useFindReplaceToolbarController } from '../../../../../../src/server/spa/client/react/features/notes/editor/toolbar/useFindReplaceToolbarController';
import { ToolbarDropdown, MenuItem } from '../../../../../../src/server/spa/client/react/features/notes/editor/toolbar/ToolbarDropdown';

const tableWidthMocks = vi.hoisted(() => ({
    activeTableHasColumnWidths: vi.fn(() => false),
    clearActiveTableColumnWidths: vi.fn(() => true),
}));
vi.mock(
    '../../../../../../src/server/spa/client/react/features/notes/editor/tableColumnWidths',
    () => tableWidthMocks,
);

const tableHeaderMocks = vi.hoisted(() => ({
    tableHeaderState: vi.fn(() => ({ row: false, column: false })),
}));
vi.mock(
    '../../../../../../src/server/spa/client/react/features/notes/editor/tableHeaderState',
    () => tableHeaderMocks,
);

const tableWrapMocks = vi.hoisted(() => ({
    activeColumnWrap: vi.fn((): string | null => 'wrap'),
    toggleActiveColumnWrap: vi.fn(() => true),
}));
vi.mock(
    '../../../../../../src/server/spa/client/react/features/notes/editor/extensions/tableColumnWrap',
    () => tableWrapMocks,
);

// Imported after the mocks so the hook picks up the doubles.
const { useTableToolbarState } = await import(
    '../../../../../../src/server/spa/client/react/features/notes/editor/toolbar/TableToolbarControls'
);

beforeEach(() => {
    tableWidthMocks.activeTableHasColumnWidths.mockReset().mockReturnValue(false);
    tableHeaderMocks.tableHeaderState.mockReset().mockReturnValue({ row: false, column: false });
    tableWrapMocks.activeColumnWrap.mockReset().mockReturnValue('wrap');
});

// ── useFindReplaceToolbarController ─────────────────────────────────────────

function makeFindEditor() {
    const clearSearch = vi.fn();
    return { editor: { commands: { clearSearch } } as unknown as Editor, clearSearch };
}

describe('useFindReplaceToolbarController', () => {
    it('starts closed', () => {
        const { editor } = makeFindEditor();
        const { result } = renderHook(() => useFindReplaceToolbarController(editor));
        expect(result.current.open).toBe(false);
    });

    it('opens without clearing the search', () => {
        const { editor, clearSearch } = makeFindEditor();
        const { result } = renderHook(() => useFindReplaceToolbarController(editor));

        act(() => result.current.openFind());

        expect(result.current.open).toBe(true);
        expect(clearSearch).not.toHaveBeenCalled();
    });

    it('clears the search when closing, so no stale highlights survive', () => {
        const { editor, clearSearch } = makeFindEditor();
        const { result } = renderHook(() => useFindReplaceToolbarController(editor));

        act(() => result.current.openFind());
        act(() => result.current.closeFind());

        expect(result.current.open).toBe(false);
        expect(clearSearch).toHaveBeenCalledTimes(1);
    });

    it('toggles open, then toggles closed and clears', () => {
        const { editor, clearSearch } = makeFindEditor();
        const { result } = renderHook(() => useFindReplaceToolbarController(editor));

        act(() => result.current.toggleFind());
        expect(result.current.open).toBe(true);
        expect(clearSearch).not.toHaveBeenCalled();

        act(() => result.current.toggleFind());
        expect(result.current.open).toBe(false);
        expect(clearSearch).toHaveBeenCalledTimes(1);
    });

    it('force-closes and clears when the toolbar switches to source mode', () => {
        const { editor, clearSearch } = makeFindEditor();
        const { result, rerender } = renderHook(
            ({ hidden }) => useFindReplaceToolbarController(editor, hidden),
            { initialProps: { hidden: false } },
        );

        act(() => result.current.openFind());
        rerender({ hidden: true });

        expect(result.current.open).toBe(false);
        expect(clearSearch).toHaveBeenCalled();
    });

    it('tolerates a null editor and an editor without the extension', () => {
        for (const editor of [null, {} as Editor, { commands: {} } as Editor]) {
            const { result } = renderHook(() => useFindReplaceToolbarController(editor));
            act(() => result.current.openFind());
            expect(() => act(() => result.current.closeFind())).not.toThrow();
            expect(result.current.open).toBe(false);
        }
    });
});

// ── useTableToolbarState ────────────────────────────────────────────────────

function makeTableEditor(inTable: boolean, canOverride: Record<string, boolean> = {}) {
    return {
        isActive: vi.fn((name: string) => name === 'table' && inTable),
        can: vi.fn(() => new Proxy({}, {
            get: (_t, prop: string) => () => canOverride[prop] ?? true,
        })),
    } as unknown as Editor;
}

describe('useTableToolbarState', () => {
    it('reports nothing and reads nothing off the doc outside a table', () => {
        const { result } = renderHook(() => useTableToolbarState(makeTableEditor(false)));

        expect(result.current).toEqual({
            inTable: false,
            hasWidths: false,
            headers: { row: false, column: false },
            noWrap: false,
            canMove: {
                moveTableColumnLeft: false,
                moveTableColumnRight: false,
                moveTableRowUp: false,
                moveTableRowDown: false,
            },
        });
        // Structural reads walk the doc; skipping them outside a table keeps the
        // strip cheap and avoids reading a table that is not there.
        expect(tableWidthMocks.activeTableHasColumnWidths).not.toHaveBeenCalled();
        expect(tableHeaderMocks.tableHeaderState).not.toHaveBeenCalled();
        expect(tableWrapMocks.activeColumnWrap).not.toHaveBeenCalled();
    });

    it('surfaces widths, header shape and wrap mode inside a table', () => {
        tableWidthMocks.activeTableHasColumnWidths.mockReturnValue(true);
        tableHeaderMocks.tableHeaderState.mockReturnValue({ row: true, column: false });
        tableWrapMocks.activeColumnWrap.mockReturnValue('nowrap');

        const { result } = renderHook(() => useTableToolbarState(makeTableEditor(true)));

        expect(result.current.inTable).toBe(true);
        expect(result.current.hasWidths).toBe(true);
        expect(result.current.headers).toEqual({ row: true, column: false });
        expect(result.current.noWrap).toBe(true);
    });

    it('takes move availability from the commands themselves', () => {
        const editor = makeTableEditor(true, { moveTableRowUp: false, moveTableColumnRight: false });
        const { result } = renderHook(() => useTableToolbarState(editor));

        expect(result.current.canMove).toEqual({
            moveTableColumnLeft: true,
            moveTableColumnRight: false,
            moveTableRowUp: false,
            moveTableRowDown: true,
        });
    });

    it('reads moves as unavailable when the reorder extension is absent', () => {
        // `can()` returning undefined must not throw the whole toolbar out.
        const editor = { isActive: () => true, can: () => undefined } as unknown as Editor;
        tableHeaderMocks.tableHeaderState.mockReturnValue({ row: false, column: false });

        const { result } = renderHook(() => useTableToolbarState(editor));

        expect(Object.values(result.current.canMove)).toEqual([false, false, false, false]);
    });
});

// ── ToolbarDropdown ─────────────────────────────────────────────────────────

function Harness({ onSelect = () => {} }: { onSelect?: () => void }) {
    return (
        <ToolbarDropdown
            menu
            menuLabel="Test menu"
            panelTestId="test-menu"
            renderTrigger={({ open, toggle, triggerRef }) => (
                <button
                    ref={triggerRef}
                    type="button"
                    data-testid="test-trigger"
                    aria-expanded={open}
                    onMouseDown={(e) => { e.preventDefault(); toggle(); }}
                >
                    trigger
                </button>
            )}
            renderPanel={({ close }) => (
                <>
                    {['a', 'b', 'c'].map((id) => (
                        <MenuItem
                            key={id}
                            checked={id === 'b'}
                            testId={`item-${id}`}
                            onSelect={() => { onSelect(); close(); }}
                        >
                            {id}
                        </MenuItem>
                    ))}
                </>
            )}
        />
    );
}

describe('ToolbarDropdown — menu keyboard behaviour', () => {
    it('moves focus to the checked item on open', () => {
        render(<Harness />);
        fireEvent.mouseDown(screen.getByTestId('test-trigger'));
        expect(document.activeElement).toBe(screen.getByTestId('item-b'));
    });

    it('Home and End jump to the first and last items', () => {
        render(<Harness />);
        fireEvent.mouseDown(screen.getByTestId('test-trigger'));
        const menu = screen.getByTestId('test-menu');

        fireEvent.keyDown(menu, { key: 'End' });
        expect(document.activeElement).toBe(screen.getByTestId('item-c'));

        fireEvent.keyDown(menu, { key: 'Home' });
        expect(document.activeElement).toBe(screen.getByTestId('item-a'));
    });

    it('ArrowDown wraps past the last item and ArrowUp past the first', () => {
        render(<Harness />);
        fireEvent.mouseDown(screen.getByTestId('test-trigger'));
        const menu = screen.getByTestId('test-menu');

        fireEvent.keyDown(menu, { key: 'End' });
        fireEvent.keyDown(menu, { key: 'ArrowDown' });
        expect(document.activeElement).toBe(screen.getByTestId('item-a'));

        fireEvent.keyDown(menu, { key: 'ArrowUp' });
        expect(document.activeElement).toBe(screen.getByTestId('item-c'));
    });

    it('ignores keys it does not handle', () => {
        render(<Harness />);
        fireEvent.mouseDown(screen.getByTestId('test-trigger'));
        fireEvent.keyDown(screen.getByTestId('test-menu'), { key: 'a' });
        expect(document.activeElement).toBe(screen.getByTestId('item-b'));
    });

    it('Escape closes and returns focus to the trigger', () => {
        render(<Harness />);
        fireEvent.mouseDown(screen.getByTestId('test-trigger'));

        fireEvent.keyDown(document, { key: 'Escape' });

        expect(screen.queryByTestId('test-menu')).toBeNull();
        expect(document.activeElement).toBe(screen.getByTestId('test-trigger'));
    });

    it('selecting an item runs the handler once and closes', () => {
        const onSelect = vi.fn();
        render(<Harness onSelect={onSelect} />);
        fireEvent.mouseDown(screen.getByTestId('test-trigger'));

        // mousedown then click, the way a real pointer press fires — the item
        // has no onClick, so the command must not run twice.
        const item = screen.getByTestId('item-a');
        fireEvent.mouseDown(item);
        fireEvent.click(item);

        expect(onSelect).toHaveBeenCalledTimes(1);
        expect(screen.queryByTestId('test-menu')).toBeNull();
    });

    it('preserves the editor selection by suppressing the mousedown default', () => {
        render(<Harness />);
        fireEvent.mouseDown(screen.getByTestId('test-trigger'));

        const event = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
        screen.getByTestId('item-a').dispatchEvent(event);

        expect(event.defaultPrevented).toBe(true);
    });

    it('runs onClose whenever the panel closes, for transient panel state', () => {
        const onClose = vi.fn();
        render(
            <ToolbarDropdown
                panelTestId="plain-panel"
                onClose={onClose}
                renderTrigger={({ toggle, triggerRef }) => (
                    <button ref={triggerRef} type="button" data-testid="plain-trigger" onMouseDown={toggle}>t</button>
                )}
                renderPanel={() => <span>panel</span>}
            />,
        );

        fireEvent.mouseDown(screen.getByTestId('plain-trigger'));
        expect(onClose).not.toHaveBeenCalled();

        fireEvent.mouseDown(document.body);
        expect(onClose).toHaveBeenCalledTimes(1);
    });
});
