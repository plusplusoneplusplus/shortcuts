/**
 * SourceCanvasFolderBody — read-only folder explorer body for the docked source
 * canvas (AC-01 + AC-02). Renders a `SourceCanvasDirectoryState` (loaded by
 * `useSourceCanvasDirectory`) as the panel body:
 *  - `loading`  → spinner;
 *  - `error`    → "Couldn't load <path>" with the failure reason;
 *  - `success`  → the folder's immediate children (API order preserved), an
 *    explicit empty state when there are none, and a small truncated indicator
 *    when the API capped the listing.
 *
 * Entries are navigable in-place (AC-02): clicking a subfolder re-opens that
 * folder in the same panel; clicking a file opens the existing read-only source
 * viewer. Both go through `onNavigate`, which the host wires to the same
 * `sourceCanvas.open` used by chat-link clicks — entries carry the listing's
 * workspace id so navigation resolves through the same chosen workspace.
 */
import { Spinner } from '../../../ui/Spinner';
import type { ExplorerTreeEntry } from '@plusplusoneplusplus/coc-client';
import type { SourceCanvasDirectoryState } from './useSourceCanvasDirectory';
import type { SourceCanvasFileRef } from './types';

export interface SourceCanvasFolderBodyProps {
    /** Folder listing state (loading / success / error). */
    dir: SourceCanvasDirectoryState;
    /** Folder name shown in the loading message. */
    folderName: string;
    /** Open another ref in the same panel (subfolder → dir, file → code). */
    onNavigate: (ref: SourceCanvasFileRef) => void;
}

function entryRef(entry: ExplorerTreeEntry, wsId: string): SourceCanvasFileRef {
    return {
        // `entry.path` is workspace-relative; the listing's `wsId` anchors it to
        // the same workspace the folder was listed from.
        fullPath: entry.path,
        displayPath: entry.path,
        wsId: wsId || undefined,
        kind: entry.type === 'dir' ? 'dir' : 'code',
    };
}

function FolderIcon() {
    return <span aria-hidden="true">📁</span>;
}

function FileIcon() {
    return <span aria-hidden="true">📄</span>;
}

export function SourceCanvasFolderBody({ dir, folderName, onNavigate }: SourceCanvasFolderBodyProps) {
    if (dir.status === 'loading') {
        return (
            <div
                className="flex items-center gap-2 p-4 text-xs text-[#848484]"
                data-testid="source-canvas-dir-loading"
            >
                <Spinner size="sm" /> Loading {folderName}…
            </div>
        );
    }

    if (dir.status === 'error') {
        return (
            <div className="p-4 text-xs" data-testid="source-canvas-dir-error">
                <div
                    className="font-medium text-[#cc4444] dark:text-[#f48771]"
                    data-testid="source-canvas-dir-error-msg"
                >
                    {`Couldn't load ${dir.resolvedPath || folderName}`}
                </div>
                {dir.error && <div className="mt-1 text-[#848484]">{dir.error}</div>}
            </div>
        );
    }

    if (dir.entries.length === 0) {
        return (
            <div className="p-4 text-xs text-[#848484]" data-testid="source-canvas-dir-empty">
                This folder is empty.
            </div>
        );
    }

    return (
        <div data-testid="source-canvas-dir-listing">
            {dir.truncated && (
                <div
                    className="px-3 py-1.5 text-[11px] text-[#848484] border-b border-[#e0e0e0] dark:border-[#3c3c3c]"
                    data-testid="source-canvas-dir-truncated"
                >
                    Showing a partial listing — this folder has more entries than can be shown.
                </div>
            )}
            <ul className="py-1">
                {dir.entries.map((entry) => (
                    <li key={`${entry.type}:${entry.path}`}>
                        <button
                            type="button"
                            data-testid="source-canvas-dir-entry"
                            data-entry-path={entry.path}
                            data-entry-type={entry.type}
                            onClick={() => onNavigate(entryRef(entry, dir.wsId))}
                            className="w-full flex items-center gap-1.5 px-3 py-1.5 lg:py-1 text-left text-sm lg:text-xs cursor-pointer text-[#1e1e1e] dark:text-[#cccccc] hover:bg-black/[0.04] dark:hover:bg-white/[0.04]"
                        >
                            <span className="flex-shrink-0">
                                {entry.type === 'dir' ? <FolderIcon /> : <FileIcon />}
                            </span>
                            <span className="truncate">{entry.name}</span>
                        </button>
                    </li>
                ))}
            </ul>
        </div>
    );
}
