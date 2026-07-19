import { useEffect, useMemo, useRef, useState } from 'react';
import { MarkdownView } from '../../shared/MarkdownView';
import { sanitizeSvg } from '../../shared/svg/sanitizeSvg';
import { useZoomPan } from '../../hooks/ui/useZoomPan';

interface SvgDimensions {
    width: number;
    height: number;
}

export interface SvgCanvasViewProps {
    source: string;
    sourceHtml: string;
}

function readSvgDimensions(svg: string): SvgDimensions {
    const root = new DOMParser().parseFromString(svg, 'image/svg+xml').documentElement;
    const viewBox = root.getAttribute('viewBox')?.trim().split(/[\s,]+/).map(Number);
    if (viewBox?.length === 4 && viewBox.every(Number.isFinite) && viewBox[2] > 0 && viewBox[3] > 0) {
        return { width: viewBox[2], height: viewBox[3] };
    }

    const width = Number.parseFloat(root.getAttribute('width') ?? '');
    const height = Number.parseFloat(root.getAttribute('height') ?? '');
    return {
        width: Number.isFinite(width) && width > 0 ? width : 800,
        height: Number.isFinite(height) && height > 0 ? height : 600,
    };
}

export function SvgCanvasView({ source, sourceHtml }: SvgCanvasViewProps) {
    const [surface, setSurface] = useState<'rendered' | 'source'>('rendered');
    const hostRef = useRef<HTMLDivElement>(null);
    const sanitized = useMemo(() => sanitizeSvg(source), [source]);
    const dimensions = useMemo(
        () => sanitized.ok ? readSvgDimensions(sanitized.svg) : { width: 800, height: 600 },
        [sanitized],
    );
    const { containerRef, state, svgTransform } = useZoomPan({
        contentWidth: dimensions.width,
        contentHeight: dimensions.height,
    });

    useEffect(() => {
        if (!sanitized.ok || !hostRef.current) {
            return;
        }

        const shadowRoot = hostRef.current.shadowRoot ?? hostRef.current.attachShadow({ mode: 'open' });
        const style = document.createElement('style');
        style.textContent = `
            :host { display: block; width: 100%; height: 100%; }
            .svg-canvas-content { width: max-content; min-width: 1px; transform-origin: 0 0; }
            svg { display: block; max-width: none; }
        `;
        const content = document.createElement('div');
        content.className = 'svg-canvas-content';
        content.innerHTML = sanitized.svg;
        shadowRoot.replaceChildren(style, content);
    }, [sanitized]);

    useEffect(() => {
        const content = hostRef.current?.shadowRoot?.querySelector<HTMLElement>('.svg-canvas-content');
        if (content) {
            content.style.transform = svgTransform;
        }
    }, [svgTransform, sanitized]);

    return (
        <div className="flex h-full min-h-[200px] flex-col" data-testid="svg-canvas-view">
            <div className="flex shrink-0 justify-end border-b border-[#e0e0e0] px-3 py-1.5 dark:border-[#474749]">
                <div className="flex overflow-hidden rounded-md border border-[#e0e0e0] dark:border-[#3c3c3c]">
                    <button
                        type="button"
                        className={`px-2 py-0.5 text-[11px] ${surface === 'source' ? 'bg-[#0078d4] text-white' : 'text-[#616161] dark:text-[#cccccc]'}`}
                        onClick={() => setSurface('source')}
                        data-testid="svg-canvas-source"
                    >
                        Source
                    </button>
                    <button
                        type="button"
                        className={`px-2 py-0.5 text-[11px] ${surface === 'rendered' ? 'bg-[#0078d4] text-white' : 'text-[#616161] dark:text-[#cccccc]'}`}
                        onClick={() => setSurface('rendered')}
                        data-testid="svg-canvas-rendered"
                    >
                        Rendered
                    </button>
                </div>
            </div>

            <div
                ref={containerRef}
                className={`${surface === 'rendered' ? 'block' : 'hidden'} relative flex-1 min-h-0 overflow-hidden bg-white dark:bg-[#1e1e1e]`}
                data-testid="svg-canvas-viewport"
                data-scale={state.scale}
                data-translate-x={state.translateX}
                data-translate-y={state.translateY}
            >
                {sanitized.ok ? (
                    <div ref={hostRef} className="h-full w-full" data-testid="svg-canvas-shadow-host" />
                ) : (
                    <div className="h-full overflow-auto p-3 text-xs" data-no-drag data-testid="svg-canvas-error">
                        <div className="mb-2 text-red-500">{sanitized.error}</div>
                        <pre className="whitespace-pre-wrap font-mono text-[#1e1e1e] dark:text-[#cccccc]">{source}</pre>
                    </div>
                )}
            </div>

            <div className={`${surface === 'source' ? 'block' : 'hidden'} flex-1 overflow-auto p-3`} data-testid="svg-canvas-source-view">
                <MarkdownView html={sourceHtml} />
            </div>
        </div>
    );
}
