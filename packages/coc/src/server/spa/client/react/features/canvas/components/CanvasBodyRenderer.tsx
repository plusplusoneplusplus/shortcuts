/**
 * CanvasBodyRenderer — picks the render branch for the canvas body.
 *
 * Branch order matters and mirrors the panel's rules:
 *  1. loading / load error
 *  2. Excalidraw scenes and Kusto canvases — host-rendered views, including
 *     history revisions, so their content never reaches the markdown pipeline
 *  3. extension canvases in preview — the sandboxed-iframe UI
 *  4. Edit mode — Monaco for code canvases, a plain textarea otherwise
 *  5. SVG code canvases — the isolated SVG render surface
 *  6. everything else — the chat markdown renderer
 *
 * History views are read-only: no edit branch is reachable while
 * `viewingVersion` is set.
 */

import { useCallback, useMemo } from 'react';
import type { Canvas, CanvasVersion } from '@plusplusoneplusplus/coc-client';
import { MarkdownView } from '../../../shared/MarkdownView';
import { chatMarkdownToHtml } from '../../chat/conversation/markdownHtml';
import { copySelectionWithInlineImages } from '../../../utils/format';
import { MonacoFileEditor } from '../../repo-detail/explorer/MonacoFileEditor';
import { ExcalidrawSceneView, parseSceneContent } from '../../diagrams';
import { ExtensionCanvasView } from '../ExtensionCanvasView';
import { KustoView } from '../KustoView';
import { SvgCanvasView } from '../SvgCanvasView';
import { monacoLanguageFor, previewMarkdownFor, type CanvasKind, type ViewMode } from '../canvas-panel-model';

export interface CanvasBodyRendererProps {
    workspaceId: string;
    canvasId: string;
    loading: boolean;
    loadError: string | null;
    canvas: Canvas | null;
    kind: CanvasKind;
    viewingVersion: CanvasVersion | null;
    viewingRevision: number;
    /** Content on screen — an older revision while browsing history. */
    displayedContent: string;
    mode: ViewMode;
    draft: string;
    onDraftChange: (next: string) => void;
    /** Interactive views (Kusto, extension) save through their own path. */
    onCanvasSaved: (saved: Canvas) => void;
    onSelectionChange: (text: string | null) => void;
    onImageMenu: (menu: { x: number; y: number; src: string }) => void;
    notify: (message: string, kind: 'error' | 'info') => void;
}

export function CanvasBodyRenderer({
    workspaceId, canvasId, loading, loadError, canvas, kind, viewingVersion, viewingRevision,
    displayedContent, mode, draft, onDraftChange, onCanvasSaved, onSelectionChange, onImageMenu, notify,
}: CanvasBodyRendererProps) {
    const excalidrawScene = useMemo(
        () => (kind.isExcalidraw ? parseSceneContent(displayedContent) : null),
        [kind.isExcalidraw, displayedContent],
    );
    const previewMarkdown = previewMarkdownFor(kind, canvas, displayedContent, !!viewingVersion);
    // Canvas Preview uses the chat's clean marked-based renderer so markdown
    // source markers (###, **, backticks, >, list bullets, link URL syntax) are
    // fully rendered instead of shown as faded hint spans. Diff/file/task
    // previews keep the editor-style forge renderer (useMarkdownPreview).
    // SVG fences only activate for markdown canvases; code canvases already
    // route to SvgCanvasView, and ordinary code canvases stay as source.
    const svgFenceEnabled = !kind.isCode && !kind.isExcalidraw && !kind.isExtension;
    const previewHtml = useMemo(
        () => chatMarkdownToHtml(previewMarkdown, workspaceId, { svgFenceEnabled }),
        [previewMarkdown, workspaceId, svgFenceEnabled],
    );

    const handlePreviewMouseUp = useCallback(() => {
        const text = window.getSelection()?.toString().trim() ?? '';
        onSelectionChange(text.length > 0 ? text : null);
    }, [onSelectionChange]);

    // Right-clicking an inline markdown image opens a custom "Copy image" menu.
    // Images come from `dangerouslySetInnerHTML`, so there is no per-image React
    // node — detection is event-delegation based. The native browser menu is
    // suppressed only when the pointer is over an inline image; anywhere else in
    // the preview the native menu is left untouched.
    const handlePreviewContextMenu = useCallback((e: React.MouseEvent) => {
        const target = e.target as unknown;
        if (target instanceof HTMLImageElement && target.classList.contains('chat-inline-image')) {
            e.preventDefault();
            onImageMenu({ x: e.clientX, y: e.clientY, src: target.currentSrc || target.src });
        }
    }, [onImageMenu]);

    // Native Ctrl+C over the preview: when the selection includes an inline
    // image, inline it as a base64 data-URI so it survives a paste into Word /
    // Google Docs / rich email (relative proxy URLs are otherwise dropped).
    // Text-only selections fall through to the browser's native copy untouched.
    const handlePreviewCopy = useCallback((e: React.ClipboardEvent<HTMLDivElement>) => {
        const result = copySelectionWithInlineImages(
            window.getSelection(),
            e.clipboardData,
            () => e.preventDefault(),
        );
        if (result) {
            result.catch(() => notify('Failed to copy image with formatting', 'error'));
        }
    }, [notify]);

    const handleEditorSelect = useCallback((e: React.SyntheticEvent<HTMLTextAreaElement>) => {
        const target = e.currentTarget;
        const text = target.value.substring(target.selectionStart ?? 0, target.selectionEnd ?? 0).trim();
        onSelectionChange(text.length > 0 ? text : null);
    }, [onSelectionChange]);

    if (loading) {
        return <div className="text-xs text-[#848484] py-6 text-center">Loading canvas…</div>;
    }
    if (loadError) {
        return <div className="text-xs text-red-500 py-6 text-center" data-testid="canvas-panel-error">{loadError}</div>;
    }
    if (kind.isExcalidraw && excalidrawScene) {
        return (
            <ExcalidrawSceneView
                scene={excalidrawScene}
                className="h-full min-h-[200px]"
                data-testid="canvas-panel-excalidraw"
            />
        );
    }
    if (kind.isKusto && canvas) {
        return (
            <KustoView
                workspaceId={workspaceId}
                canvas={viewingVersion
                    ? { ...canvas, content: displayedContent, revision: viewingVersion.revision }
                    : canvas}
                onCanvasSaved={viewingVersion ? undefined : onCanvasSaved}
                readOnly={!!viewingVersion}
            />
        );
    }
    if (!viewingVersion && mode === 'preview' && kind.isExtension && canvas) {
        return (
            <ExtensionCanvasView
                workspaceId={workspaceId}
                canvas={canvas}
                onCanvasSaved={onCanvasSaved}
            />
        );
    }
    if (!viewingVersion && mode === 'edit' && kind.isCode) {
        return (
            <div className="h-full min-h-[200px]" data-testid="canvas-panel-code-editor">
                <MonacoFileEditor
                    value={draft}
                    language={monacoLanguageFor(canvas?.language)}
                    onChange={onDraftChange}
                />
            </div>
        );
    }
    if (!viewingVersion && mode === 'edit') {
        return (
            <textarea
                className="w-full h-full min-h-[200px] text-xs p-3 bg-transparent resize-none font-mono outline-none"
                value={draft}
                onChange={e => onDraftChange(e.target.value)}
                onSelect={handleEditorSelect}
                data-testid="canvas-panel-editor"
            />
        );
    }
    if (kind.isSvg) {
        return (
            <SvgCanvasView
                key={`${canvasId}:${viewingRevision}`}
                source={displayedContent}
                sourceHtml={previewHtml}
            />
        );
    }
    return (
        <div
            className="canvas-mermaid-preview text-xs p-3"
            data-testid="canvas-panel-preview"
            onMouseUp={handlePreviewMouseUp}
            onContextMenu={handlePreviewContextMenu}
            onCopy={handlePreviewCopy}
        >
            {previewMarkdown.trim()
                ? <MarkdownView html={previewHtml} />
                : <span className="italic text-[#848484]">Empty canvas.</span>}
        </div>
    );
}
