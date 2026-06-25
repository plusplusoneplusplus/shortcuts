/**
 * WhisperDiffDock — host layout for the transient read-only whisper diff panel
 * (AC-03).
 *
 * Picks the surface for the single `WhisperDiffPanel` slot, mirroring
 * `SourceCanvasDock`:
 *  - mobile → a full-height `BottomSheet` (the existing source-canvas
 *    bottom-sheet style).
 *  - desktop → a resizable, full-height sibling column with a drag handle.
 *
 * The panel chrome + state-driven body live in `WhisperDiffPanel`; this
 * component only owns the mobile-vs-desktop shell + resizing.
 */
import { BottomSheet } from '../../../ui/BottomSheet';
import { WhisperDiffPanel } from './WhisperDiffPanel';
import type { FileEdit } from '../conversation/tool-calls/toolGroupUtils';
import type { WhisperDiffState } from './useWhisperDiffState';
import type { UseResizablePanelReturn } from '../../../hooks/ui/useResizablePanel';

function sheetTitle(file: FileEdit): string {
    return file.path.replace(/\\/g, '/').split('/').pop() || 'Diff';
}

export interface WhisperDiffDockProps {
    /** The clicked file's edit summary — drives the header (always present). */
    file: FileEdit;
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
    file,
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
                title={sheetTitle(file)}
                height={90}
            >
                <WhisperDiffPanel
                    file={file}
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
                    file={file}
                    state={state}
                    workspaceRootPath={workspaceRootPath}
                    onClose={onClose}
                />
            </div>
        </>
    );
}
