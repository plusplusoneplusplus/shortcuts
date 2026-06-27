/**
 * ExcalidrawSceneView — view-only Excalidraw renderer for an in-memory scene.
 *
 * The shared presentational half of the diagram rendering stack: given an
 * already-parsed `ExcalidrawScene` it mounts `@excalidraw/excalidraw` in
 * view-only mode (no editing affordances) and fits the content into the
 * viewport. Consumers (the canvas panel, inline chat preview) read the scene
 * from the canvas store and hand it here, so there is a single place that owns
 * the view-only Excalidraw configuration and the fit-to-content behaviour.
 *
 * View-only is enforced via `viewModeEnabled` + `zenModeEnabled` and by
 * disabling every canvas action in `UIOptions`, mirroring the standalone
 * DiagramViewerShell viewer.
 */

import React, { useEffect, useMemo, useRef } from 'react';
import { Excalidraw } from '@excalidraw/excalidraw';
import { buildViewerInitialData, type ExcalidrawScene } from './diagram-scene';

// Minimal subset of Excalidraw's imperative API we actually consume — also what
// the test-time stub of `@excalidraw/excalidraw` exposes.
interface ExcalidrawApiLike {
    scrollToContent?: (target?: readonly any[], opts?: { fitToContent?: boolean }) => void;
}

export interface ExcalidrawSceneViewProps {
    /** Already-parsed Excalidraw scene to render. */
    scene: ExcalidrawScene;
    /** Optional className for the wrapping element. */
    className?: string;
    /** Optional test id for the wrapping element. */
    'data-testid'?: string;
}

export function ExcalidrawSceneView({ scene, className, 'data-testid': testId }: ExcalidrawSceneViewProps) {
    const apiRef = useRef<ExcalidrawApiLike | null>(null);
    const initialData = useMemo(() => buildViewerInitialData(scene), [scene]);

    // After the scene mounts, ask Excalidraw to fit the content into the
    // viewport. Without this, view-mode canvases stay parked at scroll (0,0)
    // and elements positioned off the origin (which the LLM happily does)
    // render as a blank canvas. Retry a few frames because the API ref is set
    // before the canvas is fully sized.
    useEffect(() => {
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
    }, [initialData]);

    return (
        <div className={className} data-testid={testId}>
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
        </div>
    );
}
