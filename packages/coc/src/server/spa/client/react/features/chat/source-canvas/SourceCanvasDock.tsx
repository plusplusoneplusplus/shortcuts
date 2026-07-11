/**
 * SourceCanvasDock — host layout for the docked source-file canvas.
 *
 * Picks the surface for the single `SourceCanvasPanel` slot:
 *  - mobile → a full-height `BottomSheet` (AC-05: notes render the editable
 *    NoteEditor inside the same sheet the read-only viewer uses).
 *  - desktop → a resizable, full-height sibling column with a drag handle.
 *
 * The panel chrome + body-mode switch (`kind: 'note'` editor vs `'code'`
 * read-only viewer) live in `SourceCanvasPanel`; this component only owns the
 * mobile-vs-desktop shell + resizing, mirroring the branch that used to live
 * inline in `ChatDetail`.
 */
import { BottomSheet } from '../../../ui/BottomSheet';
import { SourceCanvasPanel } from './SourceCanvasPanel';
import type { SourceCanvasFileRef } from './types';
import type { SourceCanvasContentState } from './useSourceCanvasContent';
import type { SourceCanvasTreeState } from './useSourceCanvasTree';
import type { UseResizablePanelReturn } from '../../../hooks/ui/useResizablePanel';
import type { ConversationSourceFile } from './conversationSourceFiles';

function sheetTitle(fileRef: SourceCanvasFileRef): string {
    const path = fileRef.displayPath || fileRef.fullPath;
    return path.replace(/\\/g, '/').split('/').pop() || 'Source';
}

export interface SourceCanvasDockProps {
    /** The file to display (markdown note or read-only code ref). */
    fileRef: SourceCanvasFileRef;
    /** Resolved workspace id, used for reveal-in-explorer. */
    wsId?: string | null;
    /** Current workspace root, used to show project-relative paths in panel chrome. */
    workspaceRootPath?: string | null;
    /** Loaded content for the read-only viewer (unused for notes). */
    content?: SourceCanvasContentState;
    /** Expandable-tree state for the read-only explorer (`kind: 'dir'` refs only). */
    tree?: SourceCanvasTreeState;
    /** Open a file ref in the same panel (folder-tree file navigation). */
    onNavigate?: (ref: SourceCanvasFileRef) => void;
    /** Conversation-scoped code files eligible for the source header switcher. */
    sourceFiles?: readonly ConversationSourceFile[];
    /** Mobile breakpoint → render inside a BottomSheet instead of a column. */
    isMobile: boolean;
    /** Close the canvas. */
    onClose: () => void;
    /** Resize handlers/width for the desktop column. */
    resize: Pick<UseResizablePanelReturn, 'width' | 'handleMouseDown' | 'handleTouchStart'>;
}

export function SourceCanvasDock({
    fileRef,
    wsId,
    workspaceRootPath,
    content,
    tree,
    onNavigate,
    sourceFiles,
    isMobile,
    onClose,
    resize,
}: SourceCanvasDockProps) {
    if (isMobile) {
        return (
            <BottomSheet
                isOpen
                onClose={onClose}
                title={sheetTitle(fileRef)}
                height={90}
            >
                <SourceCanvasPanel
                    fileRef={fileRef}
                    wsId={wsId}
                    workspaceRootPath={workspaceRootPath}
                    content={content}
                    tree={tree}
                    onNavigate={onNavigate}
                    sourceFiles={sourceFiles}
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
                aria-label="Resize source canvas panel"
                data-testid="source-canvas-resize-handle"
            />
            <div
                style={{ width: resize.width }}
                className="hidden lg:block shrink-0 h-full border-l border-[#e0e0e0] dark:border-[#474749]"
                data-testid="source-canvas-column"
            >
                <SourceCanvasPanel
                    fileRef={fileRef}
                    wsId={wsId}
                    workspaceRootPath={workspaceRootPath}
                    content={content}
                    tree={tree}
                    onNavigate={onNavigate}
                    sourceFiles={sourceFiles}
                    onClose={onClose}
                />
            </div>
        </>
    );
}
