/**
 * WhisperDiffDock — host layout for the converged read-only whisper diff panel
 * (AC-03).
 *
 * Picks the surface for the single `WhisperDiffPanel` slot, mirroring
 * `SourceCanvasDock`:
 *  - mobile → a full-height `BottomSheet` (the existing source-canvas
 *    bottom-sheet style).
 *  - desktop → a resizable, full-height sibling column with a drag handle.
 *
 * The panel chrome (header dropdown selector + state-driven body) lives in
 * `WhisperDiffPanel`; the per-file selection is internal to the panel, so this
 * host only owns the mobile-vs-desktop shell + resizing and titles the mobile
 * sheet with the whole-group file count.
 */
import { BottomSheet } from '../../../ui/BottomSheet';
import { WhisperDiffPanel } from './WhisperDiffPanel';
import type { WhisperDiffState } from './useWhisperDiffState';
import type { UseResizablePanelReturn } from '../../../hooks/ui/useResizablePanel';

/** Whole-group title for the mobile sheet chrome (the dropdown inside is authoritative). */
function sheetTitle(state: WhisperDiffState): string {
    const n = state.view.fileCount;
    return n > 0 ? `${n} file${n !== 1 ? 's' : ''} changed` : 'Changes';
}

export interface WhisperDiffDockProps {
    /** Renderable diff state from `useWhisperDiffState`. */
    state: WhisperDiffState;
    /** Current workspace root, used to show a project-relative path in the header. */
    workspaceRootPath?: string | null;
    /** Mobile breakpoint → render inside a BottomSheet instead of a column. */
    isMobile: boolean;
    /** Close the panel. */
    onClose: () => void;
    /** Resize handlers/width for the desktop column. */
    resize: Pick<UseResizablePanelReturn, 'width' | 'handleMouseDown' | 'handleTouchStart'>;
}

export function WhisperDiffDock({
    state,
    workspaceRootPath,
    isMobile,
    onClose,
    resize,
}: WhisperDiffDockProps) {
    if (isMobile) {
        return (
            <BottomSheet
                isOpen
                onClose={onClose}
                title={sheetTitle(state)}
                height={90}
            >
                <WhisperDiffPanel
                    state={state}
                    workspaceRootPath={workspaceRootPath}
                    onClose={onClose}
                />
            </BottomSheet>
        );
    }

    return (
        <>
            <div
                className="hidden lg:flex items-center justify-center w-1 cursor-col-resize shrink-0 hover:bg-[#d0d0d0] dark:hover:bg-[#3a3a3c]"
                onMouseDown={resize.handleMouseDown}
                onTouchStart={resize.handleTouchStart}
                role="separator"
                aria-label="Resize whisper diff panel"
                data-testid="whisper-diff-resize-handle"
            />
            <div
                style={{ width: resize.width }}
                className="hidden lg:block shrink-0 h-full border-l border-[#e0e0e0] dark:border-[#474749]"
                data-testid="whisper-diff-column"
            >
                <WhisperDiffPanel
                    state={state}
                    workspaceRootPath={workspaceRootPath}
                    onClose={onClose}
                />
            </div>
        </>
    );
}
