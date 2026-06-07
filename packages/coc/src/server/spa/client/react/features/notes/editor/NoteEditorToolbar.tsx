import { useState, useRef, useEffect } from 'react';
import type { ReactNode } from 'react';
import type { Editor } from '@tiptap/react';
import type { TocEntry } from './noteTocUtils';
import { NoteTocPanel } from './NoteTocPanel';

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
    /** Called to manually refresh/reload the note from disk. When provided, a ↻ button is rendered. */
    onRefresh?: () => void;
    /** When true, the refresh button is disabled (load in progress). */
    refreshing?: boolean;
    /** Whether the AI chat panel is currently open. */
    chatPanelOpen?: boolean;
    /** Called to toggle the AI chat panel. When provided, the 🤖 button is rendered. */
    onToggleChatPanel?: () => void;
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
    /** Extra classes (e.g. wider width for heading buttons). */
    className?: string;
}

/** Render text-mark icons with appropriate HTML formatting. */
function renderIcon(icon: string): ReactNode {
    switch (icon) {
        case 'B': return <strong className="font-bold">B</strong>;
        case 'I': return <em className="italic">I</em>;
        case 'S̶': return <s>S</s>;
        default: return icon;
    }
}

function TB({ editor, label, icon, command, activeName, activeAttrs, className }: TBProps) {
    const isActive = activeName ? editor.isActive(activeName, activeAttrs) : false;
    return (
        <button
            type="button"
            title={label}
            aria-label={label}
            className={
                'h-7 w-7 rounded flex items-center justify-center text-xs hover:bg-[#e0e0e0] dark:hover:bg-[#505050] ' +
                (isActive ? 'bg-[#e8e8e8] dark:bg-[#3c3c3c] font-bold' : '') +
                (className ? ' ' + className : '')
            }
            onMouseDown={(e) => {
                e.preventDefault(); // keep editor focus
                command();
            }}
        >
            {renderIcon(icon)}
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
    const btnCls = "h-7 px-1.5 rounded text-xs hover:bg-[#e0e0e0] dark:hover:bg-[#505050]";

    return (
        <div
            className="flex items-center gap-0.5 px-2 py-0.5 border-b border-[#e0e0e0] dark:border-[#3c3c3c] bg-[#fafafa] dark:bg-[#2a2a2a] text-xs"
            data-testid="table-controls-row"
        >
            {/* Column operations */}
            <button type="button" title="Add column before" aria-label="Add column before"
                className={btnCls}
                onMouseDown={(e) => { e.preventDefault(); tc().addColumnBefore().run(); }}>
                Add Col ←
            </button>
            <button type="button" title="Add column after" aria-label="Add column after"
                className={btnCls}
                onMouseDown={(e) => { e.preventDefault(); tc().addColumnAfter().run(); }}>
                Add Col →
            </button>
            <button type="button" title="Delete column" aria-label="Delete column"
                className={btnCls}
                onMouseDown={(e) => { e.preventDefault(); tc().deleteColumn().run(); }}>
                Del Col
            </button>
            <Sep />
            {/* Row operations */}
            <button type="button" title="Add row before" aria-label="Add row before"
                className={btnCls}
                onMouseDown={(e) => { e.preventDefault(); tc().addRowBefore().run(); }}>
                Add Row ↑
            </button>
            <button type="button" title="Add row after" aria-label="Add row after"
                className={btnCls}
                onMouseDown={(e) => { e.preventDefault(); tc().addRowAfter().run(); }}>
                Add Row ↓
            </button>
            <button type="button" title="Delete row" aria-label="Delete row"
                className={btnCls}
                onMouseDown={(e) => { e.preventDefault(); tc().deleteRow().run(); }}>
                Del Row
            </button>
            <Sep />
            {/* Table-level */}
            <button type="button" title="Delete table" aria-label="Delete table"
                className={btnCls}
                onMouseDown={(e) => { e.preventDefault(); tc().deleteTable().run(); }}>
                Del Table
            </button>
        </div>
    );
}

// ── Main toolbar ────────────────────────────────────────────────────────────

export function NoteEditorToolbar({ editor, hidden, commentsPanelOpen, onToggleCommentsPanel, commentCount, modeToggle, aiEditCount, aiEditsVisible, onDismissAiEdits, onToggleAiEdits, toolbarRight, onRefresh, refreshing, chatPanelOpen, onToggleChatPanel, hasExistingChat, tocOpen, onToggleToc, tocEntries = [], tocActiveIndex = null, onTocJump }: NoteEditorToolbarProps) {
    const tocRef = useRef<HTMLDivElement>(null);

    if (!editor) return null;

    const hasHeadings = tocEntries.length > 0;
    const c = () => editor.chain().focus();

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
        <>
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
                    <TB editor={editor} label="Heading 1" icon="H1" command={() => c().toggleHeading({ level: 1 }).run()} activeName="heading" activeAttrs={{ level: 1 }} className="w-8 text-sm" />
                    <TB editor={editor} label="Heading 2" icon="H2" command={() => c().toggleHeading({ level: 2 }).run()} activeName="heading" activeAttrs={{ level: 2 }} className="w-8 text-xs font-semibold" />
                    <TB editor={editor} label="Heading 3" icon="H3" command={() => c().toggleHeading({ level: 3 }).run()} activeName="heading" activeAttrs={{ level: 3 }} className="w-8 text-xs" />
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

                    {/* Alignment */}
                    <Sep />
                    <TB editor={editor} label="Align left"    icon="⫷" command={() => c().setTextAlign('left').run()}    activeName="textStyle" activeAttrs={{ textAlign: 'left' }} />
                    <TB editor={editor} label="Align center"  icon="≡" command={() => c().setTextAlign('center').run()}  activeName="textStyle" activeAttrs={{ textAlign: 'center' }} />
                    <TB editor={editor} label="Align right"   icon="⫸" command={() => c().setTextAlign('right').run()}   activeName="textStyle" activeAttrs={{ textAlign: 'right' }} />
                    <TB editor={editor} label="Justify"       icon="☰" command={() => c().setTextAlign('justify').run()} activeName="textStyle" activeAttrs={{ textAlign: 'justify' }} />

                    {/* Indent */}
                    <Sep />
                    <TB editor={editor} label="Increase indent" icon="→|" command={() => editor.chain().focus().increaseIndent().run()} />
                    <TB editor={editor} label="Decrease indent" icon="|←" command={() => editor.chain().focus().decreaseIndent().run()} />
                </>
            )}

            {/* Right-end controls — always visible */}
            {(onToggleCommentsPanel || modeToggle || toolbarRight || onRefresh || onToggleChatPanel || onToggleToc || (aiEditCount ?? 0) > 0) && (
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
                    {onToggleChatPanel && (
                        <button
                            type="button"
                            className={
                                'text-xs px-2 py-0.5 rounded ' +
                                (chatPanelOpen
                                    ? 'bg-[#e8e8e8] dark:bg-[#3c3c3c] text-[#333] dark:text-white'
                                    : hasExistingChat
                                        ? 'text-[#0078d4] dark:text-[#3794ff] hover:bg-[#e0eef9] dark:hover:bg-[#1a3a5c]'
                                        : 'text-[#888] hover:text-[#333] dark:hover:text-white')
                            }
                            onClick={onToggleChatPanel}
                            data-testid="chat-panel-toggle"
                            aria-label={chatPanelOpen ? 'Hide AI chat' : hasExistingChat ? 'Continue AI chat' : 'Show AI chat'}
                            title={chatPanelOpen ? 'Hide AI chat' : hasExistingChat ? 'Continue AI chat' : 'Show AI chat'}
                        >
                            🤖
                        </button>
                    )}
                    {onToggleToc && (
                        <div className="relative" ref={tocRef}>
                            <button
                                type="button"
                                title={hasHeadings ? 'Table of contents' : 'No headings in this note'}
                                aria-label="Table of contents"
                                disabled={!hasHeadings}
                                className={
                                    'text-xs px-2 py-0.5 rounded ' +
                                    (tocOpen && hasHeadings
                                        ? 'bg-[#e8e8e8] dark:bg-[#3c3c3c] text-[#333] dark:text-white'
                                        : !hasHeadings
                                            ? 'opacity-40 cursor-not-allowed text-[#888]'
                                            : 'text-[#888] hover:text-[#333] dark:hover:text-white')
                                }
                                onClick={onToggleToc}
                                data-testid="toc-toggle-btn"
                            >
                                ≡
                            </button>
                            {tocOpen && hasHeadings && onTocJump && (
                                <NoteTocPanel
                                    entries={tocEntries}
                                    activeIndex={tocActiveIndex}
                                    onJump={onTocJump}
                                    onClose={onToggleToc}
                                />
                            )}
                        </div>
                    )}
                    {onRefresh && (
                        <button
                            type="button"
                            className="text-xs px-2 py-0.5 rounded text-[#888] hover:text-[#333] dark:hover:text-white disabled:opacity-40 disabled:cursor-not-allowed"
                            onClick={onRefresh}
                            disabled={refreshing}
                            aria-label="Refresh"
                            title="Refresh (Ctrl+Shift+R)"
                            data-testid="note-editor-refresh-btn"
                        >
                            ↻
                        </button>
                    )}
                    {toolbarRight}
                    {modeToggle}
                </>
            )}
        </div>
        {/* Table controls — secondary row, visible only when inside a table */}
        {!hidden && <TableControls editor={editor} />}
        </>
    );
}
