import { getMermaidZoomScript } from '../../../rendering/mermaid-zoom';

/**
 * Markdown rendering script: renderMarkdownContent, processMarkdownContent,
 * findModuleIdBySlugClient, addCopyButton, initMermaid, and mermaid zoom.
 */
export function getMarkdownScript(): string {
    return `
        // ================================================================
        // Markdown Rendering
        // ================================================================

        function renderMarkdownContent(markdown) {
            var html = marked.parse(markdown);
            var container = document.getElementById('content');
            container.innerHTML = '<div class="markdown-body">' + html + '</div>';
            processMarkdownContent();
        }

        function processMarkdownContent() {
            var container = document.getElementById('content');
            var body = container.querySelector('.markdown-body');
            if (!body) return;

            body.querySelectorAll('pre code').forEach(function(block) {
                if (block.classList.contains('language-mermaid')) {
                    var pre = block.parentElement;
                    var mermaidCode = block.textContent;
                    // Create container with zoom controls (shared structure from mermaid-zoom)
                    var mContainer = document.createElement('div');
                    mContainer.className = 'mermaid-container';
                    mContainer.innerHTML =
                        '<div class="mermaid-toolbar">' +
                            '<span class="mermaid-toolbar-label">Diagram</span>' +
                            '<button class="mermaid-zoom-btn mermaid-zoom-out" title="Zoom out">\\u2212</button>' +
                            '<span class="mermaid-zoom-level">100%</span>' +
                            '<button class="mermaid-zoom-btn mermaid-zoom-in" title="Zoom in">+</button>' +
                            '<button class="mermaid-zoom-btn mermaid-zoom-reset" title="Reset view">\\u27F2</button>' +
                        '</div>' +
                        '<div class="mermaid-viewport">' +
                            '<div class="mermaid-svg-wrapper">' +
                                '<pre class="mermaid">' + mermaidCode + '</pre>' +
                            '</div>' +
                        '</div>';
                    pre.parentNode.replaceChild(mContainer, pre);
                } else {
                    hljs.highlightElement(block);
                    addCopyButton(block.parentElement);
                }
            });

            body.querySelectorAll('h1, h2, h3, h4').forEach(function(heading) {
                var id = heading.textContent.toLowerCase()
                    .replace(/[^a-z0-9]+/g, '-')
                    .replace(/^-+|-+$/g, '');
                heading.id = id;
                var anchor = document.createElement('a');
                anchor.className = 'heading-anchor';
                anchor.href = '#' + id;
                anchor.textContent = '#';
                heading.appendChild(anchor);
            });

            initMermaid();

            // Intercept internal .md links and route through SPA navigation
            body.addEventListener('click', function(e) {
                var target = e.target;
                while (target && target !== body) {
                    if (target.tagName === 'A') break;
                    target = target.parentElement;
                }
                if (!target || target.tagName !== 'A') return;
                var href = target.getAttribute('href');
                if (!href || !href.match(/\\.md(#.*)?$/)) return;
                // Don't intercept external links
                if (/^https?:\\/\\//.test(href)) return;

                e.preventDefault();
                var hashPart = '';
                var hashIdx = href.indexOf('#');
                if (hashIdx !== -1) {
                    hashPart = href.substring(hashIdx + 1);
                    href = href.substring(0, hashIdx);
                }

                // Extract slug from the href path
                // Handle patterns like:
                //   ./modules/module-id.md
                //   ./module-id.md
                //   ../../other-area/modules/module-id.md
                //   ./areas/area-id/index.md
                //   ../index.md
                var slug = href.replace(/^(\\.\\.\\/|\\.\\/)*/g, '')
                    .replace(/^areas\\/[^/]+\\/modules\\//, '')
                    .replace(/^areas\\/[^/]+\\//, '')
                    .replace(/^modules\\//, '')
                    .replace(/\\.md$/, '');

                // Check special pages
                var specialPages = {
                    'index': { key: '__index', title: 'Index' },
                    'architecture': { key: '__architecture', title: 'Architecture' },
                    'getting-started': { key: '__getting-started', title: 'Getting Started' }
                };
                if (specialPages[slug]) {
                    loadSpecialPage(specialPages[slug].key, specialPages[slug].title);
                    return;
                }

                // Try to find matching module ID
                var matchedId = findModuleIdBySlugClient(slug);
                if (matchedId) {
                    loadModule(matchedId);
                    if (hashPart) {
                        setTimeout(function() {
                            var el = document.getElementById(hashPart);
                            if (el) el.scrollIntoView({ behavior: 'smooth' });
                        }, 100);
                    }
                }
            });
        }

        // Client-side module ID lookup by slug
        function findModuleIdBySlugClient(slug) {
            var normalized = slug.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
            for (var i = 0; i < moduleGraph.modules.length; i++) {
                var mod = moduleGraph.modules[i];
                var modSlug = mod.id.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
                if (modSlug === normalized) return mod.id;
            }
            return null;
        }

        function addCopyButton(pre) {
            var btn = document.createElement('button');
            btn.className = 'copy-btn';
            btn.textContent = 'Copy';
            btn.onclick = function() {
                var code = pre.querySelector('code');
                var text = code ? code.textContent : pre.textContent;
                navigator.clipboard.writeText(text).then(function() {
                    btn.textContent = 'Copied!';
                    setTimeout(function() { btn.textContent = 'Copy'; }, 2000);
                });
            };
            pre.appendChild(btn);
        }

        function initMermaid() {
            var blocks = document.querySelectorAll('.mermaid');
            if (blocks.length === 0) return Promise.resolve();

            var isDark = currentTheme === 'dark' ||
                (currentTheme === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);

            mermaid.initialize({
                startOnLoad: false,
                theme: isDark ? 'dark' : 'default',
                securityLevel: 'loose',
                flowchart: { useMaxWidth: false, htmlLabels: true, curve: 'basis' },
                fontSize: 14,
            });
            return mermaid.run({ nodes: blocks }).then(function() {
                initMermaidZoom();
            });
        }

        // ================================================================
        // Mermaid Zoom & Pan (shared via mermaid-zoom module)
        // ================================================================
${getMermaidZoomScript()}
`;
}
