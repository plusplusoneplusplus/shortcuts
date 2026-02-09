/**
 * Mermaid Zoom/Pan Module Tests
 *
 * Tests the shared mermaid zoom/pan CSS, HTML, and JS that are used by both
 * spa-template.ts (serve mode) and website-generator.ts (static site).
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import { describe, it, expect } from 'vitest';
import {
    getMermaidZoomStyles,
    getMermaidContainerHtml,
    getMermaidZoomScript,
} from '../../src/rendering/mermaid-zoom';

// ============================================================================
// getMermaidZoomStyles — CSS output
// ============================================================================

describe('getMermaidZoomStyles', () => {
    const css = getMermaidZoomStyles();

    // --- Base mermaid diagram styles ---
    it('should include transparent background for pre.mermaid', () => {
        expect(css).toContain('pre.mermaid');
        expect(css).toContain('background: transparent');
    });

    it('should remove border and padding from pre.mermaid', () => {
        expect(css).toContain('border: none');
        expect(css).toContain('padding: 0');
    });

    it('should set pre.mermaid svg to max-width 100% and auto height', () => {
        expect(css).toContain('pre.mermaid svg');
        expect(css).toContain('height: auto');
    });

    // --- Container ---
    it('should include .mermaid-container class', () => {
        expect(css).toContain('.mermaid-container');
    });

    it('should set container border with CSS var', () => {
        expect(css).toContain('var(--content-border)');
    });

    it('should set container background to code-bg', () => {
        expect(css).toContain('var(--code-bg)');
    });

    it('should set container border-radius to 8px', () => {
        expect(css).toContain('border-radius: 8px');
    });

    it('should set container max-width and width to 100%', () => {
        expect(css).toContain('max-width: 100%');
        expect(css).toContain('width: 100%');
    });

    // --- Toolbar ---
    it('should include .mermaid-toolbar class', () => {
        expect(css).toContain('.mermaid-toolbar');
    });

    it('should include toolbar label with uppercase styling', () => {
        expect(css).toContain('.mermaid-toolbar-label');
        expect(css).toContain('text-transform: uppercase');
    });

    it('should include user-select none for toolbar', () => {
        expect(css).toContain('user-select: none');
    });

    // --- Zoom buttons ---
    it('should include .mermaid-zoom-btn class', () => {
        expect(css).toContain('.mermaid-zoom-btn');
    });

    it('should include hover state for zoom buttons', () => {
        expect(css).toContain('.mermaid-zoom-btn:hover');
    });

    it('should include active state for zoom buttons (scale)', () => {
        expect(css).toContain('.mermaid-zoom-btn:active');
        expect(css).toContain('transform: scale(0.95)');
    });

    it('should include .mermaid-zoom-level display', () => {
        expect(css).toContain('.mermaid-zoom-level');
        expect(css).toContain('min-width: 42px');
    });

    it('should include .mermaid-zoom-reset class', () => {
        expect(css).toContain('.mermaid-zoom-reset');
    });

    // --- Viewport (harmonized name) ---
    it('should use mermaid-viewport class (not mermaid-preview)', () => {
        expect(css).toContain('.mermaid-viewport');
        expect(css).not.toContain('.mermaid-preview');
    });

    it('should set viewport cursor to grab', () => {
        expect(css).toContain('cursor: grab');
    });

    it('should set viewport min-height to 200px', () => {
        expect(css).toContain('min-height: 200px');
    });

    it('should set grabbing cursor on viewport active', () => {
        expect(css).toContain('.mermaid-viewport:active');
        expect(css).toContain('cursor: grabbing');
    });

    it('should set grabbing cursor during drag', () => {
        expect(css).toContain('.mermaid-viewport.mermaid-dragging');
    });

    // --- SVG wrapper ---
    it('should include .mermaid-svg-wrapper class', () => {
        expect(css).toContain('.mermaid-svg-wrapper');
    });

    it('should set transform-origin to 0 0', () => {
        expect(css).toContain('transform-origin: 0 0');
    });

    it('should set transition to 0.15s ease-out (harmonized)', () => {
        expect(css).toContain('transition: transform 0.15s ease-out');
    });

    it('should disable transition during drag', () => {
        expect(css).toContain('.mermaid-viewport.mermaid-dragging .mermaid-svg-wrapper');
        expect(css).toContain('transition: none');
    });

    it('should set svg-wrapper padding to 24px', () => {
        expect(css).toContain('padding: 24px');
    });

    // --- Return type ---
    it('should return a non-empty string', () => {
        expect(typeof css).toBe('string');
        expect(css.length).toBeGreaterThan(100);
    });

    it('should not include <style> tags', () => {
        expect(css).not.toContain('<style>');
        expect(css).not.toContain('</style>');
    });
});

// ============================================================================
// getMermaidContainerHtml — HTML output
// ============================================================================

describe('getMermaidContainerHtml', () => {
    // --- Container structure ---
    it('should wrap content in mermaid-container div', () => {
        const html = getMermaidContainerHtml('graph TD; A-->B');
        expect(html).toContain('<div class="mermaid-container">');
        expect(html).toContain('</div>');
    });

    it('should include mermaid-toolbar', () => {
        const html = getMermaidContainerHtml('graph TD; A-->B');
        expect(html).toContain('class="mermaid-toolbar"');
    });

    it('should use mermaid-viewport class (not mermaid-preview)', () => {
        const html = getMermaidContainerHtml('graph TD; A-->B');
        expect(html).toContain('class="mermaid-viewport"');
        expect(html).not.toContain('mermaid-preview');
    });

    it('should include mermaid-svg-wrapper', () => {
        const html = getMermaidContainerHtml('graph TD; A-->B');
        expect(html).toContain('class="mermaid-svg-wrapper"');
    });

    it('should include pre.mermaid element with the mermaid code', () => {
        const code = 'graph TD; A-->B';
        const html = getMermaidContainerHtml(code);
        expect(html).toContain('<pre class="mermaid">' + code + '</pre>');
    });

    // --- Toolbar label ---
    it('should default label to "Diagram"', () => {
        const html = getMermaidContainerHtml('graph TD; A-->B');
        expect(html).toContain('Diagram');
    });

    it('should accept custom label', () => {
        const html = getMermaidContainerHtml('graph TD; A-->B', 'Flow Chart');
        expect(html).toContain('Flow Chart');
    });

    it('should escape HTML in label', () => {
        const html = getMermaidContainerHtml('graph TD; A-->B', '<script>alert("xss")</script>');
        expect(html).not.toContain('<script>alert("xss")</script>');
        expect(html).toContain('&lt;script&gt;');
    });

    // --- Zoom controls ---
    it('should include zoom in button', () => {
        const html = getMermaidContainerHtml('graph TD; A-->B');
        expect(html).toContain('mermaid-zoom-in');
        expect(html).toContain('Zoom in');
    });

    it('should include zoom out button', () => {
        const html = getMermaidContainerHtml('graph TD; A-->B');
        expect(html).toContain('mermaid-zoom-out');
        expect(html).toContain('Zoom out');
    });

    it('should include zoom reset button', () => {
        const html = getMermaidContainerHtml('graph TD; A-->B');
        expect(html).toContain('mermaid-zoom-reset');
        expect(html).toContain('Reset view');
    });

    it('should include zoom level display', () => {
        const html = getMermaidContainerHtml('graph TD; A-->B');
        expect(html).toContain('mermaid-zoom-level');
        expect(html).toContain('100%');
    });

    // --- Mermaid code handling ---
    it('should preserve mermaid code as-is (no escaping)', () => {
        const code = 'graph LR\n  A["Source <br/> Module"] --> B[Target]';
        const html = getMermaidContainerHtml(code);
        expect(html).toContain(code);
    });

    it('should handle empty mermaid code', () => {
        const html = getMermaidContainerHtml('');
        expect(html).toContain('<pre class="mermaid"></pre>');
    });

    it('should handle multi-line mermaid code', () => {
        const code = 'sequenceDiagram\n  Alice->>Bob: Hello\n  Bob->>Alice: Hi';
        const html = getMermaidContainerHtml(code);
        expect(html).toContain(code);
    });

    // --- Return type ---
    it('should return a non-empty string', () => {
        const html = getMermaidContainerHtml('graph TD; A-->B');
        expect(typeof html).toBe('string');
        expect(html.length).toBeGreaterThan(50);
    });
});

// ============================================================================
// getMermaidZoomScript — JS output
// ============================================================================

describe('getMermaidZoomScript', () => {
    const js = getMermaidZoomScript();

    // --- Zoom constants ---
    it('should define MERMAID_MIN_ZOOM = 0.25', () => {
        expect(js).toContain('MERMAID_MIN_ZOOM = 0.25');
    });

    it('should define MERMAID_MAX_ZOOM = 4', () => {
        expect(js).toContain('MERMAID_MAX_ZOOM = 4');
    });

    it('should define MERMAID_ZOOM_STEP = 0.25', () => {
        expect(js).toContain('MERMAID_ZOOM_STEP = 0.25');
    });

    // --- Function definition ---
    it('should define initMermaidZoom function', () => {
        expect(js).toContain('function initMermaidZoom()');
    });

    it('should query .mermaid-container elements', () => {
        expect(js).toContain(".querySelectorAll('.mermaid-container')");
    });

    // --- Viewport selector (harmonized) ---
    it('should query .mermaid-viewport (not .mermaid-preview)', () => {
        expect(js).toContain(".querySelector('.mermaid-viewport')");
        expect(js).not.toContain(".querySelector('.mermaid-preview')");
    });

    it('should query .mermaid-svg-wrapper', () => {
        expect(js).toContain(".querySelector('.mermaid-svg-wrapper')");
    });

    it('should null-check viewport and svgWrapper', () => {
        expect(js).toContain('if (!viewport || !svgWrapper) return');
    });

    // --- applyTransform ---
    it('should define applyTransform function', () => {
        expect(js).toContain('function applyTransform()');
    });

    it('should apply translate and scale transform', () => {
        expect(js).toContain("'translate('");
        expect(js).toContain("'px) scale('");
    });

    it('should update zoom level display with percentage', () => {
        expect(js).toContain('Math.round(state.scale * 100)');
    });

    it('should null-check display element in applyTransform', () => {
        expect(js).toContain("var display = container.querySelector('.mermaid-zoom-level')");
        expect(js).toContain('if (display)');
    });

    // --- Zoom in button ---
    it('should null-check zoom in button', () => {
        expect(js).toContain("var zoomInBtn = container.querySelector('.mermaid-zoom-in')");
        expect(js).toContain('if (zoomInBtn)');
    });

    it('should clamp zoom in to MERMAID_MAX_ZOOM', () => {
        expect(js).toContain('Math.min(MERMAID_MAX_ZOOM, state.scale + MERMAID_ZOOM_STEP)');
    });

    // --- Zoom out button ---
    it('should null-check zoom out button', () => {
        expect(js).toContain("var zoomOutBtn = container.querySelector('.mermaid-zoom-out')");
        expect(js).toContain('if (zoomOutBtn)');
    });

    it('should clamp zoom out to MERMAID_MIN_ZOOM', () => {
        expect(js).toContain('Math.max(MERMAID_MIN_ZOOM, state.scale - MERMAID_ZOOM_STEP)');
    });

    // --- Reset button ---
    it('should null-check reset button', () => {
        expect(js).toContain("var resetBtn = container.querySelector('.mermaid-zoom-reset')");
        expect(js).toContain('if (resetBtn)');
    });

    it('should reset scale to 1 and translate to 0', () => {
        expect(js).toContain('state.scale = 1');
        expect(js).toContain('state.translateX = 0');
        expect(js).toContain('state.translateY = 0');
    });

    // --- Wheel zoom ---
    it('should handle Ctrl key for wheel zoom', () => {
        expect(js).toContain('e.ctrlKey');
    });

    it('should handle Meta key for wheel zoom', () => {
        expect(js).toContain('e.metaKey');
    });

    it('should use passive: false for wheel listener', () => {
        expect(js).toContain('passive: false');
    });

    it('should implement zoom-toward-cursor (getBoundingClientRect)', () => {
        expect(js).toContain('getBoundingClientRect');
        expect(js).toContain('e.clientX - rect.left');
        expect(js).toContain('e.clientY - rect.top');
    });

    it('should prevent default and stop propagation on wheel', () => {
        expect(js).toContain('e.preventDefault()');
        expect(js).toContain('e.stopPropagation()');
    });

    // --- Mouse drag panning ---
    it('should handle mousedown for drag start', () => {
        expect(js).toContain("'mousedown'");
    });

    it('should only drag on left mouse button', () => {
        expect(js).toContain('e.button !== 0');
    });

    it('should attach mousemove to document (robust dragging)', () => {
        expect(js).toContain("document.addEventListener('mousemove'");
    });

    it('should attach mouseup to document (robust drag end)', () => {
        expect(js).toContain("document.addEventListener('mouseup'");
    });

    it('should add mermaid-dragging class during drag', () => {
        expect(js).toContain("viewport.classList.add('mermaid-dragging')");
    });

    it('should remove mermaid-dragging class on drag end', () => {
        expect(js).toContain("viewport.classList.remove('mermaid-dragging')");
    });

    it('should track drag state (isDragging, dragStartX/Y, lastTX/TY)', () => {
        expect(js).toContain('isDragging');
        expect(js).toContain('dragStartX');
        expect(js).toContain('dragStartY');
        expect(js).toContain('lastTX');
        expect(js).toContain('lastTY');
    });

    // --- Return type ---
    it('should return a non-empty string', () => {
        expect(typeof js).toBe('string');
        expect(js.length).toBeGreaterThan(200);
    });

    it('should not include <script> tags', () => {
        expect(js).not.toContain('<script>');
        expect(js).not.toContain('</script>');
    });
});

// ============================================================================
// Integration — both generators use same shared output
// ============================================================================

describe('mermaid-zoom — integration consistency', () => {
    it('CSS should use mermaid-viewport consistently (not mermaid-preview)', () => {
        const css = getMermaidZoomStyles();
        const js = getMermaidZoomScript();
        const html = getMermaidContainerHtml('graph TD; A-->B');

        // All three use mermaid-viewport
        expect(css).toContain('mermaid-viewport');
        expect(js).toContain('mermaid-viewport');
        expect(html).toContain('mermaid-viewport');

        // None use the old class name
        expect(css).not.toContain('mermaid-preview');
        expect(js).not.toContain('mermaid-preview');
        expect(html).not.toContain('mermaid-preview');
    });

    it('CSS class names in styles should match those queried in JS', () => {
        const css = getMermaidZoomStyles();
        const js = getMermaidZoomScript();

        // Key classes used in JS must exist in CSS
        const classesUsedInJs = [
            'mermaid-container',
            'mermaid-viewport',
            'mermaid-svg-wrapper',
            'mermaid-zoom-in',
            'mermaid-zoom-out',
            'mermaid-zoom-reset',
            'mermaid-zoom-level',
            'mermaid-dragging',
        ];

        for (const cls of classesUsedInJs) {
            expect(js).toContain(cls);
        }

        // CSS-only classes
        const classesInCss = [
            'mermaid-container',
            'mermaid-toolbar',
            'mermaid-toolbar-label',
            'mermaid-zoom-btn',
            'mermaid-zoom-level',
            'mermaid-zoom-reset',
            'mermaid-viewport',
            'mermaid-svg-wrapper',
            'mermaid-dragging',
        ];

        for (const cls of classesInCss) {
            expect(css).toContain(cls);
        }
    });

    it('HTML class names should match those in CSS and JS', () => {
        const css = getMermaidZoomStyles();
        const js = getMermaidZoomScript();
        const html = getMermaidContainerHtml('graph TD; A-->B');

        // HTML element classes that should match CSS/JS selectors
        const htmlClasses = [
            'mermaid-container',
            'mermaid-toolbar',
            'mermaid-toolbar-label',
            'mermaid-zoom-btn',
            'mermaid-zoom-out',
            'mermaid-zoom-in',
            'mermaid-zoom-reset',
            'mermaid-zoom-level',
            'mermaid-viewport',
            'mermaid-svg-wrapper',
        ];

        for (const cls of htmlClasses) {
            expect(html).toContain(cls);
            // Also verify in CSS or JS
            const inCssOrJs = css.includes(cls) || js.includes(cls);
            expect(inCssOrJs).toBe(true);
        }
    });

    it('zoom constants in JS should be self-consistent', () => {
        const js = getMermaidZoomScript();
        // MIN < MAX
        expect(js).toContain('MERMAID_MIN_ZOOM = 0.25');
        expect(js).toContain('MERMAID_MAX_ZOOM = 4');
        // STEP divides evenly for clean zoom levels
        expect(js).toContain('MERMAID_ZOOM_STEP = 0.25');
    });

    it('CSS var references should use deep-wiki shared var names', () => {
        const css = getMermaidZoomStyles();
        // Shared CSS vars from both generators
        expect(css).toContain('var(--content-border)');
        expect(css).toContain('var(--code-bg)');
        expect(css).toContain('var(--content-muted)');
        expect(css).toContain('var(--content-text)');
        expect(css).toContain('var(--copy-btn-bg)');
        expect(css).toContain('var(--copy-btn-hover-bg)');
        expect(css).toContain('var(--sidebar-active-border)');
    });

    it('functions should be callable multiple times with same output', () => {
        const css1 = getMermaidZoomStyles();
        const css2 = getMermaidZoomStyles();
        expect(css1).toBe(css2);

        const js1 = getMermaidZoomScript();
        const js2 = getMermaidZoomScript();
        expect(js1).toBe(js2);

        const html1 = getMermaidContainerHtml('graph TD; A-->B', 'Diagram');
        const html2 = getMermaidContainerHtml('graph TD; A-->B', 'Diagram');
        expect(html1).toBe(html2);
    });
});

// ============================================================================
// Cross-theme — CSS works in all theme contexts
// ============================================================================

describe('mermaid-zoom — cross-theme CSS', () => {
    it('should only use CSS custom properties (no hardcoded colors)', () => {
        const css = getMermaidZoomStyles();
        // Check that color values use var() notation (no hex/rgb/hsl hardcodes)
        // The only direct color-like values should be in transitions/transforms
        const lines = css.split('\n');
        const colorProperties = lines.filter(line =>
            (line.includes('color:') || line.includes('background:') || line.includes('border'))
            && line.includes(':')
            && !line.includes('var(--')
            && !line.includes('transparent')
            && !line.includes('none')
            && !line.includes('solid')
            && !line.includes('0 0')
            && !line.includes('8px')
            && !line.includes('inherit')
            && !line.trim().startsWith('//')
            && !line.trim().startsWith('/*')
        );
        // All color/background/border properties should use CSS vars
        for (const line of colorProperties) {
            // Lines with color/bg/border that don't reference var should be structural (not color values)
            const trimmed = line.trim();
            const hasColorValue = /:\s*(#|rgb|hsl|rgba)/.test(trimmed);
            expect(hasColorValue).toBe(false);
        }
    });
});
