import type { Editor } from '@tiptap/react';

export interface NoteEditorToolbarProps {
    editor: Editor | null;
}

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

export function NoteEditorToolbar({ editor }: NoteEditorToolbarProps) {
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
            {/* Text formatting */}
            <TB editor={editor} label="Bold" icon="B" command={() => c().toggleBold().run()} activeName="bold" />
            <TB editor={editor} label="Italic" icon="I" command={() => c().toggleItalic().run()} activeName="italic" />
            <TB editor={editor} label="Strikethrough" icon="S̶" command={() => c().toggleStrike().run()} activeName="strike" />
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
        </div>
    );
}
