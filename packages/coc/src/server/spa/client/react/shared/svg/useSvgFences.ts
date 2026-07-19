/**
 * useSvgFences — hydrates `.md-svg-fence` placeholder elements emitted by the
 * chat markdown renderer when `svgFenceEnabled` is active.
 *
 * Each placeholder contains a hidden `.md-svg-source code` element with the
 * escaped SVG source.  This hook sanitizes that source, then mounts the result
 * inside a ShadowRoot so that SVG-scoped `<style>` rules cannot escape into the
 * surrounding dashboard layout.  Invalid SVG shows an inline error followed by
 * the raw source.
 */

import { useEffect } from 'react';
import { sanitizeSvg } from './sanitizeSvg';

function hydrateSvgFence(fence: HTMLElement): void {
    if (fence.getAttribute('data-svg-ready')) return;
    fence.setAttribute('data-svg-ready', '1');

    const sourceEl = fence.querySelector<HTMLElement>('.md-svg-source code');
    const source = sourceEl?.textContent ?? '';

    const host = document.createElement('div');
    host.className = 'md-svg-fence-host';
    fence.appendChild(host);

    const shadow = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = ':host { display: block; } svg { max-width: 100%; height: auto; display: block; }';

    const sanitized = sanitizeSvg(source);
    if (sanitized.ok) {
        const content = document.createElement('div');
        content.innerHTML = sanitized.svg;
        shadow.replaceChildren(style, content);
    } else {
        const err = document.createElement('div');
        err.className = 'md-svg-error';
        err.style.color = 'red';
        err.textContent = sanitized.error;
        const pre = document.createElement('pre');
        pre.className = 'md-svg-source-fallback';
        pre.style.cssText = 'white-space: pre-wrap; font-size: 11px; margin-top: 4px;';
        pre.textContent = source;
        shadow.replaceChildren(style, err, pre);
    }
}

function initSvgFences(root: HTMLElement): void {
    root.querySelectorAll<HTMLElement>('.md-svg-fence:not([data-svg-ready])').forEach(hydrateSvgFence);
}

export function useSvgFences(rootRef: React.RefObject<HTMLElement | null>, contentKey?: unknown): void {
    useEffect(() => {
        const el = rootRef.current;
        if (!el) return;
        initSvgFences(el);
    }, [rootRef.current, contentKey]); // eslint-disable-line react-hooks/exhaustive-deps
}
