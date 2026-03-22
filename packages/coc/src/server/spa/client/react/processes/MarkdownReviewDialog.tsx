/**
 * MarkdownReviewDialog — resizable/draggable floating dialog for reviewing markdown files
 * opened from process conversation file-path links.
 *
 * Uses FloatingDialog (draggable + 8-direction resize) on desktop.
 * Includes a "pop out" button to open the review in a separate browser window.
 */

import { useRef, useState } from 'react';
import { FloatingDialog } from '../shared/FloatingDialog';
import { MarkdownReviewEditor } from '../shared/MarkdownReviewEditor';
import { useBreakpoint } from '../hooks/useBreakpoint';
import { useMarkdownPopOut } from '../context/MarkdownPopOutContext';
import { mdPopOutKey } from '../layout/PopOutMarkdownShell';

function PopOutIcon() {
    return (
        <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor"
             aria-hidden="true" style={{ display: 'inline-block', verticalAlign: 'middle' }}>
            <path d="M7 3h4v4h-1V4.7L6.35 8.35l-.7-.7L9.3 4H7V3z"/>
            <path d="M3 5h2V4H2v8h8V9H9v2H3V5z"/>
        </svg>
    );
}

function MaximizeIcon() {
    return (
        <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor"
             aria-hidden="true" style={{ display: 'inline-block', verticalAlign: 'middle' }}>
            <path d="M2 2h4v1H3v3H2V2zm8 0h2v4h-1V3h-3V2h2zM2 10h1v3h3v1H2v-4zm10 0v4h-4v-1h3v-3h1z"/>
        </svg>
    );
}

function RestoreIcon() {
    return (
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none"
             aria-hidden="true" style={{ display: 'inline-block', verticalAlign: 'middle' }}>
            <rect x="4" y="2" width="8" height="8" stroke="currentColor" strokeWidth="1.2"/>
            <path d="M2 5v7h7v-2H3V5H2z" fill="currentColor"/>
        </svg>
    );
}

export interface MarkdownReviewDialogProps {
    open: boolean;
    onClose: () => void;
    /** Called with the current scroll position when the user minimizes. */
    onMinimize?: (scrollTop: number) => void;
    wsId: string | null;
    filePath: string | null;
    displayPath: string | null;
    fetchMode: 'tasks' | 'auto';
    /** Scroll position to restore after the dialog reopens from minimized state. */
    initialScrollTop?: number;
}

function getTitle(displayPath: string | null, filePath: string | null): string {
    const source = displayPath || filePath || '';
    if (!source) return 'Markdown Review';
    const normalized = source.replace(/\\/g, '/');
    return normalized.split('/').pop() || source;
}

export function MarkdownReviewDialog({
    open,
    onClose,
    onMinimize,
    wsId,
    filePath,
    displayPath,
    fetchMode,
    initialScrollTop,
}: MarkdownReviewDialogProps) {
    const { isMobile } = useBreakpoint();
    const scrollTopRef = useRef(0);
    const { markPoppedOut } = useMarkdownPopOut();
    const [isMaximized, setIsMaximized] = useState(false);
    const handleToggleMaximize = () => setIsMaximized(v => !v);

    if (!open || !wsId || !filePath) return null;

    const title = getTitle(displayPath, filePath);
    const handleMinimize = onMinimize ? () => onMinimize(scrollTopRef.current) : undefined;

    const handlePopOut = () => {
        const params = new URLSearchParams();
        params.set('workspace', wsId);
        params.set('filePath', filePath);
        if (displayPath) params.set('displayPath', displayPath);
        params.set('fetchMode', fetchMode);
        const url = `${window.location.origin}${window.location.pathname}?${params.toString()}#popout/markdown`;
        const popup = window.open(url, '_blank', 'noopener');
        if (popup) {
            markPoppedOut(mdPopOutKey(wsId, filePath));
            onClose();
        }
    };

    const headerBtnClass = 'shrink-0 flex items-center justify-center w-8 h-8 rounded text-[#848484] hover:text-[#1e1e1e] dark:hover:text-[#cccccc] hover:bg-black/[0.06] dark:hover:bg-white/[0.08]';

    return (
        <FloatingDialog
            open={open}
            onClose={onClose}
            resizable
            noPadding
            minWidth={600}
            minHeight={400}
            className="max-w-[900px] w-[900px] h-[700px]"
            isMaximized={isMaximized}
            renderHeader={({ onMouseDown }) => isMobile ? (
                /* Mobile: compact single-row header */
                <div
                    className="flex items-center justify-between px-3 border-b border-[#e0e0e0] dark:border-[#3c3c3c] bg-[#f8f8f8] dark:bg-[#252526] cursor-move select-none"
                    style={{ minHeight: 44 }}
                    onMouseDown={onMouseDown}
                    data-testid="floating-dialog-drag-handle"
                >
                    <span className="text-sm font-semibold text-[#1e1e1e] dark:text-[#cccccc] truncate mr-2" title={displayPath || filePath}>
                        {title}
                    </span>
                    <div className="flex items-center gap-0.5 shrink-0">
                        <button
                            data-testid="markdown-review-popout-btn"
                            onClick={handlePopOut}
                            onMouseDown={e => e.stopPropagation()}
                            className={headerBtnClass}
                            aria-label="Open in new window"
                            title="Open in new window"
                        >
                            <PopOutIcon />
                        </button>
                        <button
                            data-testid="markdown-review-maximize-btn"
                            onClick={handleToggleMaximize}
                            onMouseDown={e => e.stopPropagation()}
                            className={headerBtnClass}
                            aria-label={isMaximized ? 'Restore' : 'Maximize'}
                            title={isMaximized ? 'Restore' : 'Maximize'}
                        >
                            {isMaximized ? <RestoreIcon /> : <MaximizeIcon />}
                        </button>
                        {handleMinimize && (
                            <button
                                data-testid="markdown-review-minimize-btn"
                                onClick={handleMinimize}
                                onMouseDown={e => e.stopPropagation()}
                                className={headerBtnClass}
                                aria-label="Minimize"
                            >
                                −
                            </button>
                        )}
                        <button
                            onClick={onClose}
                            onMouseDown={e => e.stopPropagation()}
                            className={headerBtnClass}
                            aria-label="Close"
                        >
                            ✕
                        </button>
                    </div>
                </div>
            ) : (
                /* Desktop: full header with title + subtitle + pop-out + minimize + close */
                <div
                    className="px-4 py-3 border-b border-[#e0e0e0] dark:border-[#3c3c3c] bg-[#f8f8f8] dark:bg-[#252526] flex items-start justify-between gap-2 cursor-move select-none"
                    onMouseDown={onMouseDown}
                    data-testid="floating-dialog-drag-handle"
                >
                    <div className="min-w-0">
                        <div className="text-sm font-semibold text-[#1e1e1e] dark:text-[#cccccc]">
                            {title}
                        </div>
                        <div
                            className="text-xs text-[#848484] truncate mt-0.5"
                            title={displayPath || filePath}
                        >
                            {displayPath || filePath}
                        </div>
                    </div>
                    <div className="flex items-center gap-0.5 shrink-0">
                        <button
                            data-testid="markdown-review-popout-btn"
                            onClick={handlePopOut}
                            onMouseDown={e => e.stopPropagation()}
                            className={headerBtnClass}
                            aria-label="Open in new window"
                            title="Open in new window"
                        >
                            <PopOutIcon />
                        </button>
                        <button
                            data-testid="markdown-review-maximize-btn"
                            onClick={handleToggleMaximize}
                            onMouseDown={e => e.stopPropagation()}
                            className={headerBtnClass}
                            aria-label={isMaximized ? 'Restore' : 'Maximize'}
                            title={isMaximized ? 'Restore' : 'Maximize'}
                        >
                            {isMaximized ? <RestoreIcon /> : <MaximizeIcon />}
                        </button>
                        {handleMinimize && (
                            <button
                                data-testid="markdown-review-minimize-btn"
                                onClick={handleMinimize}
                                onMouseDown={e => e.stopPropagation()}
                                className={headerBtnClass}
                                aria-label="Minimize"
                            >
                                −
                            </button>
                        )}
                        <button
                            onClick={onClose}
                            onMouseDown={e => e.stopPropagation()}
                            className={headerBtnClass}
                            aria-label="Close"
                        >
                            ✕
                        </button>
                    </div>
                </div>
            )}
        >
            <MarkdownReviewEditor
                wsId={wsId}
                filePath={filePath}
                fetchMode={fetchMode}
                showAiButtons={true}
                initialScrollTop={initialScrollTop}
                onScrollTopChange={(st) => { scrollTopRef.current = st; }}
            />
        </FloatingDialog>
    );
}
