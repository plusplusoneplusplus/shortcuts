/**
 * SourceCanvasPanel — docked, read-only viewer chrome for a single source file.
 *
 * Renders the panel header (file name + full path, copy-path, reveal-in-explorer,
 * close) and a body region. The body is a placeholder here; later slices fill it
 * with markdown/syntax-highlighted rendering (AC-04), line jump + highlight
 * (AC-05), and loading/error states (AC-06).
 *
 * Layout (docked column vs mobile BottomSheet) and resizing are owned by the
 * host (`ChatDetail`); this component is the inner chrome only.
 */
import { useCallback, useState } from 'react';
import { getSpaCocClient } from '../../../api/cocClient';
import { Spinner } from '../../../ui/Spinner';
import type { SourceCanvasFileRef } from './types';
import type { SourceCanvasContentState } from './useSourceCanvasContent';

function basename(p: string): string {
    const normalized = p.replace(/\\/g, '/');
    return normalized.split('/').pop() || p;
}

const headerBtnClass =
    'shrink-0 flex items-center justify-center w-8 h-8 rounded text-[#848484] ' +
    'hover:text-[#1e1e1e] dark:hover:text-[#cccccc] hover:bg-black/[0.06] dark:hover:bg-white/[0.08]';

function CopyIcon() {
    return (
        <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor"
             aria-hidden="true" style={{ display: 'inline-block', verticalAlign: 'middle' }}>
            <path d="M4 1.5h5A1.5 1.5 0 0 1 10.5 3v.5H9V3a0 0 0 0 0 0 0H4a0 0 0 0 0 0 0v6.5H3A1.5 1.5 0 0 1 4 1.5z" opacity=".7"/>
            <rect x="5" y="4" width="7" height="8.5" rx="1.2" fill="none" stroke="currentColor" strokeWidth="1.1"/>
        </svg>
    );
}

function RevealInExplorerIcon() {
    return (
        <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor"
             aria-hidden="true" style={{ display: 'inline-block', verticalAlign: 'middle' }}>
            <path d="M1 4a1 1 0 0 1 1-1h3l1 1h5a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1V4z"/>
            <path d="M6 6.5l2 1.5-2 1.5V8H4.5v-1H6V6.5z" fill="white"/>
        </svg>
    );
}

export interface SourceCanvasPanelProps {
    /** The file to display. */
    fileRef: SourceCanvasFileRef;
    /** Resolved workspace id, used for reveal-in-explorer. */
    wsId?: string | null;
    /** Loaded content + load/error state (AC-06). Loading when omitted. */
    content?: SourceCanvasContentState;
    /** Close the canvas (X button). */
    onClose: () => void;
}

export function SourceCanvasPanel({ fileRef, wsId, content, onClose }: SourceCanvasPanelProps) {
    const { fullPath, displayPath } = fileRef;
    const path = displayPath || fullPath;
    const fileName = basename(path);
    const [copied, setCopied] = useState(false);

    const handleCopy = useCallback(() => {
        const clip = navigator.clipboard;
        if (!clip?.writeText) { return; }
        void clip.writeText(fullPath)
            .then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
            })
            .catch(() => { /* clipboard unavailable */ });
    }, [fullPath]);

    const handleReveal = useCallback(() => {
        if (!wsId) { return; }
        getSpaCocClient().explorer.reveal(wsId, fullPath).catch(() => { /* ignore */ });
    }, [wsId, fullPath]);

    return (
        <div
            className="flex flex-col h-full min-h-0 overflow-hidden bg-white dark:bg-[#1e1e1e]"
            data-testid="source-canvas-panel"
        >
            <div className="px-3 py-2 border-b border-[#e0e0e0] dark:border-[#3c3c3c] bg-[#f8f8f8] dark:bg-[#252526] flex items-start justify-between gap-2">
                <div className="min-w-0">
                    <div
                        className="text-sm font-semibold text-[#1e1e1e] dark:text-[#cccccc] truncate"
                        data-testid="source-canvas-filename"
                    >
                        {fileName}
                    </div>
                    <div
                        className="text-xs text-[#848484] truncate mt-0.5"
                        title={path}
                        data-testid="source-canvas-path"
                    >
                        {path}
                    </div>
                </div>
                <div className="flex items-center gap-0.5 shrink-0">
                    <button
                        type="button"
                        data-testid="source-canvas-copy-btn"
                        onClick={handleCopy}
                        className={headerBtnClass}
                        aria-label="Copy path"
                        title={copied ? 'Copied' : 'Copy path'}
                    >
                        <CopyIcon />
                    </button>
                    <button
                        type="button"
                        data-testid="source-canvas-reveal-btn"
                        onClick={handleReveal}
                        disabled={!wsId}
                        className={`${headerBtnClass} disabled:opacity-40 disabled:cursor-default`}
                        aria-label="Reveal in Explorer"
                        title="Reveal in Explorer"
                    >
                        <RevealInExplorerIcon />
                    </button>
                    <button
                        type="button"
                        data-testid="source-canvas-close-btn"
                        onClick={onClose}
                        className={headerBtnClass}
                        aria-label="Close"
                    >
                        ✕
                    </button>
                </div>
            </div>
            <div className="flex-1 min-h-0 overflow-auto" data-testid="source-canvas-body">
                {/* AC-06: loading / error / success. AC-04 will replace the
                    success branch with markdown / syntax-highlighted rendering. */}
                {(!content || content.status === 'loading') && (
                    <div
                        className="flex items-center gap-2 p-4 text-xs text-[#848484]"
                        data-testid="source-canvas-loading"
                    >
                        <Spinner size="sm" /> Loading {fileName}…
                    </div>
                )}
                {content && content.status === 'error' && (
                    <div className="p-4 text-xs" data-testid="source-canvas-error">
                        <div
                            className="font-medium text-[#cc4444] dark:text-[#f48771]"
                            data-testid="source-canvas-error-msg"
                        >
                            {`Couldn't load ${content.resolvedPath || path}`}
                        </div>
                        {content.error && (
                            <div className="mt-1 text-[#848484]">{content.error}</div>
                        )}
                    </div>
                )}
                {content && content.status === 'success' && (
                    <pre
                        className="p-4 m-0 text-xs whitespace-pre-wrap break-words font-mono text-[#1e1e1e] dark:text-[#cccccc]"
                        data-testid="source-canvas-source"
                    >
                        {content.content}
                    </pre>
                )}
            </div>
        </div>
    );
}
