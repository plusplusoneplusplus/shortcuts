/**
 * Shared Mermaid Zoom/Pan Module
 *
 * Provides unified CSS, HTML, and JS strings for mermaid diagram
 * zoom/pan controls used by both the SPA template (serve mode) and
 * the static website generator.
 *
 * Harmonization decisions:
 *   - Container class: `mermaid-viewport` (more descriptive)
 *   - Label: Parameterized (default: "Diagram")
 *   - mousemove/mouseup: Attached to `document` (robust — allows dragging outside container)
 *   - Null checks on buttons: Yes (safer)
 *   - initMermaid return: Always returns a Promise
 *   - Transition: 0.15s ease-out (smoother)
 *   - Dragging: `transition: none` on `.mermaid-svg-wrapper` during drag
 *   - CSS vars: Uses shared deep-wiki CSS var names
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

// ============================================================================
// CSS — getMermaidZoomStyles()
// ============================================================================

/**
 * Returns the CSS for mermaid container, toolbar, zoom buttons, viewport,
 * svg-wrapper, and drag states. Merged from both spa-template.ts and
 * website-generator.ts, removing duplicates.
 *
 * @returns CSS string (no surrounding `<style>` tags)
 */
export function getMermaidZoomStyles(): string {
    return `/* Mermaid diagrams — base */
        .markdown-body pre.mermaid {
            background: transparent;
            border: none;
            padding: 0;
            margin: 0;
            text-align: center;
        }
        .markdown-body pre.mermaid svg {
            max-width: 100%;
            height: auto;
        }

        /* Mermaid container with zoom/pan support */
        .markdown-body .mermaid-container {
            position: relative;
            margin: 24px 0;
            border: 1px solid var(--content-border);
            border-radius: 8px;
            overflow: hidden;
            background: var(--code-bg);
            max-width: 100%;
            width: 100%;
        }
        .mermaid-toolbar {
            display: flex;
            align-items: center;
            padding: 6px 12px;
            background: var(--code-bg);
            border-bottom: 1px solid var(--content-border);
            gap: 4px;
            user-select: none;
        }
        .mermaid-toolbar-label {
            font-size: 11px;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.05em;
            color: var(--content-muted);
            margin-right: auto;
        }
        .mermaid-zoom-btn {
            background: var(--copy-btn-bg);
            border: 1px solid var(--content-border);
            cursor: pointer;
            padding: 2px 8px;
            border-radius: 4px;
            font-size: 14px;
            font-weight: 600;
            line-height: 1.2;
            transition: background-color 0.15s, border-color 0.15s;
            color: var(--content-text);
            min-width: 28px;
            text-align: center;
        }
        .mermaid-zoom-btn:hover {
            background: var(--copy-btn-hover-bg);
            border-color: var(--sidebar-active-border);
        }
        .mermaid-zoom-btn:active {
            transform: scale(0.95);
        }
        .mermaid-zoom-level {
            font-size: 11px;
            font-weight: 500;
            color: var(--content-muted);
            min-width: 42px;
            text-align: center;
            padding: 0 4px;
        }
        .mermaid-zoom-reset {
            font-size: 12px;
        }
        .mermaid-viewport {
            overflow: hidden;
            cursor: grab;
            min-height: 200px;
            position: relative;
        }
        .mermaid-viewport:active {
            cursor: grabbing;
        }
        .mermaid-viewport.mermaid-dragging {
            cursor: grabbing;
        }
        .mermaid-svg-wrapper {
            transform-origin: 0 0;
            transition: transform 0.15s ease-out;
            display: inline-block;
            padding: 24px;
        }
        .mermaid-viewport.mermaid-dragging .mermaid-svg-wrapper {
            transition: none;
        }`;
}

// ============================================================================
// HTML — getMermaidContainerHtml()
// ============================================================================

/**
 * Returns the HTML string for a mermaid container with toolbar and zoom controls.
 * The `mermaidCode` is placed inside a `<pre class="mermaid">` element within the
 * viewport's svg-wrapper.
 *
 * @param mermaidCode - The raw mermaid diagram source code
 * @param label - The toolbar label (default: "Diagram")
 * @returns HTML string for the mermaid container
 */
export function getMermaidContainerHtml(mermaidCode: string, label = 'Diagram'): string {
    return '<div class="mermaid-container">' +
        '<div class="mermaid-toolbar">' +
            '<span class="mermaid-toolbar-label">' + escapeHtml(label) + '</span>' +
            '<button class="mermaid-zoom-btn mermaid-zoom-out" title="Zoom out">\\u2212</button>' +
            '<span class="mermaid-zoom-level">100%</span>' +
            '<button class="mermaid-zoom-btn mermaid-zoom-in" title="Zoom in">+</button>' +
            '<button class="mermaid-zoom-btn mermaid-zoom-reset" title="Reset view">\\u27F2</button>' +
        '</div>' +
        '<div class="mermaid-viewport">' +
            '<div class="mermaid-svg-wrapper">' +
                '<pre class="mermaid">' + mermaidCode + '</pre>' +
            '</div>' +
        '</div>' +
    '</div>';
}

// ============================================================================
// JavaScript — getMermaidZoomScript()
// ============================================================================

/**
 * Returns the JS string for the `initMermaidZoom()` function definition.
 * Includes zoom constants, button handlers, Ctrl/Cmd + wheel zoom toward cursor,
 * and drag panning with document-level mousemove/mouseup (robust for dragging
 * outside the viewport).
 *
 * Called after `mermaid.run()` completes.
 *
 * @returns JavaScript string (no surrounding `<script>` tags)
 */
export function getMermaidZoomScript(): string {
    return `
        var MERMAID_MIN_ZOOM = 0.25;
        var MERMAID_MAX_ZOOM = 4;
        var MERMAID_ZOOM_STEP = 0.25;

        function initMermaidZoom() {
            document.querySelectorAll('.mermaid-container').forEach(function(container) {
                var viewport = container.querySelector('.mermaid-viewport');
                var svgWrapper = container.querySelector('.mermaid-svg-wrapper');
                if (!viewport || !svgWrapper) return;

                var state = { scale: 1, translateX: 0, translateY: 0, isDragging: false, dragStartX: 0, dragStartY: 0, lastTX: 0, lastTY: 0 };

                function applyTransform() {
                    svgWrapper.style.transform = 'translate(' + state.translateX + 'px, ' + state.translateY + 'px) scale(' + state.scale + ')';
                    var display = container.querySelector('.mermaid-zoom-level');
                    if (display) display.textContent = Math.round(state.scale * 100) + '%';
                }

                // Zoom in
                var zoomInBtn = container.querySelector('.mermaid-zoom-in');
                if (zoomInBtn) {
                    zoomInBtn.addEventListener('click', function(e) {
                        e.stopPropagation();
                        state.scale = Math.min(MERMAID_MAX_ZOOM, state.scale + MERMAID_ZOOM_STEP);
                        applyTransform();
                    });
                }

                // Zoom out
                var zoomOutBtn = container.querySelector('.mermaid-zoom-out');
                if (zoomOutBtn) {
                    zoomOutBtn.addEventListener('click', function(e) {
                        e.stopPropagation();
                        state.scale = Math.max(MERMAID_MIN_ZOOM, state.scale - MERMAID_ZOOM_STEP);
                        applyTransform();
                    });
                }

                // Reset
                var resetBtn = container.querySelector('.mermaid-zoom-reset');
                if (resetBtn) {
                    resetBtn.addEventListener('click', function(e) {
                        e.stopPropagation();
                        state.scale = 1;
                        state.translateX = 0;
                        state.translateY = 0;
                        applyTransform();
                    });
                }

                // Ctrl/Cmd + mouse wheel zoom toward cursor
                viewport.addEventListener('wheel', function(e) {
                    if (!e.ctrlKey && !e.metaKey) return;
                    e.preventDefault();
                    e.stopPropagation();
                    var delta = e.deltaY > 0 ? -MERMAID_ZOOM_STEP : MERMAID_ZOOM_STEP;
                    var newScale = Math.max(MERMAID_MIN_ZOOM, Math.min(MERMAID_MAX_ZOOM, state.scale + delta));
                    if (newScale !== state.scale) {
                        var rect = viewport.getBoundingClientRect();
                        var mx = e.clientX - rect.left;
                        var my = e.clientY - rect.top;
                        var px = (mx - state.translateX) / state.scale;
                        var py = (my - state.translateY) / state.scale;
                        state.scale = newScale;
                        state.translateX = mx - px * state.scale;
                        state.translateY = my - py * state.scale;
                        applyTransform();
                    }
                }, { passive: false });

                // Mouse drag panning
                viewport.addEventListener('mousedown', function(e) {
                    if (e.button !== 0) return;
                    state.isDragging = true;
                    state.dragStartX = e.clientX;
                    state.dragStartY = e.clientY;
                    state.lastTX = state.translateX;
                    state.lastTY = state.translateY;
                    viewport.classList.add('mermaid-dragging');
                    e.preventDefault();
                });

                document.addEventListener('mousemove', function(e) {
                    if (!state.isDragging) return;
                    state.translateX = state.lastTX + (e.clientX - state.dragStartX);
                    state.translateY = state.lastTY + (e.clientY - state.dragStartY);
                    applyTransform();
                });

                document.addEventListener('mouseup', function() {
                    if (!state.isDragging) return;
                    state.isDragging = false;
                    viewport.classList.remove('mermaid-dragging');
                });
            });
        }`;
}

// ============================================================================
// Internal Helpers
// ============================================================================

/**
 * Escape HTML special characters (for the toolbar label).
 */
function escapeHtml(str: string): string {
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
