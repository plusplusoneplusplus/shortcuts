/**
 * Markdown rendering: renderMarkdownContent, processMarkdownContent,
 * findComponentIdBySlugClient, addCopyButton, initMermaid.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { currentTheme, componentGraph } from './core';
import { initMermaidZoom } from './mermaid-zoom';

export function renderMarkdownContent(markdown: string): void {
    const html = marked.parse(markdown);
    const container = document.getElementById('content');
    if (container) {
        container.innerHTML = '<div class="markdown-body">' + html + '</div>';
    }
    processMarkdownContent();
}

export function processMarkdownContent(): void {
    const container = document.getElementById('content');
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
                        '<pre class="mermaid">' + mermaidCode + '</pre>' +
                    '</div>' +
                '</div>';
            pre.parentNode!.replaceChild(mContainer, pre);
        } else {
            hljs.highlightElement(block as Element);
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

    // Intercept internal .md links and route through SPA navigation
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

        const specialPages: Record<string, { key: string; title: string }> = {
            'index': { key: '__index', title: 'Index' },
            'architecture': { key: '__architecture', title: 'Architecture' },
            'getting-started': { key: '__getting-started', title: 'Getting Started' }
        };
        if (specialPages[slug]) {
            (window as any).loadSpecialPage(specialPages[slug].key, specialPages[slug].title);
            return;
        }

        const matchedId = findComponentIdBySlugClient(slug);
        if (matchedId) {
            (window as any).loadComponent(matchedId);
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
    for (let i = 0; i < componentGraph.components.length; i++) {
        const mod = componentGraph.components[i];
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
    const blocks = document.querySelectorAll('.mermaid');
    if (blocks.length === 0) return Promise.resolve();

    const isDark = currentTheme === 'dark' ||
        (currentTheme === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);

    mermaid.initialize({
        startOnLoad: false,
        theme: isDark ? 'dark' : 'default',
        securityLevel: 'loose',
        flowchart: { useMaxWidth: false, htmlLabels: true, curve: 'basis' },
        fontSize: 14,
    });
    return mermaid.run({ nodes: blocks }).then(function () {
        initMermaidZoom();
    });
}
