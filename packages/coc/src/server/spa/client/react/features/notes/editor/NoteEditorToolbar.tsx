import type { ReactNode } from 'react';
import type { Editor } from '@tiptap/react';
import type { TocEntry } from './noteTocUtils';
import { Sep } from './toolbar/ToolbarDropdown';
import { FormattingToolbar } from './toolbar/FormattingToolbar';
import { FindReplacePanel } from './toolbar/FindReplacePanel';
import { useFindReplaceToolbarController } from './toolbar/useFindReplaceToolbarController';
import { TableToolbarControls } from './toolbar/TableToolbarControls';
import { ToolbarHostActions, hasHostActions } from './toolbar/ToolbarHostActions';

// Re-exported so the toolbar module stays the entry point for these constants.
export { HIGHLIGHT_COLORS, TEXT_COLORS, HEADING_LEVELS } from './toolbar/FormattingToolbar';
export { TABLE_PICKER_COLS, TABLE_PICKER_ROWS } from './toolbar/TableToolbarControls';

export interface NoteEditorToolbarProps {
    editor: Editor | null;
    /** When true, formatting buttons are hidden but the mode toggle and right-end controls (comments) remain visible. */
    hidden?: boolean;
    commentsPanelOpen?: boolean;
    onToggleCommentsPanel?: () => void;
    commentCount?: number;
    /** Inline Rich/Source mode toggle rendered at the left end of the toolbar. */
    modeToggle?: ReactNode;
    /** Number of active AI edit regions in the editor. */
    aiEditCount?: number;
    /** Called to dismiss AI edit decorations permanently. */
    onDismissAiEdits?: () => void;
    /** Called to toggle AI edit decoration visibility. */
    onToggleAiEdits?: () => void;
    /** Whether AI edit decorations are currently shown. */
    aiEditsVisible?: boolean;
    /** Extra content rendered at the right end of the toolbar (before the mode toggle). */
    toolbarRight?: ReactNode;
    /** Called to manually refresh/reload the note from disk. When provided, a ↻ button is rendered. */
    onRefresh?: () => void;
    /** When true, the refresh button is disabled (load in progress). */
    refreshing?: boolean;
    /** Whether the AI chat panel is currently open. */
    chatPanelOpen?: boolean;
    /** Called to toggle the AI chat panel. When provided, the 🤖 button is rendered. */
    onToggleChatPanel?: () => void;
    /** When set, keeps the AI chat button visible but disabled with this reason. */
    chatDisabledReason?: string;
    /** When true, the 🤖 button is tinted blue to indicate an existing chat history. */
    hasExistingChat?: boolean;
    /** Whether the TOC panel is currently open. */
    tocOpen?: boolean;
    /** Called to toggle the TOC panel. When provided, the ≡ button is rendered. */
    onToggleToc?: () => void;
    /** Heading entries for the TOC. Empty list disables the button. */
    tocEntries?: TocEntry[];
    /** Currently active (scroll-spy) heading index, or null. */
    tocActiveIndex?: number | null;
    /** Called when the user clicks a TOC entry to jump to it. */
    onTocJump?: (entry: TocEntry) => void;
    /** Called when the "Insert PDF" button is clicked (opens the hidden file picker). */
    onInsertPdf?: () => void;
}

/**
 * Layout for the notes editing command surface.
 *
 * Composition only: the formatting group, the find/replace row, the contextual
 * table strip and the host-owned right-end actions each own their own state, so
 * this component just decides which rows exist and in what order.
 */
export function NoteEditorToolbar(props: NoteEditorToolbarProps) {
    const { editor, hidden, modeToggle, onInsertPdf } = props;
    const find = useFindReplaceToolbarController(editor, hidden);

    if (!editor) return null;

    return (
        <>
            <div
                className="flex items-center gap-0.5 px-2 py-1 border-b border-[#e0e0e0] dark:border-[#3c3c3c] flex-wrap text-[#1e1e1e] dark:text-[#cccccc]"
                role="toolbar"
                aria-label="Formatting toolbar"
                data-testid="note-editor-toolbar"
            >
                {/* Mode toggle — leftmost, always visible */}
                {modeToggle && (
                    <>
                        {modeToggle}
                        {!hidden && <Sep />}
                    </>
                )}

                {/* Formatting buttons — hidden in source mode */}
                {!hidden && (
                    <FormattingToolbar
                        editor={editor}
                        findOpen={find.open}
                        onToggleFind={find.toggleFind}
                        onInsertPdf={onInsertPdf}
                    />
                )}

                {/* Right-end controls — always visible */}
                {hasHostActions(props) && <ToolbarHostActions {...props} />}
            </div>
            {/* Find & replace — secondary row, shown while the panel is toggled on */}
            {!hidden && find.open && <FindReplacePanel editor={editor} onClose={find.closeFind} />}
            {/* Table controls — secondary row, visible only when inside a table */}
            {!hidden && <TableToolbarControls editor={editor} />}
        </>
    );
}
