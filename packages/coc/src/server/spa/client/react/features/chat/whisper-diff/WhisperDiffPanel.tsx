/**
 * WhisperDiffPanel — inner chrome for the transient read-only whisper diff
 * panel (AC-03).
 *
 * Header shows the clicked file's name, its project-relative path, and a
 * "Whisper diff" source label so the surface is clearly the per-file edits
 * captured by a whisper group (not a persisted canvas). The body renders the
 * four explicit states produced by `useWhisperDiffState`:
 *   - `loading` → spinner (commit-diff fallback fetch in flight)
 *   - `success` → the unified diff via the shared `UnifiedDiffViewer`
 *   - `empty`   → nothing-to-show message (no reconstruction, no fallback)
 *   - `error`   → an explicit failure message (a fallback fetch threw)
 *
 * This is a read-only surface: no copy/reveal/comments/Ask-AI, no save, and no
 * canvas record is ever written. Layout (docked column vs mobile BottomSheet)
 * and resizing are owned by the host (`WhisperDiffDock`); this is inner chrome.
 */
import { Spinner } from '../../../ui/Spinner';
import { UnifiedDiffViewer } from '../../git/diff/UnifiedDiffViewer';
import { getSourceCanvasDisplayPath } from '../source-canvas/resolve';
import type { FileEdit } from '../conversation/tool-calls/toolGroupUtils';
import type { WhisperDiffState } from './useWhisperDiffState';

function basename(p: string): string {
    const normalized = p.replace(/\\/g, '/');
    return normalized.split('/').pop() || p;
}

const headerBtnClass =
    'shrink-0 flex items-center justify-center w-8 h-8 rounded text-[#848484] ' +
    'hover:text-[#1e1e1e] dark:hover:text-[#cccccc] hover:bg-black/[0.06] dark:hover:bg-white/[0.08]';

export interface WhisperDiffPanelProps {
    /** The clicked file's edit summary — drives the header (always present). */
    file: FileEdit;
    /** Renderable diff state from `useWhisperDiffState`. */
    state: WhisperDiffState;
    /** Current workspace root, used to show a project-relative path in the header. */
    workspaceRootPath?: string | null;
    /** Close the panel (X button). */
    onClose: () => void;
}

export function WhisperDiffPanel({
    file,
    state,
    workspaceRootPath,
    onClose,
}: WhisperDiffPanelProps) {
    const fullPath = file.path;
    const path = getSourceCanvasDisplayPath(fullPath, workspaceRootPath);
    const fileName = basename(path) || 'Diff';

    // `idle` only shows for the single render between the panel opening and the
    // diff effect resolving — treat it as loading so the body never flashes blank.
    const status = state.status === 'idle' ? 'loading' : state.status;

    return (
        <div
            className="flex flex-col h-full min-h-0 overflow-hidden bg-white dark:bg-[#1e1e1e]"
            data-testid="whisper-diff-panel"
        >
            <div className="px-3 py-2 border-b border-[#e0e0e0] dark:border-[#3c3c3c] bg-[#f8f8f8] dark:bg-[#252526] flex items-start justify-between gap-2">
                <div className="min-w-0">
                    <div className="flex items-center gap-2 min-w-0">
                        <div
                            className="text-sm font-semibold text-[#1e1e1e] dark:text-[#cccccc] truncate"
                            data-testid="whisper-diff-filename"
                        >
                            {fileName}
                        </div>
                        <span
                            className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-[#5a5a5a] bg-[#ececec] dark:text-[#9d9d9d] dark:bg-[#333335]"
                            data-testid="whisper-diff-source-label"
                        >
                            Whisper diff
                        </span>
                    </div>
                    <div
                        className="text-xs text-[#848484] truncate mt-0.5"
                        title={fullPath}
                        data-testid="whisper-diff-path"
                    >
                        {path}
                    </div>
                </div>
                <div className="flex items-center gap-0.5 shrink-0">
                    <button
                        type="button"
                        data-testid="whisper-diff-close-btn"
                        onClick={onClose}
                        className={headerBtnClass}
                        aria-label="Close"
                    >
                        ✕
                    </button>
                </div>
            </div>
            <div className="flex-1 min-h-0 overflow-auto" data-testid="whisper-diff-body">
                {status === 'loading' && (
                    <div
                        className="flex items-center gap-2 p-4 text-xs text-[#848484]"
                        data-testid="whisper-diff-loading"
                    >
                        <Spinner size="sm" /> Loading diff for {fileName}…
                    </div>
                )}
                {status === 'error' && (
                    <div className="p-4 text-xs" data-testid="whisper-diff-error">
                        <div className="font-medium text-[#cc4444] dark:text-[#f48771]">
                            {`Couldn't load the diff for ${fileName}`}
                        </div>
                        {state.error && (
                            <div className="mt-1 text-[#848484]">{state.error}</div>
                        )}
                    </div>
                )}
                {status === 'empty' && (
                    <div
                        className="p-4 text-xs text-[#848484]"
                        data-testid="whisper-diff-empty"
                    >
                        {state.error || 'No diff is available for this file.'}
                    </div>
                )}
                {status === 'success' && (
                    <div className="p-2">
                        <UnifiedDiffViewer
                            diff={state.diffText}
                            fileName={fileName}
                            showLineNumbers
                            data-testid="whisper-diff-viewer"
                        />
                    </div>
                )}
            </div>
        </div>
    );
}
