/**
 * ExcalidrawPreview — read-only Excalidraw canvas for inline chat previews.
 *
 * Fetches diagram data from the diagrams REST API and renders using
 * @excalidraw/excalidraw in view-only mode.  Pan/zoom are enabled;
 * clicking navigates to the full viewer page.
 */

import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { Excalidraw } from '@excalidraw/excalidraw';
import { getApiBase } from '../utils/config';
import { SHOW_EXCALIDRAW_DIAGRAMS } from '../featureFlags';
import {
    unwrapDiagramResponse,
    buildViewerInitialData,
    type ExcalidrawScene,
} from '../features/diagrams/diagram-scene';

interface ExcalidrawApiLike {
    scrollToContent?: (target?: readonly any[], opts?: { fitToContent?: boolean }) => void;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ExcalidrawPreviewProps {
    /** Workspace ID that owns the diagram. */
    workspaceId: string;
    /** Diagram filename (e.g. "architecture.excalidraw"). */
    diagramPath: string;
    /** Height of the preview canvas in pixels. */
    height?: number;
}

type LoadState = 'loading' | 'loaded' | 'error';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_HEIGHT = 400;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function diagramApiUrl(wsId: string, filename: string): string {
    return `${getApiBase()}/workspaces/${encodeURIComponent(wsId)}/diagrams/${encodeURIComponent(filename)}`;
}

function viewerUrl(wsId: string, diagramPath: string): string {
    return `/diagram/${encodeURIComponent(wsId)}/${encodeURIComponent(diagramPath)}`;
}

function displayName(path: string): string {
    return path.replace(/\.excalidraw$/i, '');
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ExcalidrawPreview({ workspaceId, diagramPath, height = DEFAULT_HEIGHT }: ExcalidrawPreviewProps) {
    const [state, setState] = useState<LoadState>('loading');
    const [sceneData, setSceneData] = useState<ExcalidrawScene | null>(null);
    const [errorMsg, setErrorMsg] = useState('');
    const containerRef = useRef<HTMLDivElement>(null);
    const apiRef = useRef<ExcalidrawApiLike | null>(null);

    const initialData = useMemo(
        () => (sceneData ? buildViewerInitialData(sceneData) : null),
        [sceneData],
    );

    // Same fit-to-content scroll as the full-page viewer — without it the
    // inline preview parks at scroll (0,0) and elements drawn at non-zero
    // coordinates are off-screen, so the preview renders blank.
    useEffect(() => {
        if (state !== 'loaded' || !initialData) return;
        const elements = initialData.elements as readonly any[];
        if (!Array.isArray(elements) || elements.length === 0) return;
        let cancelled = false;
        let attempts = 0;
        const tick = () => {
            if (cancelled) return;
            const api = apiRef.current;
            if (api?.scrollToContent) {
                try {
                    api.scrollToContent(elements, { fitToContent: true });
                    return;
                } catch {
                    // fall through to retry
                }
            }
            if (attempts++ < 20) {
                requestAnimationFrame(tick);
            }
        };
        requestAnimationFrame(tick);
        return () => { cancelled = true; };
    }, [state, initialData]);

    // Fetch diagram content
    useEffect(() => {
        if (!SHOW_EXCALIDRAW_DIAGRAMS) return;

        let cancelled = false;
        setState('loading');

        fetch(diagramApiUrl(workspaceId, diagramPath))
            .then(async (res) => {
                if (cancelled) return;
                if (!res.ok) {
                    throw new Error(`HTTP ${res.status}`);
                }
                const data = await res.json();
                if (cancelled) return;
                setSceneData(unwrapDiagramResponse(data));
                setState('loaded');
            })
            .catch((err) => {
                if (cancelled) return;
                setErrorMsg(err?.message || 'Failed to load diagram');
                setState('error');
            });

        return () => { cancelled = true; };
    }, [workspaceId, diagramPath]);

    // Navigate to viewer on click
    const handleClick = useCallback(() => {
        window.open(viewerUrl(workspaceId, diagramPath), '_blank', 'noopener');
    }, [workspaceId, diagramPath]);

    if (!SHOW_EXCALIDRAW_DIAGRAMS) return null;

    const name = displayName(diagramPath);

    return (
        <div className="md-excalidraw-preview" ref={containerRef}>
            {/* Toolbar */}
            <div className="md-excalidraw-preview-toolbar">
                <span className="md-excalidraw-preview-title" title={diagramPath}>
                    📐 {name}
                </span>
                <span className="md-excalidraw-preview-actions">
                    <button type="button" onClick={handleClick} title="Open in viewer">
                        Open
                    </button>
                </span>
            </div>

            {/* Canvas area */}
            <div
                className="md-excalidraw-preview-canvas"
                style={{ height: `${height}px` }}
            >
                {state === 'loading' && (
                    <div className="md-excalidraw-preview-loading">Loading diagram…</div>
                )}
                {state === 'error' && (
                    <div className="md-excalidraw-preview-error">
                        ⚠️ {errorMsg || 'Failed to load diagram'}
                    </div>
                )}
                {state === 'loaded' && initialData && (
                    <Excalidraw
                        initialData={initialData}
                        excalidrawAPI={(api: any) => { apiRef.current = api as ExcalidrawApiLike; }}
                        viewModeEnabled={true}
                        zenModeEnabled={true}
                        gridModeEnabled={false}
                        UIOptions={{
                            canvasActions: {
                                changeViewBackgroundColor: false,
                                clearCanvas: false,
                                export: false,
                                loadScene: false,
                                saveToActiveFile: false,
                                toggleTheme: false,
                                saveAsImage: false,
                            },
                            tools: { image: false },
                        }}
                        renderTopRightUI={() => null}
                    />
                )}
            </div>
        </div>
    );
}
