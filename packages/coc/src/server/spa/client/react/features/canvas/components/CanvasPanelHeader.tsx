/**
 * CanvasPanelHeader — the panel's top chrome: title (with the multi-canvas
 * switcher), type badge, version stepper, save status, Preview/Edit toggle,
 * Export menu, "New Kusto query" (Kusto canvases only), pop-out, fullscreen,
 * and close.
 *
 * Presentational: every action is a prop. The only local state is the
 * open/closed state of the two menus it owns.
 */

import { useEffect, useRef, useState } from 'react';
import type { Canvas, CanvasSummary } from '@plusplusoneplusplus/coc-client';
import type { CanvasKind, SaveState, ViewMode } from '../canvas-panel-model';
import type { CanvasExport } from '../hooks/useCanvasExport';
import type { CanvasVersions } from '../hooks/useCanvasVersions';
import { ChevronDownIcon, CloseIcon, CollapseIcon, ExpandIcon, ICON_BTN_CLASS, PopOutIcon } from './icons';

export interface CanvasPanelHeaderProps {
    canvas: Canvas | null;
    canvasId: string;
    title: string;
    kind: CanvasKind;
    availableCanvases: CanvasSummary[];
    onSelectCanvas?: (canvasId: string) => void;
    versions: CanvasVersions;
    exporter: CanvasExport;
    saveState: SaveState;
    statusLabel: string;
    mode: ViewMode;
    onModeChange: (mode: ViewMode) => void;
    kustoEnabled: boolean;
    creatingKusto: boolean;
    onCreateKusto: () => void;
    onPopOut?: () => void;
    isFullscreen: boolean;
    onToggleFullscreen: () => void;
    onClose?: () => void;
}

export function CanvasPanelHeader({
    canvas, canvasId, title, kind, availableCanvases, onSelectCanvas, versions, exporter,
    saveState, statusLabel, mode, onModeChange, kustoEnabled, creatingKusto, onCreateKusto,
    onPopOut, isFullscreen, onToggleFullscreen, onClose,
}: CanvasPanelHeaderProps) {
    const [titleSwitcherOpen, setTitleSwitcherOpen] = useState(false);
    const titleSwitcherButtonRef = useRef<HTMLButtonElement | null>(null);
    const titleSwitcherMenuRef = useRef<HTMLDivElement | null>(null);
    const { viewingVersion, viewingRevision, olderMeta, newerMeta } = versions;

    useEffect(() => {
        if (!titleSwitcherOpen) return;
        const handler = (e: MouseEvent | TouchEvent) => {
            const target = e.target as Node | null;
            if (!target) return;
            if (titleSwitcherMenuRef.current?.contains(target)) return;
            if (titleSwitcherButtonRef.current?.contains(target)) return;
            setTitleSwitcherOpen(false);
        };
        document.addEventListener('mousedown', handler);
        document.addEventListener('touchstart', handler);
        return () => {
            document.removeEventListener('mousedown', handler);
            document.removeEventListener('touchstart', handler);
        };
    }, [titleSwitcherOpen]);

    useEffect(() => {
        if (!titleSwitcherOpen) return;
        const handler = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setTitleSwitcherOpen(false);
        };
        document.addEventListener('keydown', handler);
        return () => document.removeEventListener('keydown', handler);
    }, [titleSwitcherOpen]);

    useEffect(() => {
        setTitleSwitcherOpen(false);
    }, [canvasId]);

    const canSwitchCanvas = availableCanvases.length >= 2 && !!onSelectCanvas;

    return (
        <div className="flex items-center gap-2 px-3 py-2 border-b border-[#e0e0e0] dark:border-[#474749] shrink-0">
            <div className="relative flex-1 min-w-0">
                {canSwitchCanvas ? (
                    <>
                        <button
                            ref={titleSwitcherButtonRef}
                            type="button"
                            className="group flex max-w-full items-center gap-1 rounded px-1 py-0.5 -ml-1 text-left text-xs font-semibold text-[#1e1e1e] dark:text-[#cccccc] hover:bg-[#e8e8e8] dark:hover:bg-[#2d2d2d] focus:outline-none focus:ring-1 focus:ring-[#0078d4]"
                            title={title}
                            data-testid="canvas-panel-title"
                            aria-haspopup="menu"
                            aria-expanded={titleSwitcherOpen ? 'true' : 'false'}
                            onClick={() => setTitleSwitcherOpen(open => !open)}
                        >
                            <span className="truncate">{title}</span>
                            <span className="shrink-0 text-[#848484] group-hover:text-[#1e1e1e] dark:group-hover:text-[#cccccc]" data-testid="canvas-panel-title-chevron">
                                <ChevronDownIcon />
                            </span>
                        </button>
                        {titleSwitcherOpen && (
                            <div
                                ref={titleSwitcherMenuRef}
                                role="menu"
                                className="absolute left-0 top-full z-30 mt-1 min-w-[200px] max-w-[320px] rounded-md border border-[#e0e0e0] dark:border-[#3c3c3c] bg-white dark:bg-[#252526] shadow-lg py-1"
                                data-testid="canvas-panel-title-menu"
                            >
                                {availableCanvases.map(item => {
                                    const active = item.id === canvasId;
                                    return (
                                        <button
                                            key={item.id}
                                            type="button"
                                            role="menuitem"
                                            aria-current={active ? 'true' : undefined}
                                            className={`block w-full px-3 py-2 text-left text-[12px] truncate ${active ? 'bg-[#e8f3ff] dark:bg-[#04395e] text-[#005a9e] dark:text-[#9cdcfe] font-semibold' : 'text-[#1e1e1e] dark:text-[#cccccc] hover:bg-[#e8e8e8] dark:hover:bg-[#2d2d2d]'}`}
                                            data-testid="canvas-panel-title-option"
                                            data-canvas-id={item.id}
                                            title={item.title}
                                            onClick={() => { setTitleSwitcherOpen(false); onSelectCanvas?.(item.id); }}
                                        >
                                            {item.title}
                                        </button>
                                    );
                                })}
                            </div>
                        )}
                    </>
                ) : (
                    <span className="block text-xs font-semibold truncate text-[#1e1e1e] dark:text-[#cccccc]" title={title} data-testid="canvas-panel-title">
                        {title}
                    </span>
                )}
            </div>
            {kind.isCode && (
                <span className="text-[9px] uppercase px-1 py-0.5 rounded border border-[#e0e0e0] dark:border-[#474749] text-[#848484] shrink-0" data-testid="canvas-panel-language">
                    {canvas?.language ?? 'code'}
                </span>
            )}
            {kind.isExtension && (
                <span className="text-[9px] uppercase px-1 py-0.5 rounded border border-violet-300 dark:border-violet-700 text-violet-600 dark:text-violet-300 shrink-0" data-testid="canvas-panel-extension-badge">
                    extension
                </span>
            )}
            {kind.isExcalidraw && (
                <span className="text-[9px] uppercase px-1 py-0.5 rounded border border-sky-300 dark:border-sky-700 text-sky-600 dark:text-sky-300 shrink-0" data-testid="canvas-panel-excalidraw-badge">
                    diagram
                </span>
            )}
            {kind.isKusto && (
                <span className="text-[9px] uppercase px-1 py-0.5 rounded border border-emerald-300 dark:border-emerald-700 text-emerald-600 dark:text-emerald-300 shrink-0" data-testid="canvas-panel-kusto-badge">
                    kusto
                </span>
            )}
            {canvas && (
                <span className="flex items-center gap-0.5 text-[10px] text-[#848484] shrink-0">
                    <button
                        type="button"
                        className="px-1 rounded disabled:opacity-30 enabled:hover:bg-[#e8e8e8] dark:enabled:hover:bg-[#2d2d2d]"
                        disabled={!olderMeta}
                        onClick={() => olderMeta && versions.openVersion(olderMeta)}
                        aria-label="View older version"
                        data-testid="canvas-panel-version-older"
                    >
                        ‹
                    </button>
                    <span data-testid="canvas-panel-revision">rev {viewingRevision}</span>
                    <button
                        type="button"
                        className="px-1 rounded disabled:opacity-30 enabled:hover:bg-[#e8e8e8] dark:enabled:hover:bg-[#2d2d2d]"
                        disabled={!viewingVersion}
                        onClick={() => newerMeta ? versions.openVersion(newerMeta) : versions.backToLatest()}
                        aria-label="View newer version"
                        data-testid="canvas-panel-version-newer"
                    >
                        ›
                    </button>
                </span>
            )}
            {statusLabel && !viewingVersion && (
                <span
                    className={`text-[10px] shrink-0 ${saveState === 'conflict' || saveState === 'error' ? 'text-red-500' : 'text-[#848484]'}`}
                    data-testid="canvas-panel-save-state"
                >
                    {statusLabel}
                </span>
            )}
            {/* Excalidraw + Kusto canvases have their own view — no md Edit affordance. */}
            {!viewingVersion && !kind.isExcalidraw && !kind.isKusto && (
                <div className="flex rounded-md border border-[#e0e0e0] dark:border-[#3c3c3c] overflow-hidden shrink-0">
                    <button
                        type="button"
                        className={`px-2 py-0.5 text-[11px] transition-colors ${mode === 'preview' ? 'bg-[#0078d4] text-white font-medium' : 'text-[#616161] dark:text-[#cccccc] hover:bg-[#e8e8e8] dark:hover:bg-[#2d2d2d]'}`}
                        onClick={() => onModeChange('preview')}
                        data-testid="canvas-panel-mode-preview"
                    >
                        Preview
                    </button>
                    <button
                        type="button"
                        className={`px-2 py-0.5 text-[11px] transition-colors ${mode === 'edit' ? 'bg-[#0078d4] text-white font-medium' : 'text-[#616161] dark:text-[#cccccc] hover:bg-[#e8e8e8] dark:hover:bg-[#2d2d2d]'}`}
                        onClick={() => onModeChange('edit')}
                        data-testid="canvas-panel-mode-edit"
                    >
                        Edit
                    </button>
                </div>
            )}
            {canvas && (
                <div className="relative shrink-0">
                    {exporter.exportStatus ? (
                        <span className="text-[10px] text-[#848484] px-1" data-testid="canvas-panel-export-status">{exporter.exportStatus}</span>
                    ) : (
                        <button
                            type="button"
                            className="px-2 py-0.5 text-[11px] rounded text-[#616161] dark:text-[#cccccc] hover:bg-[#e8e8e8] dark:hover:bg-[#2d2d2d] transition-colors"
                            onClick={() => exporter.setExportOpen(open => !open)}
                            data-testid="canvas-panel-export"
                        >
                            Export
                        </button>
                    )}
                    {exporter.exportOpen && (
                        <div className="absolute right-0 top-6 z-20 min-w-[150px] rounded-md border border-[#e0e0e0] dark:border-[#3c3c3c] bg-white dark:bg-[#252526] shadow-md py-1" data-testid="canvas-panel-export-menu">
                            <button type="button" className="block w-full text-left px-3 py-1.5 text-[12px] text-[#1e1e1e] dark:text-[#cccccc] hover:bg-[#e8e8e8] dark:hover:bg-[#2d2d2d]" onClick={() => void exporter.copyContent()} data-testid="canvas-panel-export-copy">
                                Copy content
                            </button>
                            <button type="button" className="block w-full text-left px-3 py-1.5 text-[12px] text-[#1e1e1e] dark:text-[#cccccc] hover:bg-[#e8e8e8] dark:hover:bg-[#2d2d2d]" onClick={exporter.download} data-testid="canvas-panel-export-download">
                                Download file
                            </button>
                            {canvas.type !== 'kusto' && (
                                <button
                                    type="button"
                                    className="block w-full text-left px-3 py-1.5 text-[12px] text-[#1e1e1e] dark:text-[#cccccc] hover:bg-[#e8e8e8] dark:hover:bg-[#2d2d2d]"
                                    onClick={() => void exporter.exportHtml()}
                                    title={canvas.type === 'extension' ? 'Exports a self-contained, view-only snapshot of the current state.' : undefined}
                                    data-testid="canvas-panel-export-html"
                                >
                                    {canvas.type === 'extension' ? 'Export as HTML (view-only)' : 'Export as HTML'}
                                </button>
                            )}
                            {canvas.type === 'markdown' && (
                                <button type="button" className="block w-full text-left px-3 py-1.5 text-[12px] text-[#1e1e1e] dark:text-[#cccccc] hover:bg-[#e8e8e8] dark:hover:bg-[#2d2d2d]" onClick={() => void exporter.saveToNotes()} data-testid="canvas-panel-export-notes">
                                    Save to Notes
                                </button>
                            )}
                        </div>
                    )}
                </div>
            )}
            {/* Kusto-only: creating a query from a markdown/extension/excalidraw
                canvas is unrelated to what the user is looking at. */}
            {kustoEnabled && kind.isKusto && (
                <button
                    type="button"
                    className="px-2 py-0.5 text-[11px] rounded text-[#616161] dark:text-[#cccccc] hover:bg-[#e8e8e8] dark:hover:bg-[#2d2d2d] transition-colors disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
                    onClick={onCreateKusto}
                    disabled={creatingKusto}
                    title="Create a new blank Kusto query"
                    data-testid="canvas-panel-new-kusto"
                >
                    {creatingKusto ? 'Creating…' : 'New Kusto query'}
                </button>
            )}
            {onPopOut && !isFullscreen && (
                <button
                    type="button"
                    className={ICON_BTN_CLASS}
                    onClick={onPopOut}
                    aria-label="Open canvas in a new window"
                    title="Pop out to new window"
                    data-testid="canvas-panel-popout"
                >
                    <PopOutIcon />
                </button>
            )}
            <button
                type="button"
                className={ICON_BTN_CLASS}
                onClick={onToggleFullscreen}
                aria-label={isFullscreen ? 'Exit fullscreen' : 'Expand canvas to fullscreen'}
                title={isFullscreen ? 'Exit fullscreen (Esc)' : 'Fullscreen'}
                data-testid="canvas-panel-fullscreen"
            >
                {isFullscreen ? <CollapseIcon /> : <ExpandIcon />}
            </button>
            {onClose && (
                <button
                    type="button"
                    className={ICON_BTN_CLASS}
                    onClick={onClose}
                    aria-label="Close canvas panel"
                    title="Close"
                    data-testid="canvas-panel-close"
                >
                    <CloseIcon />
                </button>
            )}
        </div>
    );
}
