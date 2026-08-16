import type { Editor } from '@tiptap/react';
import { ToolbarDropdown, MenuItem } from './ToolbarDropdown';
import { DEFAULT_FONT_OPTION, FONT_FAMILY_OPTIONS, findFontOption } from '../fontFamilies';

/**
 * The font-family picker.
 *
 * Applies per selection, like Bold or Highlight — not a whole-note setting. The
 * font is the `fontFamily` attribute of Tiptap's `textStyle` mark, the same mark
 * text color hangs off, so the two compose on one span without either one
 * clobbering the other.
 *
 * Each row previews the font it sets by rendering its own label in it.
 */

/** The font on the current selection, or `null` when unset. */
export function activeFontStack(editor: Editor): string | null {
    return (editor.getAttributes('textStyle').fontFamily as string | undefined) ?? null;
}

export function FontFamilyDropdown({ editor }: { editor: Editor }) {
    // A foreign stack (pasted from elsewhere) stays on the mark but matches no
    // row, so the trigger reads "Default" rather than inventing a label.
    const active = findFontOption(activeFontStack(editor));

    return (
        <ToolbarDropdown
            menu
            menuLabel="Font family"
            panelTestId="font-dropdown-menu"
            panelClassName="p-1 min-w-[9rem]"
            renderTrigger={({ open, toggle, triggerRef }) => (
                <button
                    ref={triggerRef}
                    type="button"
                    title="Font family"
                    aria-label="Font family"
                    aria-haspopup="menu"
                    aria-expanded={open}
                    data-testid="font-dropdown"
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
                        moves between differently-named fonts. */}
                    <span
                        data-testid="font-dropdown-label"
                        className="w-10 text-left truncate"
                        style={active ? { fontFamily: active.stack } : undefined}
                    >
                        {(active ?? DEFAULT_FONT_OPTION).label}
                    </span>
                    <span className="text-[10px]">▾</span>
                </button>
            )}
            renderPanel={({ close }) => (
                <>
                    {FONT_FAMILY_OPTIONS.map((option) => (
                        <MenuItem
                            key={option.id}
                            checked={option.stack ? active?.id === option.id : active === null}
                            testId={option.testId}
                            labelStyle={option.stack ? { fontFamily: option.stack } : undefined}
                            onSelect={() => {
                                const chain = editor.chain().focus();
                                if (option.stack) chain.setFontFamily(option.stack).run();
                                else chain.unsetFontFamily().run();
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
