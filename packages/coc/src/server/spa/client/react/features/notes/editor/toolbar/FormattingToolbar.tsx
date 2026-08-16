import { Fragment } from 'react';
import type { ReactNode } from 'react';
import type { Editor } from '@tiptap/react';
import { ToolbarDropdown, MenuItem, Sep } from './ToolbarDropdown';
import { ColorDropdown } from './ColorDropdown';
import { FontFamilyDropdown } from './FontFamilyDropdown';
import { TableInsertButton } from './TableToolbarControls';
import {
    ALIGN_OPTIONS,
    FORMATTING_GROUPS,
    activeAlignOption,
    isCommandActive,
    type ToolbarCommandDescriptor,
    type ToolbarItem,
} from './formattingCommands';

// ── Color palettes ──────────────────────────────────────────────────────────
// Live in `colorPalette.ts` so `noteMarkdown.ts` can read the default color
// without importing a React module; re-exported here for existing consumers.

export { HIGHLIGHT_COLORS, TEXT_COLORS, DEFAULT_HIGHLIGHT_COLOR } from '../colorPalette';

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

export function TB({ editor, label, icon, command, activeName, activeAttrs, className }: TBProps) {
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

// ── Heading dropdown ────────────────────────────────────────────────────────

export const HEADING_LEVELS = [1, 2, 3, 4, 5, 6] as const;

/** Menu labels are styled roughly at the weight/size of the heading they set. */
const HEADING_ITEM_CLS: Record<number, string> = {
    1: 'text-base font-bold',
    2: 'text-sm font-bold',
    3: 'text-sm font-semibold',
    4: 'text-xs font-semibold',
    5: 'text-xs',
    6: 'text-[11px] font-semibold text-[#666] dark:text-[#999]',
};

function HeadingDropdown({ editor }: { editor: Editor }) {
    const activeLevel = HEADING_LEVELS.find((level) => editor.isActive('heading', { level })) ?? null;

    return (
        <ToolbarDropdown
            menu
            menuLabel="Heading level"
            panelTestId="heading-dropdown-menu"
            panelClassName="p-1 min-w-[9rem]"
            renderTrigger={({ open, toggle, triggerRef }) => (
                <button
                    ref={triggerRef}
                    type="button"
                    title="Heading level"
                    aria-label="Heading level"
                    aria-haspopup="menu"
                    aria-expanded={open}
                    data-testid="heading-dropdown"
                    className={
                        'h-7 px-1 rounded flex items-center gap-0.5 text-xs hover:bg-[#e0e0e0] dark:hover:bg-[#505050] ' +
                        (activeLevel || open ? 'bg-[#e8e8e8] dark:bg-[#3c3c3c] ' : '') +
                        (activeLevel ? 'font-bold' : '')
                    }
                    onMouseDown={(e) => {
                        e.preventDefault(); // keep editor selection
                        toggle();
                    }}
                >
                    <span data-testid="heading-dropdown-label">{activeLevel ? `H${activeLevel}` : 'H'}</span>
                    <span className="text-[10px]">▾</span>
                </button>
            )}
            renderPanel={({ close }) => (
                <>
                    <MenuItem
                        checked={activeLevel === null}
                        testId="heading-item-paragraph"
                        onSelect={() => {
                            editor.chain().focus().setParagraph().run();
                            close();
                        }}
                    >
                        Paragraph
                    </MenuItem>
                    {HEADING_LEVELS.map((level) => (
                        <MenuItem
                            key={level}
                            checked={activeLevel === level}
                            testId={`heading-item-${level}`}
                            labelClassName={HEADING_ITEM_CLS[level]}
                            onSelect={() => {
                                editor.chain().focus().toggleHeading({ level }).run();
                                close();
                            }}
                        >
                            {`Heading ${level}`}
                        </MenuItem>
                    ))}
                </>
            )}
        />
    );
}

// ── List dropdown ───────────────────────────────────────────────────────────

const LIST_TYPES = [
    { name: 'bulletList', label: 'Bullet List', icon: '•', testId: 'list-item-bullet' },
    { name: 'orderedList', label: 'Ordered List', icon: '1.', testId: 'list-item-ordered' },
    { name: 'taskList', label: 'Task List', icon: '☑', testId: 'list-item-task' },
] as const;

function ListDropdown({ editor }: { editor: Editor }) {
    const active = LIST_TYPES.find((t) => editor.isActive(t.name)) ?? null;

    function runToggle(name: (typeof LIST_TYPES)[number]['name']) {
        const chain = editor.chain().focus();
        if (name === 'bulletList') chain.toggleBulletList().run();
        else if (name === 'orderedList') chain.toggleOrderedList().run();
        else chain.toggleTaskList().run();
    }

    return (
        <ToolbarDropdown
            menu
            menuLabel="List type"
            panelTestId="list-dropdown-menu"
            panelClassName="p-1 min-w-[9rem]"
            renderTrigger={({ open, toggle, triggerRef }) => (
                <button
                    ref={triggerRef}
                    type="button"
                    title="Lists"
                    aria-label="Lists"
                    aria-haspopup="menu"
                    aria-expanded={open}
                    data-testid="list-dropdown"
                    className={
                        'h-7 px-1 rounded flex items-center gap-0.5 text-xs hover:bg-[#e0e0e0] dark:hover:bg-[#505050] ' +
                        (active || open ? 'bg-[#e8e8e8] dark:bg-[#3c3c3c] ' : '') +
                        (active ? 'font-bold' : '')
                    }
                    onMouseDown={(e) => {
                        e.preventDefault(); // keep editor selection
                        toggle();
                    }}
                >
                    <span data-testid="list-dropdown-label">{active ? active.icon : '•'}</span>
                    <span className="text-[10px]">▾</span>
                </button>
            )}
            renderPanel={({ close }) => (
                <>
                    {LIST_TYPES.map(({ name, label, icon, testId }) => (
                        <MenuItem
                            key={name}
                            checked={active?.name === name}
                            testId={testId}
                            icon={icon}
                            onSelect={() => {
                                runToggle(name);
                                close();
                            }}
                        >
                            {label}
                        </MenuItem>
                    ))}
                </>
            )}
        />
    );
}

// ── Alignment dropdown ──────────────────────────────────────────────────────

function AlignDropdown({ editor }: { editor: Editor }) {
    const active = activeAlignOption(editor);

    return (
        <ToolbarDropdown
            menu
            menuLabel="Text alignment"
            panelTestId="align-dropdown-menu"
            panelClassName="p-1 min-w-[9rem]"
            renderTrigger={({ open, toggle, triggerRef }) => (
                <button
                    ref={triggerRef}
                    type="button"
                    title="Text alignment"
                    aria-label="Text alignment"
                    aria-haspopup="menu"
                    aria-expanded={open}
                    data-testid="align-dropdown"
                    className={
                        'h-7 px-1 rounded flex items-center gap-0.5 text-xs hover:bg-[#e0e0e0] dark:hover:bg-[#505050] ' +
                        (active || open ? 'bg-[#e8e8e8] dark:bg-[#3c3c3c] ' : '') +
                        (active ? 'font-bold' : '')
                    }
                    onMouseDown={(e) => {
                        e.preventDefault(); // keep editor selection
                        toggle();
                    }}
                >
                    <span data-testid="align-dropdown-label">{(active ?? ALIGN_OPTIONS[0]).icon}</span>
                    <span className="text-[10px]">▾</span>
                </button>
            )}
            renderPanel={({ close }) => (
                <>
                    {ALIGN_OPTIONS.map(({ id, label, icon, value, testId }) => (
                        <MenuItem
                            key={id}
                            checked={active?.value === value}
                            testId={testId}
                            icon={icon}
                            onSelect={() => {
                                editor.chain().focus().setTextAlign(value).run();
                                close();
                            }}
                        >
                            {label}
                        </MenuItem>
                    ))}
                </>
            )}
        />
    );
}

// ── Descriptor-driven formatting group rendering ────────────────────────────

export interface FormattingToolbarProps {
    editor: Editor;
    /** Whether the find/replace row is showing — drives the find button's pressed state. */
    findOpen: boolean;
    onToggleFind: () => void;
    /** When absent, the Insert PDF slot renders nothing. */
    onInsertPdf?: () => void;
}

function CommandButton({ editor, command }: { editor: Editor; command: ToolbarCommandDescriptor }) {
    return (
        <TB
            editor={editor}
            label={command.label}
            icon={command.icon}
            command={() => command.run(editor)}
            activeName={command.activeName}
            activeAttrs={command.activeAttrs}
        />
    );
}

/**
 * The formatting half of the toolbar, rendered from `FORMATTING_GROUPS`.
 *
 * Groups render in order with a separator after each non-empty group — the
 * trailing separator is omitted, and a group whose slots all render nothing
 * (Insert PDF without a handler) does not leave a stray rule behind.
 */
export function FormattingToolbar({ editor, findOpen, onToggleFind, onInsertPdf }: FormattingToolbarProps) {
    function renderItem(item: ToolbarItem, key: string): ReactNode {
        if (item.kind === 'command') {
            return <CommandButton key={key} editor={editor} command={item.command} />;
        }
        switch (item.slot) {
            case 'color':
                return <ColorDropdown key={key} editor={editor} />;
            case 'fontFamily':
                return <FontFamilyDropdown key={key} editor={editor} />;
            case 'heading':
                return <HeadingDropdown key={key} editor={editor} />;
            case 'list':
                return <ListDropdown key={key} editor={editor} />;
            case 'align':
                return <AlignDropdown key={key} editor={editor} />;
            case 'tableInsert':
                return <TableInsertButton key={key} editor={editor} />;
            case 'insertPdf':
                if (!onInsertPdf) return null;
                return (
                    <button
                        key={key}
                        type="button"
                        title="Insert PDF"
                        aria-label="Insert PDF"
                        data-testid="insert-pdf-btn"
                        className="h-7 w-7 rounded flex items-center justify-center text-xs hover:bg-[#e0e0e0] dark:hover:bg-[#505050]"
                        onMouseDown={(e) => {
                            e.preventDefault(); // keep editor focus
                            onInsertPdf();
                        }}
                    >
                        📄
                    </button>
                );
            case 'find':
                return (
                    <TB
                        key={key}
                        editor={editor}
                        label="Find and replace"
                        icon="🔍"
                        // Toggling off goes through the controller so the search
                        // is cleared, same as the panel's ✕ and Esc.
                        command={onToggleFind}
                        className={findOpen ? 'bg-[#e8e8e8] dark:bg-[#3c3c3c]' : ''}
                    />
                );
        }
    }

    const groups = FORMATTING_GROUPS
        .map((group, gi) => group.map((item, ii) => renderItem(item, `${gi}-${ii}`)).filter(Boolean))
        .filter((rendered) => rendered.length > 0);

    return (
        <>
            {groups.map((rendered, gi) => (
                <Fragment key={gi}>
                    {rendered}
                    {gi < groups.length - 1 && <Sep />}
                </Fragment>
            ))}
        </>
    );
}
