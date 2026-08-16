import type { Editor } from '@tiptap/react';
import { ToolbarDropdown, MenuItem } from './ToolbarDropdown';
import {
    DEFAULT_FONT_SIZE_OPTION,
    FONT_SIZE_OPTIONS,
    findSizeOption,
    normalizeFontSize,
} from '../fontSizes';

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

/**
 * The font size on the current selection, or `null` when it is unset or the
 * selection spans more than one size.
 *
 * `getAttributes` is only right for a caret. Tiptap's `getMarkAttributes`
 * collects every `textStyle` mark in the range and hands back the *first* one,
 * with no check that the range agrees — so a run of 24px text followed by
 * unsized text would light up the 24 row. A selection that covers a mix has no
 * one size to report, so the trigger reads "Default" instead.
 */
export function activeFontSize(editor: Editor): string | null {
    // A caret covers no text to survey, and its stored marks are what typed
    // text will pick up — exactly what `getAttributes` reports. It is also the
    // only read left when there is no ProseMirror state to walk, which is how a
    // torn-down editor and the toolbar tests' partial doubles both look; probe
    // for it the way `getSelectedText` and `extractHeadings` do, because this
    // runs on every toolbar render.
    const storedFontSize = () =>
        (editor.getAttributes('textStyle').fontSize as string | undefined) ?? null;

    const selection = editor.state?.selection;
    if (!selection || selection.empty) return storedFontSize();
    const doc = editor.state?.doc;
    if (typeof doc?.nodesBetween !== 'function') return storedFontSize();

    const { from, to } = selection;
    let seen: string | null | undefined;
    let mixed = false;
    doc.nodesBetween(from, to, (node) => {
        if (mixed) return false;
        if (!node.isText) return true;
        const fontSize = node.marks.find((mark) => mark.type.name === 'textStyle')?.attrs.fontSize;
        // A run with no size — or one in a unit we do not persist — is its own
        // distinct value, so sized + unsized reads as mixed rather than
        // inheriting the sized run's label.
        const size = normalizeFontSize(fontSize as string | undefined);
        if (seen === undefined) seen = size;
        else if (seen !== size) mixed = true;
        return true;
    });

    return mixed ? null : (seen ?? null);
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
