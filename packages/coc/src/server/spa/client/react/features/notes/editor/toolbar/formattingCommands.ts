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
export type ToolbarSlot = 'highlight' | 'heading' | 'list' | 'tableInsert' | 'insertPdf' | 'find';

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
        cmd({ id: 'bold', label: 'Bold', icon: 'B', activeName: 'bold', run: (e) => chain(e).toggleBold().run() }),
        cmd({ id: 'italic', label: 'Italic', icon: 'I', activeName: 'italic', run: (e) => chain(e).toggleItalic().run() }),
        cmd({ id: 'strike', label: 'Strikethrough', icon: 'S̶', activeName: 'strike', run: (e) => chain(e).toggleStrike().run() }),
        slot('highlight'),
    ],
    // Headings
    [slot('heading')],
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
    [
        cmd({ id: 'alignLeft', label: 'Align left', icon: '⫷', activeName: 'textStyle', activeAttrs: { textAlign: 'left' }, run: (e) => chain(e).setTextAlign('left').run() }),
        cmd({ id: 'alignCenter', label: 'Align center', icon: '≡', activeName: 'textStyle', activeAttrs: { textAlign: 'center' }, run: (e) => chain(e).setTextAlign('center').run() }),
        cmd({ id: 'alignRight', label: 'Align right', icon: '⫸', activeName: 'textStyle', activeAttrs: { textAlign: 'right' }, run: (e) => chain(e).setTextAlign('right').run() }),
        cmd({ id: 'alignJustify', label: 'Justify', icon: '☰', activeName: 'textStyle', activeAttrs: { textAlign: 'justify' }, run: (e) => chain(e).setTextAlign('justify').run() }),
    ],
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

/** Every command descriptor across all groups, in render order. */
export const FORMATTING_COMMANDS: ToolbarCommandDescriptor[] = FORMATTING_GROUPS
    .flat()
    .flatMap((item) => (item.kind === 'command' ? [item.command] : []));

/** Whether a descriptor should render as pressed for the current selection. */
export function isCommandActive(editor: Editor, command: ToolbarCommandDescriptor): boolean {
    return command.activeName ? editor.isActive(command.activeName, command.activeAttrs) : false;
}
