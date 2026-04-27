/**
 * NoteConflictBanner — displayed when a save is rejected due to an
 * mtime mismatch (409 Conflict). Lets the user choose between keeping
 * their local edits or loading the disk version.
 */

interface NoteConflictBannerProps {
    onKeepMine: () => void;
    onLoadDisk: () => void;
}

export function NoteConflictBanner({ onKeepMine, onLoadDisk }: NoteConflictBannerProps) {
    return (
        <div
            className="flex items-start gap-3 px-4 py-3
                       bg-amber-50 dark:bg-amber-900/20
                       border-l-4 border-amber-400 dark:border-amber-500
                       text-sm text-amber-900 dark:text-amber-100"
            data-testid="note-conflict-banner"
        >
            <span className="text-amber-500 mt-0.5 shrink-0">⚠</span>
            <div className="flex-1">
                <p className="font-medium">This note was modified externally since you last loaded it.</p>
                <p className="text-amber-700 dark:text-amber-300 text-xs mt-0.5">
                    Your unsaved changes have not been lost.
                </p>
            </div>
            <div className="flex gap-2 shrink-0">
                <button
                    onClick={onKeepMine}
                    className="px-3 py-1 rounded text-xs font-medium
                               bg-amber-500 hover:bg-amber-600 text-white
                               transition-colors"
                    data-testid="conflict-keep-mine-btn"
                >
                    Keep my version
                </button>
                <button
                    onClick={onLoadDisk}
                    className="px-3 py-1 rounded text-xs font-medium
                               border border-amber-400 hover:bg-amber-100
                               dark:hover:bg-amber-900/40
                               transition-colors"
                    data-testid="conflict-load-disk-btn"
                >
                    Load disk version
                </button>
            </div>
        </div>
    );
}
