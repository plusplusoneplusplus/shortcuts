/**
 * useMermaid — lazy-loads mermaid.js from CDN and renders diagrams.
 * Ported from task-mermaid.ts for React usage.
 */

import { useEffect, useRef } from 'react';

const MERMAID_CDN = 'https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js';
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 4;
const ZOOM_STEP = 0.25;

declare const mermaid: {
    initialize(config: Record<string, unknown>): void;
    run(opts: { nodes: NodeListOf<Element> | Element[] }): Promise<void>;
};

function isDarkTheme(): boolean {
    const theme = document.documentElement.getAttribute('data-theme');
    if (theme === 'dark') return true;
    if (theme === 'light') return false;
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

let mermaidLoadPromise: Promise<void> | null = null;

function ensureMermaid(): Promise<void> {
    if (typeof mermaid !== 'undefined' && mermaid?.initialize) {
        return Promise.resolve();
    }
    if (mermaidLoadPromise) return mermaidLoadPromise;

    mermaidLoadPromise = new Promise<void>((resolve, reject) => {
        const script = document.createElement('script');
        script.src = MERMAID_CDN;
        script.async = true;
        script.onload = () => {
            mermaid.initialize({
                startOnLoad: false,
                theme: isDarkTheme() ? 'dark' : 'default',
                securityLevel: 'loose',
                flowchart: { useMaxWidth: false, htmlLabels: true, curve: 'basis' },
                fontSize: 14,
            });
            resolve();
        };
        script.onerror = () => {
            mermaidLoadPromise = null;
            reject(new Error('Failed to load mermaid.js from CDN'));
        };
        document.head.appendChild(script);
    });
    return mermaidLoadPromise;
}

function escapeHtmlForMermaid(str: string): string {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function buildToolbarHTML(): string {
    return '<div class="task-mermaid-toolbar">' +
        '<button class="task-mermaid-btn task-mermaid-toggle" title="Toggle source/preview">Source</button>' +
        '<button class="task-mermaid-btn task-mermaid-zoom-out" title="Zoom out">\u2212</button>' +
        '<span class="task-mermaid-zoom-level">100%</span>' +
        '<button class="task-mermaid-btn task-mermaid-zoom-in" title="Zoom in">+</button>' +
        '<button class="task-mermaid-btn task-mermaid-zoom-reset" title="Reset view">\u27F2</button>' +
        '<button class="task-mermaid-btn task-mermaid-collapse" title="Collapse">\u25BC</button>' +
        '</div>';
}

interface ZoomState {
    scale: number;
    translateX: number;
    translateY: number;
    isDragging: boolean;
    dragStartX: number;
    dragStartY: number;
    lastTX: number;
    lastTY: number;
}

function applyTransform(svgWrapper: HTMLElement, state: ZoomState, container: Element): void {
    svgWrapper.style.transform =
        'translate(' + state.translateX + 'px, ' + state.translateY + 'px) scale(' + state.scale + ')';
    const display = container.querySelector('.task-mermaid-zoom-level');
    if (display) display.textContent = Math.round(state.scale * 100) + '%';
}

function transformContainer(container: HTMLElement): void {
    if (container.getAttribute('data-mermaid-transformed')) return;

    const sourceEl = container.querySelector('.mermaid-source code');
    const source = sourceEl?.textContent || '';
    if (!source.trim()) return;

    const contentDiv = container.querySelector('.mermaid-content') as HTMLElement;
    if (!contentDiv) return;

    container.setAttribute('data-mermaid-transformed', '1');

    const header = container.querySelector('.mermaid-header');
    if (header) {
        header.insertAdjacentHTML('afterend', buildToolbarHTML());
    }

    contentDiv.innerHTML =
        '<div class="task-mermaid-viewport">' +
            '<div class="task-mermaid-svg-wrapper">' +
                '<pre class="mermaid">' + escapeHtmlForMermaid(source) + '</pre>' +
            '</div>' +
        '</div>' +
        '<div class="task-mermaid-source-view" style="display:none;">' +
            '<pre><code>' + escapeHtmlForMermaid(source) + '</code></pre>' +
        '</div>';
}

function setupZoomPan(container: HTMLElement): void {
    const viewport = container.querySelector('.task-mermaid-viewport') as HTMLElement | null;
    const svgWrapper = container.querySelector('.task-mermaid-svg-wrapper') as HTMLElement | null;
    if (!viewport || !svgWrapper) return;

    // Prevent browser default pinch-zoom on mermaid content
    const mermaidContent = container.querySelector('.mermaid-content') as HTMLElement | null;
    if (mermaidContent) {
        mermaidContent.style.touchAction = 'none';
    }

    const state: ZoomState = {
        scale: 1, translateX: 0, translateY: 0,
        isDragging: false, dragStartX: 0, dragStartY: 0, lastTX: 0, lastTY: 0,
    };

    container.querySelector('.task-mermaid-zoom-in')?.addEventListener('click', (e) => {
        e.stopPropagation();
        state.scale = Math.min(MAX_ZOOM, state.scale + ZOOM_STEP);
        applyTransform(svgWrapper, state, container);
    });

    container.querySelector('.task-mermaid-zoom-out')?.addEventListener('click', (e) => {
        e.stopPropagation();
        state.scale = Math.max(MIN_ZOOM, state.scale - ZOOM_STEP);
        applyTransform(svgWrapper, state, container);
    });

    container.querySelector('.task-mermaid-zoom-reset')?.addEventListener('click', (e) => {
        e.stopPropagation();
        state.scale = 1;
        state.translateX = 0;
        state.translateY = 0;
        applyTransform(svgWrapper, state, container);
    });

    viewport.addEventListener('wheel', (e: WheelEvent) => {
        if (!e.ctrlKey && !e.metaKey) return;
        e.preventDefault();
        e.stopPropagation();
        const delta = e.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP;
        const newScale = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, state.scale + delta));
        if (newScale !== state.scale) {
            const rect = viewport.getBoundingClientRect();
            const mx = e.clientX - rect.left;
            const my = e.clientY - rect.top;
            const px = (mx - state.translateX) / state.scale;
            const py = (my - state.translateY) / state.scale;
            state.scale = newScale;
            state.translateX = mx - px * state.scale;
            state.translateY = my - py * state.scale;
            applyTransform(svgWrapper, state, container);
        }
    }, { passive: false });

    viewport.addEventListener('mousedown', (e: MouseEvent) => {
        if (e.button !== 0) return;
        state.isDragging = true;
        state.dragStartX = e.clientX;
        state.dragStartY = e.clientY;
        state.lastTX = state.translateX;
        state.lastTY = state.translateY;
        viewport.classList.add('task-mermaid-dragging');
        e.preventDefault();
    });

    document.addEventListener('mousemove', (e: MouseEvent) => {
        if (!state.isDragging) return;
        state.translateX = state.lastTX + (e.clientX - state.dragStartX);
        state.translateY = state.lastTY + (e.clientY - state.dragStartY);
        applyTransform(svgWrapper, state, container);
    });

    document.addEventListener('mouseup', () => {
        if (!state.isDragging) return;
        state.isDragging = false;
        viewport.classList.remove('task-mermaid-dragging');
    });

    // Touch: single-finger pan, two-finger pinch-to-zoom
    let touchStartDistance = 0;
    let touchStartScale = 1;
    let singleTouchStart: { x: number; y: number } | null = null;

    function getTouchDistance(e: TouchEvent): number {
        const t = e.touches;
        return Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    }

    viewport.addEventListener('touchstart', (e: TouchEvent) => {
        if (e.touches.length === 2) {
            e.preventDefault();
            touchStartDistance = getTouchDistance(e);
            touchStartScale = state.scale;
            singleTouchStart = null;
        } else if (e.touches.length === 1) {
            singleTouchStart = { x: e.touches[0].clientX, y: e.touches[0].clientY };
            state.lastTX = state.translateX;
            state.lastTY = state.translateY;
        }
    }, { passive: false });

    viewport.addEventListener('touchmove', (e: TouchEvent) => {
        if (e.touches.length === 2) {
            e.preventDefault();
            const dist = getTouchDistance(e);
            const newScale = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, touchStartScale * (dist / touchStartDistance)));
            if (newScale !== state.scale) {
                state.scale = newScale;
                applyTransform(svgWrapper, state, container);
            }
        } else if (e.touches.length === 1 && singleTouchStart) {
            const dx = e.touches[0].clientX - singleTouchStart.x;
            const dy = e.touches[0].clientY - singleTouchStart.y;
            state.translateX = state.lastTX + dx;
            state.translateY = state.lastTY + dy;
            applyTransform(svgWrapper, state, container);
        }
    }, { passive: false });

    viewport.addEventListener('touchend', () => {
        singleTouchStart = null;
    });
}

function setupSourceToggle(container: HTMLElement): void {
    const toggleBtn = container.querySelector('.task-mermaid-toggle') as HTMLElement | null;
    const viewport = container.querySelector('.task-mermaid-viewport') as HTMLElement | null;
    const sourceView = container.querySelector('.task-mermaid-source-view') as HTMLElement | null;
    if (!toggleBtn || !viewport || !sourceView) return;

    toggleBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const showingSource = sourceView.style.display !== 'none';
        if (showingSource) {
            sourceView.style.display = 'none';
            viewport.style.display = '';
            toggleBtn.textContent = 'Source';
        } else {
            viewport.style.display = 'none';
            sourceView.style.display = '';
            toggleBtn.textContent = 'Preview';
        }
    });
}

function setupCollapse(container: HTMLElement): void {
    const collapseBtn = container.querySelector('.task-mermaid-collapse') as HTMLElement | null;
    const contentDiv = container.querySelector('.mermaid-content') as HTMLElement | null;
    if (!collapseBtn || !contentDiv) return;

    collapseBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const collapsed = contentDiv.style.display === 'none';
        if (collapsed) {
            contentDiv.style.display = '';
            collapseBtn.textContent = '\u25BC';
            collapseBtn.title = 'Collapse';
        } else {
            contentDiv.style.display = 'none';
            collapseBtn.textContent = '\u25B6';
            collapseBtn.title = 'Expand';
        }
    });
}

async function initMermaid(root: HTMLElement): Promise<void> {
    const containers = root.querySelectorAll('.mermaid-container:not([data-mermaid-ready])');
    if (containers.length === 0) return;

    containers.forEach((c) => transformContainer(c as HTMLElement));

    try {
        await ensureMermaid();
    } catch {
        containers.forEach((c) => {
            const preview = c.querySelector('.task-mermaid-viewport');
            if (preview) {
                preview.innerHTML = '<div class="task-mermaid-error">Failed to load diagram renderer</div>';
            }
        });
        return;
    }

    const mermaidPres = root.querySelectorAll('.mermaid-container:not([data-mermaid-ready]) .mermaid');
    if (mermaidPres.length > 0) {
        await mermaid.run({ nodes: mermaidPres });
    }

    containers.forEach((c) => {
        const el = c as HTMLElement;
        el.setAttribute('data-mermaid-ready', '1');
        setupZoomPan(el);
        setupSourceToggle(el);
        setupCollapse(el);
    });
}

function reinitMermaidTheme(): void {
    if (typeof mermaid === 'undefined') return;
    mermaid.initialize({
        startOnLoad: false,
        theme: isDarkTheme() ? 'dark' : 'default',
        securityLevel: 'loose',
        flowchart: { useMaxWidth: false, htmlLabels: true, curve: 'basis' },
        fontSize: 14,
    });
}

// ── Hook ───────────────────────────────────────────────────────────────

export function useMermaid(rootRef: React.RefObject<HTMLElement | null>, contentKey?: unknown): void {
    const initDone = useRef(false);

    useEffect(() => {
        const el = rootRef.current;
        if (!el) return;
        initDone.current = false;

        initMermaid(el).then(() => {
            initDone.current = true;
        }).catch(() => { /* error already shown in container */ });
    }, [rootRef.current, contentKey]);

    // Theme change observer
    useEffect(() => {
        const observer = new MutationObserver((mutations) => {
            for (const m of mutations) {
                if (m.attributeName === 'data-theme') {
                    reinitMermaidTheme();
                    const el = rootRef.current;
                    if (el && initDone.current) {
                        el.querySelectorAll('.mermaid-container[data-mermaid-ready]').forEach(c => {
                            c.removeAttribute('data-mermaid-ready');
                            c.removeAttribute('data-mermaid-transformed');
                        });
                        initMermaid(el).catch(() => {});
                    }
                    break;
                }
            }
        });
        observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
        return () => observer.disconnect();
    }, [rootRef]);
}
