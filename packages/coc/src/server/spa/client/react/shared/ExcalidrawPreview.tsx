/**
 * ExcalidrawPreview — read-only Excalidraw canvas for inline chat previews.
 *
 * Reads the scene from the canvas store (`GET /api/workspaces/:wsId/canvases/:id`)
 * and renders it with @excalidraw/excalidraw in view-only mode. Pan/zoom are
 * enabled. Excalidraw diagrams are canvases, so this shares the canvas store and
 * the scene-normalization stack with the side panel.
 */

import React, { useEffect, useState, useMemo, useRef } from 'react';
import { Excalidraw } from '@excalidraw/excalidraw';
import type { Canvas } from '@plusplusoneplusplus/coc-client';
import { getApiBase, isCanvasEnabled } from '../utils/config';
import { SHOW_EXCALIDRAW_DIAGRAMS } from '../featureFlags';
import {
    parseSceneContent,
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
    /** Workspace ID that owns the canvas. */
    workspaceId: string;
    /** Canvas ID of the excalidraw canvas to render. */
    canvasId: string;
    /** Already-loaded canvas record; avoids a second fetch from a type-aware embed. */
    canvas?: Canvas;
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

function canvasApiUrl(wsId: string, canvasId: string): string {
    return `${getApiBase()}/workspaces/${encodeURIComponent(wsId)}/canvases/${encodeURIComponent(canvasId)}`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ExcalidrawPreview({ workspaceId, canvasId, canvas, height = DEFAULT_HEIGHT }: ExcalidrawPreviewProps) {
    const enabled = SHOW_EXCALIDRAW_DIAGRAMS || isCanvasEnabled();
    const [state, setState] = useState<LoadState>('loading');
    const [sceneData, setSceneData] = useState<ExcalidrawScene | null>(null);
    const [title, setTitle] = useState('');
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

    // Fetch the excalidraw canvas scene from the canvas store.
    useEffect(() => {
        if (!enabled) return;

        let cancelled = false;
        setState('loading');

        if (canvas) {
            if (canvas.type !== 'excalidraw') {
                setErrorMsg('This canvas is not an Excalidraw diagram');
                setState('error');
                return;
            }
            setSceneData(parseSceneContent(canvas.content));
            setTitle(canvas.title);
            setState('loaded');
            return;
        }

        fetch(canvasApiUrl(workspaceId, canvasId))
            .then(async (res) => {
                if (cancelled) return;
                if (!res.ok) {
                    throw new Error(`HTTP ${res.status}`);
                }
                const data = await res.json();
                if (cancelled) return;
                const canvas = data?.canvas;
                setSceneData(parseSceneContent(canvas?.content));
                setTitle(typeof canvas?.title === 'string' ? canvas.title : '');
                setState('loaded');
            })
            .catch((err) => {
                if (cancelled) return;
                setErrorMsg(err?.message || 'Failed to load diagram');
                setState('error');
            });

        return () => { cancelled = true; };
    }, [workspaceId, canvasId, canvas, enabled]);

    if (!enabled) return null;

    const name = title || 'Diagram';

    return (
        <div className="md-excalidraw-preview" ref={containerRef} data-canvas-id={canvasId}>
            {/* Toolbar */}
            <div className="md-excalidraw-preview-toolbar">
                <span className="md-excalidraw-preview-title" title={name}>
                    📐 {name}
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
