import type { Editor } from '@tiptap/react';
import { HIGHLIGHT_COLORS, TEXT_COLORS, normalizeCssColor, type PaletteColor } from '../colorPalette';
import { ToolbarDropdown } from './ToolbarDropdown';

/**
 * The "A ▾" color control: one trigger, one panel, two sections.
 *
 * Text color and highlight color are separate marks that users reach for in the
 * same moment, and each on its own is too small for a toolbar slot — so they
 * share a panel. The two sections never interact: picking in one leaves the
 * other mark alone, and each has its own reset row that unsets only its mark.
 */

const SECTION_LABEL_CLS =
    'px-0.5 pb-1 text-[10px] font-semibold uppercase tracking-wide text-[#666] dark:text-[#999]';

const SWATCH_CLS =
    'w-6 h-6 rounded-sm border border-[#ccc] dark:border-[#555] hover:scale-110 transition-transform';

const RESET_CLS =
    'mt-1 w-full px-1.5 py-1 rounded text-left text-[11px] whitespace-nowrap ' +
    'hover:bg-[#e0e0e0] dark:hover:bg-[#505050]';

interface ColorSectionProps {
    label: string;
    colors: readonly PaletteColor[];
    /** Prefix for each swatch's `aria-label` — e.g. `Text Red`, `Highlight Pink`. */
    labelPrefix: string;
    /** The color currently applied to the selection, if any — gets a ✓. */
    active: string | null;
    resetLabel: string;
    onPick: (color: string) => void;
    onReset: () => void;
}

function ColorSection({ label, colors, labelPrefix, active, resetLabel, onPick, onReset }: ColorSectionProps) {
    return (
        <div>
            <div className={SECTION_LABEL_CLS}>{label}</div>
            {/* 5x2 — ten swatches, matching the two palettes. */}
            <div className="grid grid-cols-5 gap-1">
                {colors.map(({ name, color }) => (
                    <button
                        key={color}
                        type="button"
                        title={name}
                        aria-label={`${labelPrefix} ${name}`}
                        aria-pressed={active === color}
                        className={SWATCH_CLS + (active === color ? ' ring-2 ring-[#0078d4] dark:ring-[#4daafc]' : '')}
                        style={{ backgroundColor: color }}
                        onMouseDown={(e) => {
                            e.preventDefault(); // keep the editor selection
                            onPick(color);
                        }}
                    />
                ))}
            </div>
            <button
                type="button"
                title={resetLabel}
                aria-label={resetLabel}
                className={RESET_CLS}
                onMouseDown={(e) => {
                    e.preventDefault(); // keep the editor selection
                    onReset();
                }}
            >
                <span className="mr-1 text-[#888]">✕</span>
                {resetLabel}
            </button>
        </div>
    );
}

/** The text color on the current selection, canonicalized, or `null` if unset. */
export function activeTextColor(editor: Editor): string | null {
    return normalizeCssColor(editor.getAttributes('textStyle').color as string | undefined);
}

/** The highlight color on the current selection, canonicalized, or `null`. */
export function activeHighlightColor(editor: Editor): string | null {
    if (!editor.isActive('highlight')) return null;
    return normalizeCssColor(editor.getAttributes('highlight').color as string | undefined);
}

export function ColorDropdown({ editor }: { editor: Editor }) {
    const textColor = activeTextColor(editor);
    const highlightColor = activeHighlightColor(editor);

    return (
        <ToolbarDropdown
            panelTestId="color-dropdown-panel"
            panelClassName="p-2 w-max"
            renderTrigger={({ open, toggle, triggerRef }) => (
                <button
                    ref={triggerRef}
                    type="button"
                    title="Text and highlight color"
                    aria-label="Text and highlight color"
                    aria-haspopup="true"
                    aria-expanded={open}
                    data-testid="color-dropdown"
                    className={
                        'h-7 px-1 rounded flex items-center gap-0.5 text-xs hover:bg-[#e0e0e0] dark:hover:bg-[#505050] ' +
                        (open ? 'bg-[#e8e8e8] dark:bg-[#3c3c3c]' : '')
                    }
                    onMouseDown={(e) => {
                        e.preventDefault(); // keep the editor selection
                        toggle();
                    }}
                >
                    {/* The "A" sits on a color bar rather than being tinted itself,
                        so the glyph keeps toolbar contrast while still reporting
                        the selection's color. */}
                    <span className="flex flex-col items-center leading-none">
                        <span className="font-bold">A</span>
                        <span
                            data-testid="color-dropdown-bar"
                            className="mt-px block w-3.5 h-1 rounded-sm border border-[#ccc] dark:border-[#555]"
                            style={{ backgroundColor: textColor ?? 'transparent' }}
                        />
                    </span>
                    <span className="text-[10px]">▾</span>
                </button>
            )}
            renderPanel={({ close }) => (
                <div className="flex flex-col gap-2">
                    <ColorSection
                        label="Text Color"
                        colors={TEXT_COLORS}
                        labelPrefix="Text"
                        active={textColor}
                        resetLabel="Default text color"
                        onPick={(color) => {
                            editor.chain().focus().setColor(color).run();
                            close();
                        }}
                        onReset={() => {
                            editor.chain().focus().unsetColor().run();
                            close();
                        }}
                    />
                    <div className="h-px bg-[#e0e0e0] dark:bg-[#3c3c3c]" />
                    <ColorSection
                        label="Highlight Color"
                        colors={HIGHLIGHT_COLORS}
                        labelPrefix="Highlight"
                        active={highlightColor}
                        resetLabel="Remove highlight"
                        onPick={(color) => {
                            editor.chain().focus().setHighlight({ color }).run();
                            close();
                        }}
                        onReset={() => {
                            editor.chain().focus().unsetHighlight().run();
                            close();
                        }}
                    />
                </div>
            )}
        />
    );
}
