/**
 * useCanvasExport — copy / download / save-to-Notes / export-as-HTML.
 *
 * Export state is deliberately separate from edit + save state: an export
 * failure must never look like a failed save. The browser-only primitives
 * (clipboard write, blob download) are injectable so the transitions can be
 * unit-tested without a real download.
 */

import { useCallback, useState } from 'react';
import type { Canvas, CocClient } from '@plusplusoneplusplus/coc-client';
import { downloadFilenameFor, isSvgCodeCanvas, notesPathFor } from '../canvas-panel-model';
import { exportCanvasAsHtml } from '../html-export/exportCanvasAsHtml';
import type { ExtensionExportSource } from '../html-export/exportCanvasAsHtml';
import { createHtmlExportDeps } from '../html-export/htmlExportDeps';

const EXPORT_STATUS_MS = 2500;

export interface CanvasExportDeps {
    copyText: (text: string) => Promise<void>;
    downloadBlob: (blob: Blob, filename: string) => void;
    /** Surfaces a toast; a no-op when the panel is mounted outside a ToastProvider. */
    notify: (message: string, kind: 'error' | 'info') => void;
}

export function browserCopyText(text: string): Promise<void> {
    return navigator.clipboard.writeText(text);
}

export function browserDownloadBlob(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
}

export interface UseCanvasExportOptions {
    client: CocClient;
    workspaceId: string;
    canvasRef: React.MutableRefObject<Canvas | null>;
    notify: (message: string, kind: 'error' | 'info') => void;
    /** Test seam for the browser-only primitives. */
    deps?: Partial<Omit<CanvasExportDeps, 'notify'>>;
}

export interface CanvasExport {
    exportOpen: boolean;
    setExportOpen: React.Dispatch<React.SetStateAction<boolean>>;
    /** Transient status text shown in place of the Export button. */
    exportStatus: string | null;
    copyContent: () => Promise<void>;
    download: () => void;
    saveToNotes: () => Promise<void>;
    exportHtml: () => Promise<void>;
}

export function useCanvasExport({ client, workspaceId, canvasRef, notify, deps }: UseCanvasExportOptions): CanvasExport {
    const [exportOpen, setExportOpen] = useState(false);
    const [exportStatus, setExportStatus] = useState<string | null>(null);
    const copyText = deps?.copyText ?? browserCopyText;
    const downloadBlob = deps?.downloadBlob ?? browserDownloadBlob;

    const flashExportStatus = useCallback((status: string) => {
        setExportOpen(false);
        setExportStatus(status);
        setTimeout(() => setExportStatus(null), EXPORT_STATUS_MS);
    }, []);

    const copyContent = useCallback(async () => {
        const current = canvasRef.current;
        if (!current) return;
        try {
            await copyText(current.content);
            flashExportStatus('Copied');
        } catch {
            flashExportStatus('Copy failed');
        }
    }, [flashExportStatus]);

    const download = useCallback(() => {
        const current = canvasRef.current;
        if (!current) return;
        try {
            const blob = new Blob(
                [current.content],
                { type: isSvgCodeCanvas(current) ? 'image/svg+xml' : 'text/plain;charset=utf-8' },
            );
            downloadBlob(blob, downloadFilenameFor(current));
            flashExportStatus('Downloaded');
        } catch {
            flashExportStatus('Download failed');
        }
    }, [flashExportStatus]);

    const saveToNotes = useCallback(async () => {
        const current = canvasRef.current;
        if (!current || current.type !== 'markdown') return;
        try {
            await client.notes.saveContent(workspaceId, notesPathFor(current), current.content);
            flashExportStatus('Saved to Notes');
        } catch {
            flashExportStatus('Save to Notes failed');
        }
    }, [workspaceId, flashExportStatus]);

    // Export the canvas as a single self-contained, portable HTML file (rendered,
    // images inlined, diagrams pre-rasterized — see the html-export/ pipeline).
    // The orchestrator never throws; the extra try/catch guarantees the panel
    // stays mounted even if building the browser deps ever fails.
    const exportHtml = useCallback(async () => {
        const current = canvasRef.current;
        if (!current) return;
        // Kusto canvases are interactive (live query + table/chart) and
        // have no meaningful static-HTML snapshot — not HTML-exportable.
        if (current.type === 'kusto') return;
        setExportOpen(false);
        try {
            // Extension canvases render from a UI document stored apart from their
            // JSON state `content`. Fetch it through the workspace-routed client so
            // it resolves for remote/clone workspaces too (mirrors the live
            // ExtensionCanvasView path), and hand the exporter `{ uiHtml, revision }`.
            // `capabilitiesJs` is deliberately never fetched — capability code must
            // not ship in a view-only snapshot. A retrieval failure surfaces a toast
            // and aborts before any download, so no broken/partial file is produced.
            let extension: ExtensionExportSource | undefined;
            if (current.type === 'extension') {
                try {
                    const doc = await client.canvases.getExtension(workspaceId, current.id);
                    extension = { uiHtml: doc.uiHtml, revision: current.revision };
                } catch {
                    notify('Could not load the extension to export as HTML', 'error');
                    flashExportStatus('Export failed');
                    return;
                }
            }
            const result = await exportCanvasAsHtml(
                {
                    title: current.title,
                    type: current.type,
                    content: current.content,
                    language: current.language,
                    workspaceId,
                    extension,
                },
                createHtmlExportDeps(),
            );
            if (result.ok) {
                if (result.warnings.length > 0) {
                    const n = result.warnings.length;
                    notify(`Exported HTML with ${n} warning${n === 1 ? '' : 's'}`, 'info');
                }
                flashExportStatus('Exported HTML');
            } else {
                notify(result.error ?? 'Export failed', 'error');
                flashExportStatus('Export failed');
            }
        } catch {
            notify('Export failed', 'error');
            flashExportStatus('Export failed');
        }
    }, [workspaceId, flashExportStatus, notify, client]);

    return { exportOpen, setExportOpen, exportStatus, copyContent, download, saveToNotes, exportHtml };
}
