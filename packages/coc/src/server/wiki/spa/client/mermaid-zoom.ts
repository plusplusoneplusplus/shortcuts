/**
 * Mermaid diagram zoom/pan controls.
 *
 * Extracted from the getMermaidZoomScript() string in rendering/mermaid-zoom.ts
 * into real TypeScript for client-side bundling.
 */

const MERMAID_MIN_ZOOM = 0.25;
const MERMAID_MAX_ZOOM = 4;
const MERMAID_ZOOM_STEP = 0.25;

interface MermaidZoomState {
    scale: number;
    translateX: number;
    translateY: number;
    isDragging: boolean;
    dragStartX: number;
    dragStartY: number;
    lastTX: number;
    lastTY: number;
}

export function initMermaidZoom(): void {
    document.querySelectorAll('.mermaid-container').forEach(function (container) {
        const viewport = container.querySelector('.mermaid-viewport') as HTMLElement | null;
        const svgWrapper = container.querySelector('.mermaid-svg-wrapper') as HTMLElement | null;
        if (!viewport || !svgWrapper) return;

        const state: MermaidZoomState = {
            scale: 1, translateX: 0, translateY: 0,
            isDragging: false, dragStartX: 0, dragStartY: 0, lastTX: 0, lastTY: 0
        };

        function applyTransform(): void {
            svgWrapper!.style.transform = 'translate(' + state.translateX + 'px, ' + state.translateY + 'px) scale(' + state.scale + ')';
            const display = container.querySelector('.mermaid-zoom-level');
            if (display) display.textContent = Math.round(state.scale * 100) + '%';
        }

        // Zoom in
        const zoomInBtn = container.querySelector('.mermaid-zoom-in');
        if (zoomInBtn) {
            zoomInBtn.addEventListener('click', function (e) {
                e.stopPropagation();
                state.scale = Math.min(MERMAID_MAX_ZOOM, state.scale + MERMAID_ZOOM_STEP);
                applyTransform();
            });
        }

        // Zoom out
        const zoomOutBtn = container.querySelector('.mermaid-zoom-out');
        if (zoomOutBtn) {
            zoomOutBtn.addEventListener('click', function (e) {
                e.stopPropagation();
                state.scale = Math.max(MERMAID_MIN_ZOOM, state.scale - MERMAID_ZOOM_STEP);
                applyTransform();
            });
        }

        // Reset
        const resetBtn = container.querySelector('.mermaid-zoom-reset');
        if (resetBtn) {
            resetBtn.addEventListener('click', function (e) {
                e.stopPropagation();
                state.scale = 1;
                state.translateX = 0;
                state.translateY = 0;
                applyTransform();
            });
        }

        // Ctrl/Cmd + mouse wheel zoom toward cursor
        viewport.addEventListener('wheel', function (e: WheelEvent) {
            if (!e.ctrlKey && !e.metaKey) return;
            e.preventDefault();
            e.stopPropagation();
            const delta = e.deltaY > 0 ? -MERMAID_ZOOM_STEP : MERMAID_ZOOM_STEP;
            const newScale = Math.max(MERMAID_MIN_ZOOM, Math.min(MERMAID_MAX_ZOOM, state.scale + delta));
            if (newScale !== state.scale) {
                const rect = viewport!.getBoundingClientRect();
                const mx = e.clientX - rect.left;
                const my = e.clientY - rect.top;
                const px = (mx - state.translateX) / state.scale;
                const py = (my - state.translateY) / state.scale;
                state.scale = newScale;
                state.translateX = mx - px * state.scale;
                state.translateY = my - py * state.scale;
                applyTransform();
            }
        }, { passive: false });

        // Mouse drag panning
        viewport.addEventListener('mousedown', function (e: MouseEvent) {
            if (e.button !== 0) return;
            state.isDragging = true;
            state.dragStartX = e.clientX;
            state.dragStartY = e.clientY;
            state.lastTX = state.translateX;
            state.lastTY = state.translateY;
            viewport!.classList.add('mermaid-dragging');
            e.preventDefault();
        });

        document.addEventListener('mousemove', function (e: MouseEvent) {
            if (!state.isDragging) return;
            state.translateX = state.lastTX + (e.clientX - state.dragStartX);
            state.translateY = state.lastTY + (e.clientY - state.dragStartY);
            applyTransform();
        });

        document.addEventListener('mouseup', function () {
            if (!state.isDragging) return;
            state.isDragging = false;
            viewport!.classList.remove('mermaid-dragging');
        });
    });
}
