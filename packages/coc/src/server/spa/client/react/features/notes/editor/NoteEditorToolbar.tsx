import { useState, useRef, useEffect } from 'react';
import type { ReactNode } from 'react';
import type { Editor } from '@tiptap/react';

export interface NoteEditorToolbarProps {
    editor: Editor | null;
    /** When true, formatting buttons are hidden but the right-end controls (mode toggle, comments) remain visible. */
    hidden?: boolean;
    commentsPanelOpen?: boolean;
    onToggleCommentsPanel?: () => void;
    commentCount?: number;
    /** Inline Rich/Source mode toggle rendered at the right end of the toolbar. */
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
}

// ── Highlight color palette ─────────────────────────────────────────────────

export const HIGHLIGHT_COLORS = [
    { name: 'Yellow', color: '#fff3b0' },
    { name: 'Green', color: '#b9f5d0' },
    { name: 'Blue', color: '#bde0fe' },
    { name: 'Pink', color: '#ffc8dd' },
    { name: 'Orange', color: '#ffd6a5' },
    { name: 'Purple', color: '#e0c3fc' },
] as const;

const DEFAULT_HIGHLIGHT_COLOR = HIGHLIGHT_COLORS[0].color;

// ── Toolbar button helper ───────────────────────────────────────────────────

interface TBProps {
    editor: Editor;
    label: string;
    icon: string;
    command: () => void;
    activeName?: string;
    activeAttrs?: Record<string, unknown>;
}

function TB({ editor, label, icon, command, activeName, activeAttrs }: TBProps) {
    const isActive = activeName ? editor.isActive(activeName, activeAttrs) : false;
    return (
        <button
            type="button"
            title={label}
            aria-label={label}
            className={
                'h-7 w-7 rounded flex items-center justify-center text-xs hover:bg-[#e0e0e0] dark:hover:bg-[#505050] ' +
                (isActive ? 'bg-[#e8e8e8] dark:bg-[#3c3c3c] font-bold' : '')
            }
            onMouseDown={(e) => {
                e.preventDefault(); // keep editor focus
                command();
            }}
        >
            {icon}
        </button>
    );
}

function Sep() {
    return <div className="w-px h-5 mx-1 bg-[#e0e0e0] dark:bg-[#3c3c3c]" />;
}

// ── Highlight button with color picker ───────────────────────────────────────

interface HighlightButtonProps {
    editor: Editor;
}

function HighlightButton({ editor }: HighlightButtonProps) {
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLDivElement>(null);

    // Close on outside click or Escape
    useEffect(() => {
        if (!open) return;
        function handleClick(e: MouseEvent) {
            if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
        }
        function handleKey(e: KeyboardEvent) {
            if (e.key === 'Escape') setOpen(false);
        }
        document.addEventListener('mousedown', handleClick);
        document.addEventListener('keydown', handleKey);
        return () => {
            document.removeEventListener('mousedown', handleClick);
            document.removeEventListener('keydown', handleKey);
        };
    }, [open]);

    const isActive = editor.isActive('highlight');

    return (
        <div className="relative" ref={ref}>
            <div className="flex items-center">
                {/* Main highlight toggle */}
                <button
                    type="button"
                    title="Highlight"
                    aria-label="Highlight"
                    className={
                        'h-7 px-1 rounded-l flex items-center justify-center text-xs hover:bg-[#e0e0e0] dark:hover:bg-[#505050] ' +
                        (isActive ? 'bg-[#e8e8e8] dark:bg-[#3c3c3c] font-bold' : '')
                    }
                    onMouseDown={(e) => {
                        e.preventDefault();
                        editor.chain().focus().toggleHighlight({ color: DEFAULT_HIGHLIGHT_COLOR }).run();
                    }}
                >
                    <span
                        className="inline-block w-4 h-4 leading-4 text-center rounded-sm text-[10px] font-bold"
                        style={{ backgroundColor: isActive ? (editor.getAttributes('highlight').color ?? DEFAULT_HIGHLIGHT_COLOR) : DEFAULT_HIGHLIGHT_COLOR }}
                    >
                        HL
                    </span>
                </button>
                {/* Dropdown arrow */}
                <button
                    type="button"
                    title="Highlight colors"
                    aria-label="Highlight colors"
                    className="h-7 w-4 rounded-r flex items-center justify-center text-[10px] hover:bg-[#e0e0e0] dark:hover:bg-[#505050]"
                    onMouseDown={(e) => {
                        e.preventDefault();
                        setOpen((v) => !v);
                    }}
                >
                    ▾
                </button>
            </div>

            {/* Color picker dropdown */}
            {open && (
                <div
                    className="absolute top-full left-0 mt-1 z-50 flex gap-1 p-1.5 rounded shadow-md border border-[#e0e0e0] dark:border-[#3c3c3c] bg-white dark:bg-[#1e1e1e]"
                    data-testid="highlight-color-picker"
                >
                    {HIGHLIGHT_COLORS.map(({ name, color }) => (
                        <button
                            key={color}
                            type="button"
                            title={name}
                            aria-label={`Highlight ${name}`}
                            className="w-6 h-6 rounded-sm border border-[#ccc] dark:border-[#555] hover:scale-110 transition-transform"
                            style={{ backgroundColor: color }}
                            onMouseDown={(e) => {
                                e.preventDefault();
                                editor.chain().focus().toggleHighlight({ color }).run();
                                setOpen(false);
                            }}
                        />
                    ))}
                    {/* Remove highlight */}
                    <button
                        type="button"
                        title="Remove highlight"
                        aria-label="Remove highlight"
                        className="w-6 h-6 rounded-sm border border-[#ccc] dark:border-[#555] hover:scale-110 transition-transform flex items-center justify-center text-xs text-[#888]"
                        onMouseDown={(e) => {
                            e.preventDefault();
                            editor.chain().focus().unsetHighlight().run();
                            setOpen(false);
                        }}
                    >
                        ✕
                    </button>
                </div>
            )}
        </div>
    );
}

// ── Table contextual controls ───────────────────────────────────────────────

interface TableControlsProps {
    editor: Editor;
}

function TableControls({ editor }: TableControlsProps) {
    if (!editor.isActive('table')) return null;

    const tc = () => editor.chain().focus();

    return (
        <>
            <Sep />
            {/* Column operations */}
            <button type="button" title="Add column before" aria-label="Add column before"
                className="h-7 px-1.5 rounded text-xs hover:bg-[#e0e0e0] dark:hover:bg-[#505050]"
                onMouseDown={(e) => { e.preventDefault(); tc().addColumnBefore().run(); }}>
                ◀+
            </button>
            <button type="button" title="Add column after" aria-label="Add column after"
                className="h-7 px-1.5 rounded text-xs hover:bg-[#e0e0e0] dark:hover:bg-[#505050]"
                onMouseDown={(e) => { e.preventDefault(); tc().addColumnAfter().run(); }}>
                +▶
            </button>
            <button type="button" title="Delete column" aria-label="Delete column"
                className="h-7 px-1.5 rounded text-xs hover:bg-[#e0e0e0] dark:hover:bg-[#505050]"
                onMouseDown={(e) => { e.preventDefault(); tc().deleteColumn().run(); }}>
                ✕col
            </button>
            <Sep />
            {/* Row operations */}
            <button type="button" title="Add row before" aria-label="Add row before"
                className="h-7 px-1.5 rounded text-xs hover:bg-[#e0e0e0] dark:hover:bg-[#505050]"
                onMouseDown={(e) => { e.preventDefault(); tc().addRowBefore().run(); }}>
                ▲+
            </button>
            <button type="button" title="Add row after" aria-label="Add row after"
                className="h-7 px-1.5 rounded text-xs hover:bg-[#e0e0e0] dark:hover:bg-[#505050]"
                onMouseDown={(e) => { e.preventDefault(); tc().addRowAfter().run(); }}>
                +▼
            </button>
            <button type="button" title="Delete row" aria-label="Delete row"
                className="h-7 px-1.5 rounded text-xs hover:bg-[#e0e0e0] dark:hover:bg-[#505050]"
                onMouseDown={(e) => { e.preventDefault(); tc().deleteRow().run(); }}>
                ✕row
            </button>
            <Sep />
            {/* Table-level */}
            <button type="button" title="Delete table" aria-label="Delete table"
                className="h-7 px-1.5 rounded text-xs hover:bg-[#e0e0e0] dark:hover:bg-[#505050]"
                onMouseDown={(e) => { e.preventDefault(); tc().deleteTable().run(); }}>
                ✕tbl
            </button>
        </>
    );
}

// ── Main toolbar ────────────────────────────────────────────────────────────

export function NoteEditorToolbar({ editor, hidden, commentsPanelOpen, onToggleCommentsPanel, commentCount, modeToggle, aiEditCount, aiEditsVisible, onDismissAiEdits, onToggleAiEdits, toolbarRight }: NoteEditorToolbarProps) {
    if (!editor) return null;

    const c = editor.chain().focus.bind(editor.chain());

    function handleLink() {
        if (editor!.isActive('link')) {
            editor!.chain().focus().unsetLink().run();
            return;
        }
        const href = prompt('Enter URL:');
        if (href) {
            editor!.chain().focus().setLink({ href }).run();
        }
    }

    return (
        <div
            className="flex items-center gap-0.5 px-2 py-1 border-b border-[#e0e0e0] dark:border-[#3c3c3c] flex-wrap"
            role="toolbar"
            aria-label="Formatting toolbar"
            data-testid="note-editor-toolbar"
        >
            {/* Formatting buttons — hidden in source mode */}
            {!hidden && (
                <>
                    {/* Text formatting */}
                    <TB editor={editor} label="Bold" icon="B" command={() => c().toggleBold().run()} activeName="bold" />
                    <TB editor={editor} label="Italic" icon="I" command={() => c().toggleItalic().run()} activeName="italic" />
                    <TB editor={editor} label="Strikethrough" icon="S̶" command={() => c().toggleStrike().run()} activeName="strike" />
                    <HighlightButton editor={editor} />
                    <Sep />

                    {/* Headings */}
                    <TB editor={editor} label="Heading 1" icon="H1" command={() => c().toggleHeading({ level: 1 }).run()} activeName="heading" activeAttrs={{ level: 1 }} />
                    <TB editor={editor} label="Heading 2" icon="H2" command={() => c().toggleHeading({ level: 2 }).run()} activeName="heading" activeAttrs={{ level: 2 }} />
                    <TB editor={editor} label="Heading 3" icon="H3" command={() => c().toggleHeading({ level: 3 }).run()} activeName="heading" activeAttrs={{ level: 3 }} />
                    <Sep />

                    {/* Lists */}
                    <TB editor={editor} label="Bullet list" icon="•" command={() => c().toggleBulletList().run()} activeName="bulletList" />
                    <TB editor={editor} label="Ordered list" icon="1." command={() => c().toggleOrderedList().run()} activeName="orderedList" />
                    <TB editor={editor} label="Task list" icon="☑" command={() => c().toggleTaskList().run()} activeName="taskList" />
                    <Sep />

                    {/* Block elements */}
                    <TB editor={editor} label="Blockquote" icon="❝" command={() => c().toggleBlockquote().run()} activeName="blockquote" />
                    <TB editor={editor} label="Code" icon="<>" command={() => c().toggleCode().run()} activeName="code" />
                    <TB editor={editor} label="Code block" icon="⌘" command={() => c().toggleCodeBlock().run()} activeName="codeBlock" />
                    <Sep />

                    {/* Misc */}
                    <TB editor={editor} label="Link" icon="🔗" command={handleLink} activeName="link" />
                    <TB editor={editor} label="Horizontal rule" icon="—" command={() => c().setHorizontalRule().run()} />

                    {/* Table — insert */}
                    <Sep />
                    <TB
                        editor={editor}
                        label="Insert table"
                        icon="⊞"
                        command={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}
                    />

                    {/* Table — contextual operations (visible only inside a table) */}
                    <TableControls editor={editor} />
                </>
            )}

            {/* Right-end controls — always visible */}
            {(onToggleCommentsPanel || modeToggle || toolbarRight || (aiEditCount ?? 0) > 0) && (
                <>
                    <div className="ml-auto" />
                    {(aiEditCount ?? 0) > 0 && onToggleAiEdits && (
                        <button
                            type="button"
                            className={
                                'text-xs px-2 py-0.5 rounded ' +
                                (aiEditsVisible
                                    ? 'bg-[#e8f5e9] dark:bg-[#1b3a1b] text-green-700 dark:text-green-300'
                                    : 'text-[#888] hover:text-[#333] dark:hover:text-white')
                            }
                            onClick={onToggleAiEdits}
                            title={aiEditsVisible ? 'Hide AI changes' : 'Show AI changes'}
                            data-testid="ai-edits-toggle"
                        >
                            ✦ {aiEditCount}
                        </button>
                    )}
                    {onToggleCommentsPanel && (
                        <button
                            type="button"
                            className={
                                'text-xs px-2 py-0.5 rounded ' +
                                (commentsPanelOpen
                                    ? 'bg-[#e8e8e8] dark:bg-[#3c3c3c] text-[#333] dark:text-white'
                                    : 'text-[#888] hover:text-[#333] dark:hover:text-white')
                            }
                            onClick={onToggleCommentsPanel}
                            data-testid="comments-panel-toggle"
                            aria-label={commentsPanelOpen ? 'Hide comments' : 'Show comments'}
                        >
                            💬{(commentCount ?? 0) > 0 && (
                                <span className="ml-1 text-[10px]" data-testid="comments-toggle-count">
                                    {commentCount}
                                </span>
                            )}
                        </button>
                    )}
                    {toolbarRight}
                    {modeToggle}
                </>
            )}
        </div>
    );
}
