/**
 * ChatFolderSection — the explorer-style "Folders" tree section of the chat
 * list (AC-04).
 *
 * One renderer for all four list surfaces (Activity, Chats, Tasks, and a repo
 * group's Workspace tab): they all go through `ChatListPane`, so this component
 * is rendered from a single place and the section JSX is never duplicated per
 * mode.
 *
 * Members reuse the existing nested-row treatment (`isGroupChild`) rather than
 * a second nesting style — the list already has one visual language for "this
 * row hangs off the row above it".
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { cn } from '../../ui';
import { chatFolderColorHex, type ChatFolderRow } from './chat-folder-tree';
import type { ChatFolderDropTarget, ChatFolderDropZone } from './chat-folder-drag';
import {
    CHAT_FOLDER_COLORS,
    clampChatFolderNameInput,
    normalizeChatFolderName,
    type ChatFolderColor,
} from '../../../../../processes/chat-folder-validation';

/** Per-depth indent, in px. v1 renders folders at depth 0 and members at depth 1. */
export const CHAT_FOLDER_INDENT_PX = 14;

interface FolderGlyphProps {
    color: string;
    open: boolean;
}

/**
 * Inline SVG folder glyph, tinted with the folder color. Deliberately not an
 * emoji: emoji render inconsistently across platforms and cannot take the
 * folder color.
 */
function FolderGlyph({ color, open }: FolderGlyphProps): React.ReactElement {
    return (
        <svg
            width="14"
            height="14"
            viewBox="0 0 14 14"
            aria-hidden="true"
            className="shrink-0"
            data-testid="chat-folder-glyph"
            data-open={open ? 'true' : 'false'}
        >
            {open ? (
                <path
                    d="M1 3.2c0-.55.45-1 1-1h3.1c.3 0 .58.13.77.36l.7.84H11c.55 0 1 .45 1 1v.8H4.3c-.44 0-.83.29-.96.71L1.6 10.9A1 1 0 0 1 1 10V3.2Zm2.9 3.3H13l-1.6 4.6c-.14.42-.53.7-.97.7H2.6c.44 0 .83-.28.97-.7l1.5-4.3a.5.5 0 0 1 .47-.34l-1.64.04Z"
                    fill={color}
                    fillOpacity="0.85"
                />
            ) : (
                <path
                    d="M1 3.2c0-.55.45-1 1-1h3.1c.3 0 .58.13.77.36l.7.84H12c.55 0 1 .45 1 1V10.8c0 .55-.45 1-1 1H2c-.55 0-1-.45-1-1V3.2Z"
                    fill={color}
                    fillOpacity="0.85"
                />
            )}
        </svg>
    );
}

export interface ChatFolderChipProps {
    name: string;
    color: string;
    /** Chip text is truncated; the full folder name stays available as a title. */
    maxChars?: number;
}

/**
 * Truncated folder-name chip, shown on a filed row that also appears in
 * Running / Queued (and on flattened search results in AC-08) so the row still
 * says where it lives.
 */
export function ChatFolderChip({ name, color, maxChars = 14 }: ChatFolderChipProps): React.ReactElement {
    const hex = chatFolderColorHex(color);
    const label = name.length > maxChars ? `${name.slice(0, maxChars - 1)}…` : name;
    return (
        <span
            className="shrink-0 inline-flex items-center gap-1 rounded-[3px] px-1 py-px text-[9.5px] font-mono leading-none max-w-[90px]"
            style={{ color: hex, backgroundColor: `${hex}1f` }}
            title={name}
            data-testid="chat-folder-chip"
            data-folder-name={name}
        >
            <span className="truncate">{label}</span>
        </span>
    );
}

// ============================================================================
// Inline create / rename (AC-05)
// ============================================================================

export interface ChatFolderNameEditorProps {
    /** Seed text — empty for create, the current name for rename. */
    initialName: string;
    /** Create shows the 6 preset swatches; rename reuses the row without them. */
    showColorPicker: boolean;
    initialColor?: ChatFolderColor;
    onCommit: (name: string, color: ChatFolderColor) => void;
    onCancel: () => void;
    /** Drives the soft "already exists" hint. Duplicate names are still allowed. */
    isDuplicateName?: (name: string) => boolean;
    testId: string;
}

/**
 * One inline editor row, shared by create and rename.
 *
 * Commit rules (identical for both, by decision): Enter commits, Esc cancels,
 * blur with text commits, blur while empty cancels. Validation is the same
 * `normalizeChatFolderName` the server runs, so the client never sends a name
 * the server would reject.
 */
export function ChatFolderNameEditor({
    initialName,
    showColorPicker,
    initialColor,
    onCommit,
    onCancel,
    isDuplicateName,
    testId,
}: ChatFolderNameEditorProps): React.ReactElement {
    const [name, setName] = useState(initialName);
    const [color, setColor] = useState<ChatFolderColor>(initialColor ?? CHAT_FOLDER_COLORS[0]);
    const inputRef = useRef<HTMLInputElement>(null);
    // Esc fires before the resulting blur, and a blur with text commits — so the
    // cancel has to suppress the blur that follows it or Esc would still save.
    const settledRef = useRef(false);

    useEffect(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
    }, []);

    const commit = useCallback((value: string, chosen: ChatFolderColor) => {
        if (settledRef.current) {return;}
        settledRef.current = true;
        const parsed = normalizeChatFolderName(value);
        // An empty name is a cancel, not an error — the same rule the server
        // states by rejecting it.
        if (!parsed.ok) {onCancel(); return;}
        onCommit(parsed.value, chosen);
    }, [onCommit, onCancel]);

    const cancel = useCallback(() => {
        if (settledRef.current) {return;}
        settledRef.current = true;
        onCancel();
    }, [onCancel]);

    const duplicate = isDuplicateName?.(name) ?? false;

    return (
        <div className="px-3 py-1 flex flex-col gap-0.5" data-testid={testId}>
            <div className="h-[24px] flex items-center gap-1.5">
                {showColorPicker && (
                    <div className="flex items-center gap-1 shrink-0" role="radiogroup" aria-label="Folder color">
                        {CHAT_FOLDER_COLORS.map(preset => (
                            <button
                                key={preset}
                                type="button"
                                role="radio"
                                aria-checked={preset === color}
                                aria-label={preset}
                                title={preset}
                                className={cn(
                                    'w-[10px] h-[10px] rounded-full shrink-0',
                                    preset === color && 'ring-2 ring-offset-1 ring-[#0078d4] dark:ring-[#3794ff] ring-offset-white dark:ring-offset-[#1e1e1e]',
                                )}
                                style={{ backgroundColor: chatFolderColorHex(preset) }}
                                // mousedown would blur the input first and commit the row.
                                onMouseDown={event => event.preventDefault()}
                                onClick={() => setColor(preset)}
                                data-testid={`chat-folder-color-swatch-${preset}`}
                            />
                        ))}
                    </div>
                )}
                <input
                    ref={inputRef}
                    type="text"
                    value={name}
                    onChange={event => setName(clampChatFolderNameInput(event.target.value))}
                    onKeyDown={event => {
                        if (event.key === 'Enter') {
                            event.preventDefault();
                            // The folder row above is a role=button that toggles on
                            // Enter — the keystroke must not reach it.
                            event.stopPropagation();
                            commit(name, color);
                        } else if (event.key === 'Escape') {
                            event.preventDefault();
                            event.stopPropagation();
                            cancel();
                        }
                    }}
                    onBlur={() => {
                        // Blur with text commits; blur while empty cancels.
                        if (name.trim().length === 0) {cancel();} else {commit(name, color);}
                    }}
                    placeholder="Folder name"
                    aria-label="Folder name"
                    className="min-w-0 flex-1 h-[20px] rounded-[3px] border border-[#e0e0e0] dark:border-[#474749] bg-white dark:bg-[#252526] px-1.5 text-[12px] leading-none text-[#1e1e1e] dark:text-[#cccccc] outline-none focus:border-[#0078d4] dark:focus:border-[#3794ff]"
                    data-testid="chat-folder-name-input"
                />
            </div>
            <div
                className="pl-1 text-[10px] leading-none font-mono text-[#848484] dark:text-[#a0a0a0]"
                data-testid={duplicate ? 'chat-folder-duplicate-hint' : 'chat-folder-editor-hint'}
            >
                {duplicate ? 'A folder with this name already exists' : 'Enter to save · Esc to cancel'}
            </div>
        </div>
    );
}

export interface ChatFolderSectionProps {
    rows: ChatFolderRow[];
    /** Toggle a folder's collapsed state. */
    onToggleFolder: (folderId: string) => void;
    /** Renders one member row; the caller owns row chrome, selection and menus. */
    renderMember: (entry: any, members: any[]) => React.ReactNode;
    /** Section header collapse state (the whole FOLDERS section). */
    expanded: boolean;
    onToggleSection: () => void;
    /** Opens the folder ⋯ menu. Omitted when the caller supplies no menu. */
    onOpenFolderMenu?: (folderId: string, event: React.MouseEvent) => void;

    // ── Inline create / rename (AC-05) ──────────────────────────────────────
    /** True while the create row is open at the top of the section. */
    creating?: boolean;
    onCommitCreate?: (name: string, color: ChatFolderColor) => void;
    onCancelCreate?: () => void;
    /** The folder whose name is currently an input, if any. */
    renamingFolderId?: string | null;
    onStartRename?: (folderId: string) => void;
    onCommitRename?: (folderId: string, name: string) => void;
    onCancelRename?: () => void;
    /** Drives the soft duplicate-name hint; duplicates are still allowed. */
    isDuplicateName?: (name: string, excludeId?: string) => boolean;

    // ── Drag and drop (AC-07) ───────────────────────────────────────────────
    /** The folder currently offering a drop, and what dropping would do. */
    dropTarget?: ChatFolderDropTarget | null;
    /** The folder row being dragged, rendered faded while it travels. */
    draggingFolderId?: string | null;
    /** Omitted ⇒ folder rows are not draggable and expose no drop targets. */
    onFolderDragStart?: (folderId: string, event: React.DragEvent) => void;
    onFolderDragEnd?: () => void;
    onFolderDragOver?: (folderId: string, zone: ChatFolderDropZone, event: React.DragEvent) => void;
    onFolderDragLeave?: (folderId: string, zone: ChatFolderDropZone, event: React.DragEvent) => void;
    onFolderDrop?: (folderId: string, zone: ChatFolderDropZone, event: React.DragEvent) => void;
}

/**
 * Render the Folders section, or nothing at all when there are no folders to
 * show — zero folders means no section, not an empty header.
 */
export function ChatFolderSection({
    rows,
    onToggleFolder,
    renderMember,
    expanded,
    onToggleSection,
    onOpenFolderMenu,
    creating,
    onCommitCreate,
    onCancelCreate,
    renamingFolderId,
    onStartRename,
    onCommitRename,
    onCancelRename,
    isDuplicateName,
    dropTarget,
    draggingFolderId,
    onFolderDragStart,
    onFolderDragEnd,
    onFolderDragOver,
    onFolderDragLeave,
    onFolderDrop,
}: ChatFolderSectionProps): React.ReactElement | null {
    // Zero folders means no section — but the create row has to have somewhere
    // to live, so an open create keeps the section mounted.
    if (rows.length === 0 && !creating) {return null;}

    return (
        <div data-section="folders" className="-mx-2 md:-mx-4">
            <button
                type="button"
                className="sticky top-0 z-[2] w-full flex items-center justify-between px-3 py-1 border-b backdrop-blur-md backdrop-saturate-150 bg-white/[0.94] dark:bg-[#1e1e1e]/[0.94] border-[#e0e0e0]/80 dark:border-[#3c3c3c]/80 hover:bg-[#f5f5f5] dark:hover:bg-[#252526] transition-colors"
                onClick={onToggleSection}
                data-testid="chat-folders-section-toggle"
                aria-expanded={expanded}
            >
                <span className="inline-flex items-center gap-1.5 text-[10px] leading-none font-mono font-semibold uppercase tracking-[0.1em] text-[#848484] dark:text-[#a0a0a0]">
                    <span className="text-[10px]">{expanded ? '▼' : '▶'}</span>
                    Folders
                </span>
                <span className="text-[10px] leading-none font-mono tabular-nums text-[#848484] dark:text-[#a0a0a0]">{rows.length}</span>
            </button>
            {expanded && (
                <div className="flex flex-col">
                    {creating && onCommitCreate && onCancelCreate && (
                        <ChatFolderNameEditor
                            initialName=""
                            showColorPicker
                            onCommit={onCommitCreate}
                            onCancel={onCancelCreate}
                            isDuplicateName={name => isDuplicateName?.(name) ?? false}
                            testId="chat-folder-create-row"
                        />
                    )}
                    {rows.map(row => (
                        <ChatFolderTreeRow
                            key={row.folder.id}
                            row={row}
                            onToggleFolder={onToggleFolder}
                            renderMember={renderMember}
                            onOpenFolderMenu={onOpenFolderMenu}
                            renaming={renamingFolderId === row.folder.id}
                            onStartRename={onStartRename}
                            onCommitRename={onCommitRename}
                            onCancelRename={onCancelRename}
                            isDuplicateName={isDuplicateName}
                            dropMode={dropTarget?.folderId === row.folder.id ? dropTarget.mode : null}
                            dragging={draggingFolderId === row.folder.id}
                            onFolderDragStart={onFolderDragStart}
                            onFolderDragEnd={onFolderDragEnd}
                            onFolderDragOver={onFolderDragOver}
                            onFolderDragLeave={onFolderDragLeave}
                            onFolderDrop={onFolderDrop}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}

interface ChatFolderTreeRowProps {
    row: ChatFolderRow;
    onToggleFolder: (folderId: string) => void;
    renderMember: (entry: any, members: any[]) => React.ReactNode;
    onOpenFolderMenu?: (folderId: string, event: React.MouseEvent) => void;
    renaming?: boolean;
    onStartRename?: (folderId: string) => void;
    onCommitRename?: (folderId: string, name: string) => void;
    onCancelRename?: () => void;
    isDuplicateName?: (name: string, excludeId?: string) => boolean;
    /** What a drop right now would do to THIS folder, or null when it is not the target. */
    dropMode?: ChatFolderDropTarget['mode'] | null;
    dragging?: boolean;
    onFolderDragStart?: (folderId: string, event: React.DragEvent) => void;
    onFolderDragEnd?: () => void;
    onFolderDragOver?: (folderId: string, zone: ChatFolderDropZone, event: React.DragEvent) => void;
    onFolderDragLeave?: (folderId: string, zone: ChatFolderDropZone, event: React.DragEvent) => void;
    onFolderDrop?: (folderId: string, zone: ChatFolderDropZone, event: React.DragEvent) => void;
}

function ChatFolderTreeRow({
    row,
    onToggleFolder,
    renderMember,
    onOpenFolderMenu,
    renaming,
    onStartRename,
    onCommitRename,
    onCancelRename,
    isDuplicateName,
    dropMode,
    dragging,
    onFolderDragStart,
    onFolderDragEnd,
    onFolderDragOver,
    onFolderDragLeave,
    onFolderDrop,
}: ChatFolderTreeRowProps): React.ReactElement {
    const { folder, members, memberCount, runningCount, isEmpty, collapsed } = row;
    const hex = chatFolderColorHex(folder.color);
    const expanded = !collapsed;
    // A row with an open rename input must not be draggable: the drag would
    // swallow text selection inside the input.
    const dragEnabled = !!onFolderDragStart && !renaming;
    const bodyDropProps = onFolderDragOver && onFolderDrop
        ? {
            onDragOver: (event: React.DragEvent) => onFolderDragOver(folder.id, 'body', event),
            onDragLeave: (event: React.DragEvent) => onFolderDragLeave?.(folder.id, 'body', event),
            onDrop: (event: React.DragEvent) => onFolderDrop(folder.id, 'body', event),
        }
        : {};

    return (
        <div
            data-testid="chat-folder"
            data-folder-id={folder.id}
            data-expanded={expanded ? 'true' : 'false'}
            data-drop-mode={dropMode ?? undefined}
        >
            <div
                role="button"
                tabIndex={0}
                className={cn(
                    'group/folder h-[24px] flex items-center gap-1.5 px-3 cursor-pointer select-none hover:bg-[#f5f5f5] dark:hover:bg-[#252526] transition-colors',
                    dragging && 'opacity-40',
                    // Filing here: accent tint plus a dashed outline.
                    dropMode === 'into' && 'bg-[#0078d4]/[0.10] dark:bg-[#3794ff]/[0.14] outline outline-1 outline-dashed outline-[#0078d4] dark:outline-[#3794ff]',
                    // Reordering: a 2px insertion line only, no row tint.
                    dropMode === 'above' && 'border-t-2 border-t-[#0078d4] dark:border-t-[#3794ff]',
                    dropMode === 'below' && 'border-b-2 border-b-[#0078d4] dark:border-b-[#3794ff]',
                )}
                draggable={dragEnabled}
                onDragStart={dragEnabled ? event => onFolderDragStart?.(folder.id, event) : undefined}
                onDragEnd={dragEnabled ? () => onFolderDragEnd?.() : undefined}
                onDragOver={onFolderDragOver ? event => onFolderDragOver(folder.id, 'row', event) : undefined}
                onDragLeave={onFolderDragLeave ? event => onFolderDragLeave(folder.id, 'row', event) : undefined}
                onDrop={onFolderDrop ? event => onFolderDrop(folder.id, 'row', event) : undefined}
                onClick={() => onToggleFolder(folder.id)}
                onKeyDown={event => {
                    if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        onToggleFolder(folder.id);
                    } else if (event.key === 'F2' && onStartRename) {
                        event.preventDefault();
                        onStartRename(folder.id);
                    }
                }}
                aria-expanded={expanded}
                data-testid="chat-folder-row"
                title={folder.name}
            >
                <span className="w-3 shrink-0 text-[10px] leading-none text-[#848484] dark:text-[#a0a0a0]" aria-hidden="true">
                    {expanded ? '▼' : '▶'}
                </span>
                <FolderGlyph color={hex} open={expanded} />
                {renaming && onCommitRename && onCancelRename ? (
                    // Same row, no dialog and no layout shift: the label becomes
                    // an input in place.
                    <div className="min-w-0 flex-1" onClick={event => event.stopPropagation()}>
                        <ChatFolderNameEditor
                            initialName={folder.name}
                            showColorPicker={false}
                            initialColor={folder.color as ChatFolderColor}
                            onCommit={name => {
                                // Renaming to the identical string is a no-op, not a request.
                                if (name === folder.name) {onCancelRename();} else {onCommitRename(folder.id, name);}
                            }}
                            onCancel={onCancelRename}
                            isDuplicateName={name => isDuplicateName?.(name, folder.id) ?? false}
                            testId="chat-folder-rename-row"
                        />
                    </div>
                ) : (
                    <span
                        className={cn(
                            'min-w-0 flex-1 truncate text-[12px] leading-none',
                            isEmpty
                                ? 'text-[#a0a0a0] dark:text-[#6f6f6f]'
                                : 'text-[#1e1e1e] dark:text-[#cccccc]',
                        )}
                        data-testid="chat-folder-name"
                        onDoubleClick={event => {
                            if (!onStartRename) {return;}
                            event.stopPropagation();
                            onStartRename(folder.id);
                        }}
                    >
                        {folder.name}
                    </span>
                )}
                {runningCount > 0 && (
                    <span
                        className="shrink-0 inline-flex items-center gap-1 text-[10px] leading-none font-mono tabular-nums text-[#0078d4] dark:text-[#3794ff]"
                        data-testid="chat-folder-running-count"
                    >
                        <span className="w-[5px] h-[5px] rounded-full bg-[#0078d4] dark:bg-[#3794ff] animate-pulse" aria-hidden="true" />
                        {runningCount}
                    </span>
                )}
                <span
                    className="shrink-0 text-[10px] leading-none font-mono tabular-nums text-[#848484] dark:text-[#a0a0a0]"
                    data-testid="chat-folder-count"
                >
                    {memberCount}
                </span>
                {onOpenFolderMenu && (
                    <button
                        type="button"
                        className="shrink-0 w-3 text-[12px] leading-none text-[#848484] dark:text-[#a0a0a0] opacity-0 group-hover/folder:opacity-100 focus:opacity-100"
                        onClick={event => { event.stopPropagation(); onOpenFolderMenu(folder.id, event); }}
                        data-testid="chat-folder-menu-btn"
                        aria-label={`Folder actions for ${folder.name}`}
                    >⋯</button>
                )}
            </div>
            {dropMode === 'into' && (
                <div
                    className="px-3 py-0.5 text-[10px] leading-none font-mono text-[#0078d4] dark:text-[#3794ff]"
                    data-testid="chat-folder-drop-hint"
                >
                    {`Move into "${folder.name}"`}
                </div>
            )}
            {expanded && members.length > 0 && (
                <div
                    className="flex flex-col ml-3 pl-2 border-l border-[#e0e0e0] dark:border-[#3c3c3c]"
                    data-testid="chat-folder-children"
                    {...bodyDropProps}
                >
                    {members.map(entry => renderMember(entry, members))}
                </div>
            )}
            {expanded && members.length === 0 && (
                <div
                    className={cn(
                        'mx-3 my-1 px-2 py-2 rounded-[4px] border border-dashed text-[10px] leading-tight',
                        dropMode === 'into'
                            ? 'border-[#0078d4] dark:border-[#3794ff] bg-[#0078d4]/[0.08] dark:bg-[#3794ff]/[0.12] text-[#0078d4] dark:text-[#3794ff]'
                            : 'border-[#e0e0e0] dark:border-[#3c3c3c] text-[#848484] dark:text-[#a0a0a0]',
                    )}
                    data-testid="chat-folder-empty"
                    {...bodyDropProps}
                >
                    Empty — drag chats here, or start a chat in this folder.
                </div>
            )}
        </div>
    );
}
