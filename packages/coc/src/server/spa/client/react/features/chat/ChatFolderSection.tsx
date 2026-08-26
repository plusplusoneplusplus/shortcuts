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
import React from 'react';
import { cn } from '../../ui';
import { chatFolderColorHex, type ChatFolderRow } from './chat-folder-tree';

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

export interface ChatFolderSectionProps {
    rows: ChatFolderRow[];
    /** Toggle a folder's collapsed state. */
    onToggleFolder: (folderId: string) => void;
    /** Renders one member row; the caller owns row chrome, selection and menus. */
    renderMember: (entry: any, members: any[]) => React.ReactNode;
    /** Section header collapse state (the whole FOLDERS section). */
    expanded: boolean;
    onToggleSection: () => void;
    /** Opens the folder ⋯ menu. Omitted until AC-05 wires the menu up. */
    onOpenFolderMenu?: (folderId: string, event: React.MouseEvent) => void;
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
}: ChatFolderSectionProps): React.ReactElement | null {
    if (rows.length === 0) {return null;}

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
                    {rows.map(row => (
                        <ChatFolderTreeRow
                            key={row.folder.id}
                            row={row}
                            onToggleFolder={onToggleFolder}
                            renderMember={renderMember}
                            onOpenFolderMenu={onOpenFolderMenu}
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
}

function ChatFolderTreeRow({ row, onToggleFolder, renderMember, onOpenFolderMenu }: ChatFolderTreeRowProps): React.ReactElement {
    const { folder, members, memberCount, runningCount, isEmpty, collapsed } = row;
    const hex = chatFolderColorHex(folder.color);
    const expanded = !collapsed;

    return (
        <div data-testid="chat-folder" data-folder-id={folder.id} data-expanded={expanded ? 'true' : 'false'}>
            <div
                role="button"
                tabIndex={0}
                className="group/folder h-[24px] flex items-center gap-1.5 px-3 cursor-pointer select-none hover:bg-[#f5f5f5] dark:hover:bg-[#252526] transition-colors"
                onClick={() => onToggleFolder(folder.id)}
                onKeyDown={event => {
                    if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        onToggleFolder(folder.id);
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
                <span
                    className={cn(
                        'min-w-0 flex-1 truncate text-[12px] leading-none',
                        isEmpty
                            ? 'text-[#a0a0a0] dark:text-[#6f6f6f]'
                            : 'text-[#1e1e1e] dark:text-[#cccccc]',
                    )}
                    data-testid="chat-folder-name"
                >
                    {folder.name}
                </span>
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
            {expanded && members.length > 0 && (
                <div
                    className="flex flex-col ml-3 pl-2 border-l border-[#e0e0e0] dark:border-[#3c3c3c]"
                    data-testid="chat-folder-children"
                >
                    {members.map(entry => renderMember(entry, members))}
                </div>
            )}
            {expanded && members.length === 0 && (
                <div
                    className="mx-3 my-1 px-2 py-2 rounded-[4px] border border-dashed border-[#e0e0e0] dark:border-[#3c3c3c] text-[10px] leading-tight text-[#848484] dark:text-[#a0a0a0]"
                    data-testid="chat-folder-empty"
                >
                    Empty — drag chats here, or start a chat in this folder.
                </div>
            )}
        </div>
    );
}
