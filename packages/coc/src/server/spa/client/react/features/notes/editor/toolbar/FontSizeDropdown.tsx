import type { Editor } from '@tiptap/react';
import { ToolbarDropdown, MenuItem } from './ToolbarDropdown';
import { DEFAULT_FONT_SIZE_OPTION, FONT_SIZE_OPTIONS, findSizeOption } from '../fontSizes';

/**
 * The font-size picker.
 *
 * Applies per selection, like Bold or the font picker next to it — not a
 * whole-note setting. The size is the `fontSize` attribute of Tiptap's
 * `textStyle` mark, the same mark text color and font family hang off, so all
 * three compose on one span without clobbering each other.
 *
 * Because it is a mark it never changes the block type: sizing an H2 leaves it
 * an H2, and "Default" restores whatever size the heading or theme dictates.
 */

/** The font size on the current selection, or `null` when unset. */
export function activeFontSize(editor: Editor): string | null {
    return (editor.getAttributes('textStyle').fontSize as string | undefined) ?? null;
}

export function FontSizeDropdown({ editor }: { editor: Editor }) {
    // An off-ladder size (pasted from elsewhere, or in a unit we do not persist)
    // stays on the mark but matches no row, so the trigger reads "Default"
    // rather than inventing a label.
    const active = findSizeOption(activeFontSize(editor));

    return (
        <ToolbarDropdown
            menu
            menuLabel="Font size"
            panelTestId="font-size-dropdown-menu"
            panelClassName="p-1 min-w-[5rem]"
            renderTrigger={({ open, toggle, triggerRef }) => (
                <button
                    ref={triggerRef}
                    type="button"
                    title="Font size"
                    aria-label="Font size"
                    aria-haspopup="menu"
                    aria-expanded={open}
                    data-testid="font-size-dropdown"
                    className={
                        'h-7 px-1 rounded flex items-center gap-0.5 text-xs hover:bg-[#e0e0e0] dark:hover:bg-[#505050] ' +
                        (active || open ? 'bg-[#e8e8e8] dark:bg-[#3c3c3c] ' : '') +
                        (active ? 'font-bold' : '')
                    }
                    onMouseDown={(e) => {
                        e.preventDefault(); // keep the editor selection
                        toggle();
                    }}
                >
                    {/* Fixed width so the toolbar does not reflow as the caret
                        moves between a two-digit size and "Default". */}
                    <span data-testid="font-size-dropdown-label" className="w-10 text-left truncate">
                        {(active ?? DEFAULT_FONT_SIZE_OPTION).label}
                    </span>
                    <span className="text-[10px]">▾</span>
                </button>
            )}
            renderPanel={({ close }) => (
                <>
                    {FONT_SIZE_OPTIONS.map((option) => (
                        <MenuItem
                            key={option.id}
                            checked={option.size ? active?.id === option.id : active === null}
                            testId={option.testId}
                            onSelect={() => {
                                const chain = editor.chain().focus();
                                if (option.size) chain.setFontSize(option.size).run();
                                else chain.unsetFontSize().run();
                                close();
                            }}
                        >
                            {option.label}
                        </MenuItem>
                    ))}
                </>
            )}
        />
    );
}
