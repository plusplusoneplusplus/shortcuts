/**
 * SourceCanvasNotePopOutButton — the "Pop out" header action for the docked
 * note editor (AC-03). Only shown in markdown/editable mode (`kind: 'note'`).
 *
 * Reuses the floating dialog's pop-out flow verbatim: it resolves the same
 * workspace/path/fetchMode/taskRootPath via `resolveMarkdownReviewTarget`, opens
 * the standalone `#popout/markdown` window (`PopOutMarkdownShell`), marks the
 * file popped out (`mdPopOutKey`), and closes the canvas note — matching what
 * `MarkdownReviewDialog.handlePopOut` does today.
 */
import { useCallback, useMemo } from 'react';
import { useApp } from '../../../contexts/AppContext';
import { useMarkdownPopOut } from '../../../contexts/MarkdownPopOutContext';
import { useGlobalToast } from '../../../contexts/ToastContext';
import { mdPopOutKey } from '../../../layout/PopOutMarkdownShell';
import {
    resolveMarkdownReviewTarget,
    type WorkspaceLike,
} from '../../../shared/markdown-review/resolveMarkdownReviewTarget';
import type { SourceCanvasFileRef } from './types';

function PopOutIcon() {
    return (
        <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor"
             aria-hidden="true" style={{ display: 'inline-block', verticalAlign: 'middle' }}>
            <path d="M7 3h4v4h-1V4.7L6.35 8.35l-.7-.7L9.3 4H7V3z"/>
            <path d="M3 5h2V4H2v8h8V9H9v2H3V5z"/>
        </svg>
    );
}

export interface SourceCanvasNotePopOutButtonProps {
    /** The markdown note ref currently shown in the canvas. */
    fileRef: SourceCanvasFileRef;
    /** Close the canvas note after a successful pop-out (dialog parity). */
    onClose: () => void;
    /** Header button styling, shared with the other header actions. */
    className?: string;
}

export function SourceCanvasNotePopOutButton({ fileRef, onClose, className }: SourceCanvasNotePopOutButtonProps) {
    const { state } = useApp();
    const workspaces = state.workspaces as WorkspaceLike[] | undefined;
    const { markPoppedOut } = useMarkdownPopOut();
    const { addToast } = useGlobalToast();

    // Resolve the same target the editor (and the floating dialog) use, so the
    // pop-out window loads/saves the identical file.
    const target = useMemo(
        () => resolveMarkdownReviewTarget(
            {
                filePath: fileRef.fullPath,
                wsId: fileRef.wsId,
                sourceFilePath: fileRef.sourceFilePath,
            },
            workspaces || [],
        ),
        [fileRef.fullPath, fileRef.wsId, fileRef.sourceFilePath, workspaces],
    );

    const handlePopOut = useCallback(() => {
        if (!target) { return; }
        const params = new URLSearchParams();
        params.set('workspace', target.wsId);
        params.set('filePath', target.filePath);
        if (target.displayPath) { params.set('displayPath', target.displayPath); }
        params.set('fetchMode', target.fetchMode);
        if (target.taskRootPath) { params.set('taskRootPath', target.taskRootPath); }
        const url = `${window.location.origin}${window.location.pathname}?${params.toString()}#popout/markdown`;
        const windowName = `coc-md-popout-${mdPopOutKey(target.wsId, target.filePath).replace(/[^a-zA-Z0-9_-]/g, '_')}`;
        const popup = window.open(url, windowName, 'width=900,height=700');
        if (!popup) {
            addToast('Pop-out blocked. Allow popups for this site and try again.', 'error');
        } else {
            markPoppedOut(mdPopOutKey(target.wsId, target.filePath));
            onClose();
        }
    }, [target, addToast, markPoppedOut, onClose]);

    return (
        <button
            type="button"
            data-testid="source-canvas-popout-btn"
            onClick={handlePopOut}
            disabled={!target}
            className={className}
            aria-label="Open in new window"
            title="Open in new window"
        >
            <PopOutIcon />
        </button>
    );
}
