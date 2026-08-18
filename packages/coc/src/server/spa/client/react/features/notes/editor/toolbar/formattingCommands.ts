import type { Editor } from '@tiptap/react';

/**
 * One formatting button in the toolbar.
 *
 * `run` receives the editor rather than closing over it so the descriptors stay
 * plain module-level data — they can be asserted on directly (labels, icons,
 * grouping, active-state wiring) without rendering a toolbar.
 */
export interface ToolbarCommandDescriptor {
    /** Stable identifier — also the React key. */
    id: string;
    /** Used for both `title` and `aria-label`; part of the public surface. */
    label: string;
    icon: string;
    run: (editor: Editor) => void;
    /** Node/mark name passed to `editor.isActive` for the pressed state. */
    activeName?: string;
    activeAttrs?: Record<string, unknown>;
}

/**
 * Toolbar items that are not a plain command button: each is a component with
 * its own state (a dropdown, a host callback, or the find panel toggle). They
 * sit in the group list so the separator layout stays in one place.
 */
export type ToolbarSlot =
    | 'color'
    | 'fontFamily'
    | 'fontSize'
    | 'heading'
    | 'list'
    | 'align'
    | 'tableInsert'
    | 'insertPdf'
    | 'find';

export type ToolbarItem =
    | { kind: 'command'; command: ToolbarCommandDescriptor }
    | { kind: 'slot'; slot: ToolbarSlot };

const cmd = (command: ToolbarCommandDescriptor): ToolbarItem => ({ kind: 'command', command });
const slot = (s: ToolbarSlot): ToolbarItem => ({ kind: 'slot', slot: s });

/** `editor.chain().focus()` — every formatting command keeps the caret. */
const chain = (editor: Editor) => editor.chain().focus();

/**
 * Toggling a link is the one command that asks the user for input: an active
 * link is removed outright, otherwise the URL is prompted for and an empty or
 * cancelled prompt leaves the document untouched.
 */
export function toggleLink(editor: Editor): void {
    if (editor.isActive('link')) {
        chain(editor).unsetLink().run();
        return;
    }
    const href = prompt('Enter URL:');
    if (href) {
        chain(editor).setLink({ href }).run();
    }
}

/**
 * The formatting half of the toolbar, in render order. Each inner array is one
 * visual group; a separator is drawn between groups, so reordering here is the
 * only edit needed to reorder the toolbar.
 */
export const FORMATTING_GROUPS: ToolbarItem[][] = [
    // Text formatting
    [
        // Size leads the group: it is the one control here that is read before
        // it is used, so it sits where the eye starts rather than after Bold.
        slot('fontSize'),
        cmd({ id: 'bold', label: 'Bold', icon: 'B', activeName: 'bold', run: (e) => chain(e).toggleBold().run() }),
        cmd({ id: 'italic', label: 'Italic', icon: 'I', activeName: 'italic', run: (e) => chain(e).toggleItalic().run() }),
        cmd({ id: 'strike', label: 'Strikethrough', icon: 'S̶', activeName: 'strike', run: (e) => chain(e).toggleStrike().run() }),
        // The two marks are mutually exclusive in the schema, so toggling one
        // off the other needs no extra wiring here.
        cmd({ id: 'superscript', label: 'Superscript', icon: 'x²', activeName: 'superscript', run: (e) => chain(e).toggleSuperscript().run() }),
        cmd({ id: 'subscript', label: 'Subscript', icon: 'x₂', activeName: 'subscript', run: (e) => chain(e).toggleSubscript().run() }),
        slot('color'),
    ],
    // Text appearance: font first, then heading level — the two controls that
    // change how a run reads rather than what it means.
    [slot('fontFamily'), slot('heading')],
    // Lists
    [slot('list')],
    // Block elements
    [
        cmd({ id: 'blockquote', label: 'Blockquote', icon: '❝', activeName: 'blockquote', run: (e) => chain(e).toggleBlockquote().run() }),
        cmd({ id: 'code', label: 'Code', icon: '<>', activeName: 'code', run: (e) => chain(e).toggleCode().run() }),
        cmd({ id: 'codeBlock', label: 'Code block', icon: '⌘', activeName: 'codeBlock', run: (e) => chain(e).toggleCodeBlock().run() }),
    ],
    // Misc
    [
        cmd({ id: 'link', label: 'Link', icon: '🔗', activeName: 'link', run: toggleLink }),
        cmd({ id: 'horizontalRule', label: 'Horizontal rule', icon: '—', run: (e) => chain(e).setHorizontalRule().run() }),
    ],
    // Insert
    [slot('tableInsert'), slot('insertPdf')],
    // Alignment
    [slot('align')],
    // Indent
    [
        cmd({ id: 'increaseIndent', label: 'Increase indent', icon: '→|', run: (e) => chain(e).increaseIndent().run() }),
        cmd({ id: 'decreaseIndent', label: 'Decrease indent', icon: '|←', run: (e) => chain(e).decreaseIndent().run() }),
    ],
    // Find & replace — part of the formatting group, so it is hidden in source
    // mode along with the rest (the raw-markdown editor is a different editor
    // instance the extension does not reach).
    [slot('find')],
];

export type AlignValue = 'left' | 'center' | 'right' | 'justify';

/**
 * The rows of the alignment dropdown, in menu order.
 *
 * Kept here rather than in the toolbar component for the same reason as the
 * command descriptors: the label and the value each row sets stay plain data
 * that tests can assert on without rendering anything. The glyph is drawn by
 * `AlignIcon`, keyed off `value`, so it does not live here.
 */
export interface AlignOption {
    /** Stable identifier — also the React key. */
    id: string;
    label: string;
    /** The value handed to `setTextAlign`, and the `textAlign` attribute to match on. */
    value: AlignValue;
    testId: string;
}

export const ALIGN_OPTIONS: readonly AlignOption[] = [
    { id: 'alignLeft', label: 'Align left', value: 'left', testId: 'align-item-left' },
    { id: 'alignCenter', label: 'Align center', value: 'center', testId: 'align-item-center' },
    { id: 'alignRight', label: 'Align right', value: 'right', testId: 'align-item-right' },
    { id: 'alignJustify', label: 'Justify', value: 'justify', testId: 'align-item-justify' },
] as const;

/**
 * The alignment in effect for the current selection, or null when none matches.
 *
 * The attribute lives on the paragraph/heading node, not on a mark, so this
 * asks `isActive` for the attribute alone — `isActive('textStyle', {...})`
 * never matches and left every alignment control permanently unpressed.
 */
export function activeAlignOption(editor: Editor): AlignOption | null {
    return ALIGN_OPTIONS.find((option) => editor.isActive({ textAlign: option.value })) ?? null;
}

/** Every command descriptor across all groups, in render order. */
export const FORMATTING_COMMANDS: ToolbarCommandDescriptor[] = FORMATTING_GROUPS
    .flat()
    .flatMap((item) => (item.kind === 'command' ? [item.command] : []));

/** Whether a descriptor should render as pressed for the current selection. */
export function isCommandActive(editor: Editor, command: ToolbarCommandDescriptor): boolean {
    return command.activeName ? editor.isActive(command.activeName, command.activeAttrs) : false;
}
