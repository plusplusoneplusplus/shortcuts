/**
 * SourceCanvasTreeBody — read-only expandable file-tree body for the docked
 * source canvas. Renders a `SourceCanvasTreeState` (from `useSourceCanvasTree`):
 *  - `loading`  → spinner;
 *  - `error`    → "Couldn't load <path>" with the failure reason;
 *  - `success`  → the root folder's children as an expandable tree, an explicit
 *    empty state when there are none, and a small truncated indicator when the
 *    root listing was capped.
 *
 * Folders expand/collapse in place (chevron → `tree.toggle`, lazily fetching
 * children), showing a per-folder spinner while loading and an inline message on
 * a per-folder failure. Files stay click-to-open: clicking a file calls
 * `onNavigate` with a `kind: 'code'` ref carrying the tree's workspace id, so it
 * opens in the existing read-only viewer resolved through the same workspace.
 *
 * The root-level states reuse the flat listing's `data-testid`s
 * (`source-canvas-dir-loading` / `-error` / `-empty` / `-listing` / `-truncated`)
 * so surrounding host tests keep working; individual rows use
 * `source-canvas-tree-node`.
 */
import { Spinner } from '../../../ui/Spinner';
import { cn } from '../../../ui/cn';
import type { ExplorerTreeEntry } from '@plusplusoneplusplus/coc-client';
import type { SourceCanvasTreeState } from './useSourceCanvasTree';
import type { SourceCanvasFileRef } from './types';

export interface SourceCanvasTreeBodyProps {
    /** Tree state (root load status + per-folder expansion). */
    tree: SourceCanvasTreeState;
    /** Root folder name shown in the loading message. */
    folderName: string;
    /** Open a file ref in the same panel (files → read-only code viewer). */
    onNavigate: (ref: SourceCanvasFileRef) => void;
}

function fileRefFor(entry: ExplorerTreeEntry, wsId: string): SourceCanvasFileRef {
    return {
        // `entry.path` is workspace-relative; the tree's `wsId` anchors it to the
        // same workspace the tree was listed from.
        fullPath: entry.path,
        displayPath: entry.path,
        wsId: wsId || undefined,
        kind: 'code',
    };
}

function FolderIcon() {
    return <span aria-hidden="true">📁</span>;
}

function FileIcon() {
    return <span aria-hidden="true">📄</span>;
}

const rowClass =
    'w-full flex items-center gap-1.5 pr-3 py-1.5 lg:py-1 text-left text-sm lg:text-xs ' +
    'cursor-pointer text-[#1e1e1e] dark:text-[#cccccc] hover:bg-black/[0.04] dark:hover:bg-white/[0.04]';

interface TreeRowsProps {
    entries: ExplorerTreeEntry[];
    depth: number;
    tree: SourceCanvasTreeState;
    onNavigate: (ref: SourceCanvasFileRef) => void;
}

function TreeRows({ entries, depth, tree, onNavigate }: TreeRowsProps) {
    return (
        <>
            {entries.map((entry) => (
                <TreeRow
                    key={`${entry.type}:${entry.path}`}
                    entry={entry}
                    depth={depth}
                    tree={tree}
                    onNavigate={onNavigate}
                />
            ))}
        </>
    );
}

function TreeRow({ entry, depth, tree, onNavigate }: {
    entry: ExplorerTreeEntry;
    depth: number;
    tree: SourceCanvasTreeState;
    onNavigate: (ref: SourceCanvasFileRef) => void;
}) {
    const isDir = entry.type === 'dir';
    const isExpanded = isDir && tree.expanded.has(entry.path);
    const isLoading = isDir && tree.loadingPaths.has(entry.path);
    const folderError = isDir ? tree.errorPaths.get(entry.path) : undefined;
    const children = isDir ? tree.childrenMap.get(entry.path) : undefined;
    const indent = { paddingLeft: `${12 + depth * 16}px` };
    const childIndent = { paddingLeft: `${12 + (depth + 1) * 16}px` };

    return (
        <>
            <button
                type="button"
                data-testid="source-canvas-tree-node"
                data-entry-path={entry.path}
                data-entry-type={entry.type}
                {...(isDir ? { 'aria-expanded': isExpanded } : {})}
                onClick={() => (isDir ? tree.toggle(entry.path) : onNavigate(fileRefFor(entry, tree.wsId)))}
                className={rowClass}
                style={indent}
            >
                {isDir ? (
                    <span
                        data-testid="source-canvas-tree-chevron"
                        className={cn(
                            'w-3 flex-shrink-0 text-[10px] text-[#848484] inline-block transition-transform',
                            isExpanded && 'rotate-90',
                        )}
                        aria-hidden="true"
                    >
                        ▶
                    </span>
                ) : (
                    <span className="w-3 flex-shrink-0 inline-block" aria-hidden="true" />
                )}
                <span className="flex-shrink-0">{isDir ? <FolderIcon /> : <FileIcon />}</span>
                <span className="truncate">{entry.name}</span>
                {isLoading && <Spinner size="sm" className="ml-auto" />}
            </button>
            {isExpanded && folderError && (
                <div
                    data-testid="source-canvas-tree-node-error"
                    className="pr-3 py-1 text-[11px] text-[#cc4444] dark:text-[#f48771]"
                    style={childIndent}
                >
                    {folderError}
                </div>
            )}
            {isExpanded && children && children.length > 0 && (
                <TreeRows entries={children} depth={depth + 1} tree={tree} onNavigate={onNavigate} />
            )}
            {isExpanded && !isLoading && !folderError && children && children.length === 0 && (
                <div
                    className="pr-3 py-1 text-[11px] text-[#848484]"
                    style={childIndent}
                    data-testid="source-canvas-tree-node-empty"
                >
                    Empty
                </div>
            )}
        </>
    );
}

export function SourceCanvasTreeBody({ tree, folderName, onNavigate }: SourceCanvasTreeBodyProps) {
    if (tree.status === 'loading') {
        return (
            <div
                className="flex items-center gap-2 p-4 text-xs text-[#848484]"
                data-testid="source-canvas-dir-loading"
            >
                <Spinner size="sm" /> Loading {folderName}…
            </div>
        );
    }

    if (tree.status === 'error') {
        return (
            <div className="p-4 text-xs" data-testid="source-canvas-dir-error">
                <div
                    className="font-medium text-[#cc4444] dark:text-[#f48771]"
                    data-testid="source-canvas-dir-error-msg"
                >
                    {`Couldn't load ${tree.resolvedPath || folderName}`}
                </div>
                {tree.error && <div className="mt-1 text-[#848484]">{tree.error}</div>}
            </div>
        );
    }

    if (tree.rootEntries.length === 0) {
        return (
            <div className="p-4 text-xs text-[#848484]" data-testid="source-canvas-dir-empty">
                This folder is empty.
            </div>
        );
    }

    return (
        <div data-testid="source-canvas-dir-listing">
            {tree.truncated && (
                <div
                    className="px-3 py-1.5 text-[11px] text-[#848484] border-b border-[#e0e0e0] dark:border-[#3c3c3c]"
                    data-testid="source-canvas-dir-truncated"
                >
                    Showing a partial listing — this folder has more entries than can be shown.
                </div>
            )}
            <div className="py-1">
                <TreeRows entries={tree.rootEntries} depth={0} tree={tree} onNavigate={onNavigate} />
            </div>
        </div>
    );
}
