/**
 * Markdown rendering: renderMarkdownContent, processMarkdownContent,
 * findComponentIdBySlugClient, addCopyButton, initMermaid.
 *
 * Ported from deep-wiki markdown.ts.
 * Adapted for CoC wiki tab: uses wiki-prefixed element IDs, imports
 * CoC theme module, and routes internal links through CoC hash routing.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { initMermaidZoom } from './wiki-mermaid-zoom';
import { wikiState } from './wiki-content';

declare const marked: { parse(md: string): string };
declare const hljs: { highlightElement(el: Element): void };
declare const mermaid: {
    initialize(config: Record<string, unknown>): void;
    run(opts: { nodes: NodeListOf<Element> }): Promise<void>;
};

/** Get current effective theme (dark or light). */
function isDarkTheme(): boolean {
    const theme = document.documentElement.getAttribute('data-theme');
    if (theme === 'dark') return true;
    if (theme === 'light') return false;
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export function renderMarkdownContent(markdown: string): void {
    if (typeof marked === 'undefined') return;
    const html = marked.parse(markdown);
    const container = document.getElementById('wiki-article-content');
    if (container) {
        container.innerHTML = '<div class="markdown-body">' + html + '</div>';
    }
    processMarkdownContent();
}

export function processMarkdownContent(): void {
    const container = document.getElementById('wiki-article-content');
    if (!container) return;
    const body = container.querySelector('.markdown-body');
    if (!body) return;

    body.querySelectorAll('pre code').forEach(function (block) {
        if (block.classList.contains('language-mermaid')) {
            const pre = block.parentElement;
            if (!pre) return;
            const mermaidCode = block.textContent || '';
            const mContainer = document.createElement('div');
            mContainer.className = 'mermaid-container';
            mContainer.innerHTML =
                '<div class="mermaid-toolbar">' +
                    '<span class="mermaid-toolbar-label">Diagram</span>' +
                    '<button class="mermaid-zoom-btn mermaid-zoom-out" title="Zoom out">\u2212</button>' +
                    '<span class="mermaid-zoom-level">100%</span>' +
                    '<button class="mermaid-zoom-btn mermaid-zoom-in" title="Zoom in">+</button>' +
                    '<button class="mermaid-zoom-btn mermaid-zoom-reset" title="Reset view">\u27F2</button>' +
                '</div>' +
                '<div class="mermaid-viewport">' +
                    '<div class="mermaid-svg-wrapper">' +
                        '<pre class="mermaid">' + escapeHtmlForMermaid(mermaidCode) + '</pre>' +
                    '</div>' +
                '</div>';
            pre.parentNode!.replaceChild(mContainer, pre);
        } else {
            if (typeof hljs !== 'undefined') {
                hljs.highlightElement(block as Element);
            }
            addCopyButton(block.parentElement as HTMLPreElement);
        }
    });

    body.querySelectorAll('h1, h2, h3, h4').forEach(function (heading) {
        const id = (heading.textContent || '').toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '');
        heading.id = id;
        const anchor = document.createElement('a');
        anchor.className = 'heading-anchor';
        anchor.href = '#' + id;
        anchor.textContent = '#';
        heading.appendChild(anchor);
    });

    initMermaid();

    // Intercept internal .md links and route through CoC hash navigation
    body.addEventListener('click', function (e: Event) {
        let target = e.target as HTMLElement | null;
        while (target && target !== body) {
            if (target.tagName === 'A') break;
            target = target.parentElement;
        }
        if (!target || target.tagName !== 'A') return;
        let href = target.getAttribute('href');
        if (!href || !href.match(/\.md(#.*)?$/)) return;
        if (/^https?:\/\//.test(href)) return;

        e.preventDefault();
        let hashPart = '';
        const hashIdx = href.indexOf('#');
        if (hashIdx !== -1) {
            hashPart = href.substring(hashIdx + 1);
            href = href.substring(0, hashIdx);
        }

        const slug = href.replace(/^(\.\.\/|\.\/)+/g, '')
            .replace(/^domains\/[^/]+\/components\//, '')
            .replace(/^domains\/[^/]+\//, '')
            .replace(/^components\//, '')
            .replace(/\.md$/, '');

        const matchedId = findComponentIdBySlugClient(slug);
        if (matchedId && wikiState.wikiId) {
            (window as any).showWikiComponent?.(wikiState.wikiId, matchedId);
            if (hashPart) {
                setTimeout(function () {
                    const el = document.getElementById(hashPart);
                    if (el) el.scrollIntoView({ behavior: 'smooth' });
                }, 100);
            }
        }
    });
}

export function findComponentIdBySlugClient(slug: string): string | null {
    const normalized = slug.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    for (let i = 0; i < wikiState.components.length; i++) {
        const mod = wikiState.components[i];
        const modSlug = mod.id.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
        if (modSlug === normalized) return mod.id;
    }
    return null;
}

export function addCopyButton(pre: HTMLPreElement): void {
    const btn = document.createElement('button');
    btn.className = 'copy-btn';
    btn.textContent = 'Copy';
    btn.onclick = function () {
        const code = pre.querySelector('code');
        const text = code ? code.textContent || '' : pre.textContent || '';
        navigator.clipboard.writeText(text).then(function () {
            btn.textContent = 'Copied!';
            setTimeout(function () { btn.textContent = 'Copy'; }, 2000);
        });
    };
    pre.appendChild(btn);
}

export function initMermaid(): Promise<void> {
    if (typeof mermaid === 'undefined') return Promise.resolve();
    const blocks = document.querySelectorAll('.mermaid');
    if (blocks.length === 0) return Promise.resolve();

    mermaid.initialize({
        startOnLoad: false,
        theme: isDarkTheme() ? 'dark' : 'default',
        securityLevel: 'loose',
        flowchart: { useMaxWidth: false, htmlLabels: true, curve: 'basis' },
        fontSize: 14,
    });
    return mermaid.run({ nodes: blocks }).then(function () {
        initMermaidZoom();
    });
}

function escapeHtmlForMermaid(str: string): string {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

(window as any).renderMarkdownContent = renderMarkdownContent;
(window as any).processMarkdownContent = processMarkdownContent;
