/**
 * DiagramViewerShell — full-page view-only Excalidraw viewer.
 *
 * Rendered when `window.location.pathname` starts with `/diagram/`.
 * URL format: `/diagram/<workspaceId>/<diagramPath>`
 *
 * Fetches diagram data from the REST API and renders a full-viewport
 * read-only Excalidraw canvas with pan/zoom. A top bar shows the diagram
 * name and a back button.
 */

import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { Excalidraw } from '@excalidraw/excalidraw';
import { ThemeProvider } from '../../layout/ThemeProvider';
import { getApiBase, isExcalidrawEnabled } from '../../utils/config';
import { SHOW_EXCALIDRAW_DIAGRAMS } from '../../featureFlags';
import { unwrapDiagramResponse, buildViewerInitialData, type ExcalidrawScene } from './diagram-scene';

// Minimal subset of Excalidraw's imperative API that we actually consume.
// Avoids pulling the real (extremely heavy) type into the module signature,
// which is also what the test-time stub of `@excalidraw/excalidraw` exposes.
interface ExcalidrawApiLike {
    scrollToContent?: (target?: readonly any[], opts?: { fitToContent?: boolean }) => void;
}

// ── URL parsing ────────────────────────────────────────────────────────────────

export interface DiagramViewerParams {
    workspaceId: string;
    diagramPath: string;
}

/**
 * Parse `/diagram/:wsId/:path` from `window.location.pathname`.
 * Returns null if the pathname doesn't match.
 */
export function parseDiagramViewerRoute(pathname: string): DiagramViewerParams | null {
    const match = pathname.match(/^\/diagram\/([^/]+)\/(.+)$/);
    if (!match) return null;
    return {
        workspaceId: decodeURIComponent(match[1]),
        diagramPath: decodeURIComponent(match[2]),
    };
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function diagramApiUrl(wsId: string, filename: string): string {
    return `${getApiBase()}/workspaces/${encodeURIComponent(wsId)}/diagrams/${encodeURIComponent(filename)}`;
}

function displayName(p: string): string {
    return p.replace(/\.excalidraw$/i, '');
}

// ── Viewer content ─────────────────────────────────────────────────────────────

type LoadState = 'loading' | 'loaded' | 'error';

function DiagramViewerContent({ params }: { params: DiagramViewerParams }) {
    const [state, setState] = useState<LoadState>('loading');
    const [sceneData, setSceneData] = useState<ExcalidrawScene | null>(null);
    const [errorMsg, setErrorMsg] = useState('');
    const apiRef = useRef<ExcalidrawApiLike | null>(null);

    const name = useMemo(() => displayName(params.diagramPath), [params.diagramPath]);

    const initialData = useMemo(
        () => (sceneData ? buildViewerInitialData(sceneData) : null),
        [sceneData],
    );

    // After the scene mounts, ask Excalidraw to fit the content into the
    // viewport. Without this, view-mode canvases stay parked at scroll (0,0)
    // and elements positioned well off the origin (which the LLM happily
    // does) appear as a blank canvas. We retry a couple of animation frames
    // because the API ref is set before the canvas is fully sized.
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

    useEffect(() => {
        let cancelled = false;
        setState('loading');

        fetch(diagramApiUrl(params.workspaceId, params.diagramPath))
            .then(async (res) => {
                if (cancelled) return;
                if (res.status === 404) {
                    throw new Error('Diagram not found');
                }
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
    }, [params.workspaceId, params.diagramPath]);

    const handleBack = useCallback(() => {
        if (window.history.length > 1) {
            window.history.back();
        } else {
            window.location.href = '/';
        }
    }, []);

    return (
        <div className="flex flex-col h-screen bg-white dark:bg-[#1e1e1e]" data-testid="diagram-viewer-shell">
            {/* Top bar */}
            <div className="flex items-center gap-2 px-3 py-2 border-b border-[#e0e0e0] dark:border-[#333] bg-[#f5f5f5] dark:bg-[#252526] shrink-0">
                <button
                    type="button"
                    onClick={handleBack}
                    className="text-sm px-2 py-1 rounded hover:bg-[#e0e0e0] dark:hover:bg-[#3a3a3a] text-[#1e1e1e] dark:text-[#cccccc]"
                    data-testid="diagram-viewer-back"
                >
                    ← Back
                </button>
                <span
                    className="text-sm font-semibold text-[#1e1e1e] dark:text-[#cccccc] truncate"
                    data-testid="diagram-viewer-title"
                    title={params.diagramPath}
                >
                    📐 {name}
                </span>
            </div>

            {/* Canvas area */}
            <div className="flex-1 relative" data-testid="diagram-viewer-canvas">
                {state === 'loading' && (
                    <div className="flex items-center justify-center h-full text-sm text-[#848484]">
                        Loading diagram…
                    </div>
                )}
                {state === 'error' && (
                    <div className="flex flex-col items-center justify-center h-full gap-3">
                        <span className="text-sm text-[#848484]">
                            ⚠️ {errorMsg || 'Failed to load diagram'}
                        </span>
                        <button
                            type="button"
                            onClick={handleBack}
                            className="text-sm px-3 py-1 rounded bg-[#e0e0e0] dark:bg-[#3a3a3a] hover:bg-[#d0d0d0] dark:hover:bg-[#4a4a4a] text-[#1e1e1e] dark:text-[#cccccc]"
                        >
                            ← Go Back
                        </button>
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

// ── Shell entry point ──────────────────────────────────────────────────────────

export function DiagramViewerShell() {
    const params = parseDiagramViewerRoute(window.location.pathname);

    // Feature flag off → show 404
    if (!SHOW_EXCALIDRAW_DIAGRAMS || !isExcalidrawEnabled()) {
        return (
            <ThemeProvider>
                <div className="flex items-center justify-center h-screen text-sm text-[#848484]">
                    Page not found.
                </div>
            </ThemeProvider>
        );
    }

    if (!params) {
        return (
            <ThemeProvider>
                <div className="flex items-center justify-center h-screen text-sm text-[#848484]">
                    Invalid diagram URL.
                </div>
            </ThemeProvider>
        );
    }

    return (
        <ThemeProvider>
            <DiagramViewerContent params={params} />
        </ThemeProvider>
    );
}
