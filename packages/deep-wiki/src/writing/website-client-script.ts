/**
 * Website Client Script
 *
 * Client-side JavaScript generation for the standalone HTML website.
 * Extracted from website-generator.ts for maintainability.
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import type { WebsiteTheme } from '../types';
import { getMermaidZoomScript } from '../rendering/mermaid-zoom';

// ============================================================================
// Public API
// ============================================================================

/**
 * Generate the client-side JavaScript for the website template.
 * @param enableSearch - Whether to include search functionality
 * @param defaultTheme - The default theme setting
 * @returns JavaScript string to embed in <script> tag
 */
export function getScript(enableSearch: boolean, defaultTheme: WebsiteTheme): string {
    return `        // ====================================================================
        // Deep Wiki Viewer
        // ====================================================================

        let componentGraph = null;
        let currentComponentId = null;
        let currentTheme = '${defaultTheme}';
        let mermaidInitialized = false;

        // Initialize
        try {
            componentGraph = COMPONENT_GRAPH;
            initTheme();
            initializeSidebar();
            showHome(true);
            // Use replaceState for initial load to avoid extra history entry
            history.replaceState({ type: 'home' }, '', location.pathname);
        } catch(err) {
            document.getElementById('content').innerHTML =
                '<p style="color: red;">Error loading component graph: ' + err.message + '</p>';
        }

        // ================================================================
        // Browser History (Back/Forward)
        // ================================================================

        window.addEventListener('popstate', function(e) {
            var state = e.state;
            if (!state) {
                showHome(true);
                return;
            }
            if (state.type === 'home') {
                showHome(true);
            } else if (state.type === 'component' && state.id) {
                loadComponent(state.id, true);
            } else if (state.type === 'special' && state.key && state.title) {
                loadSpecialPage(state.key, state.title, true);
            } else if (state.type === 'topic' && state.topicId) {
                loadTopicPage(state.topicId, state.articleSlug, state.title, state.layout, true);
            } else {
                showHome(true);
            }
        });

        // ================================================================
        // Theme
        // ================================================================

        function initTheme() {
            const saved = localStorage.getItem('deep-wiki-theme');
            if (saved) {
                currentTheme = saved;
                document.documentElement.setAttribute('data-theme', currentTheme);
            }
            updateThemeStyles();
        }

        function toggleTheme() {
            if (currentTheme === 'auto') {
                currentTheme = 'dark';
            } else if (currentTheme === 'dark') {
                currentTheme = 'light';
            } else {
                currentTheme = 'auto';
            }
            document.documentElement.setAttribute('data-theme', currentTheme);
            localStorage.setItem('deep-wiki-theme', currentTheme);
            updateThemeStyles();
            // Re-render current content to apply new highlight theme
            if (currentComponentId) {
                loadComponent(currentComponentId);
            }
        }

        function updateThemeStyles() {
            const isDark = currentTheme === 'dark' ||
                (currentTheme === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
            const lightSheet = document.getElementById('hljs-light');
            const darkSheet = document.getElementById('hljs-dark');
            if (lightSheet) lightSheet.disabled = isDark;
            if (darkSheet) darkSheet.disabled = !isDark;

            const btn = document.getElementById('theme-toggle');
            if (btn) btn.textContent = isDark ? '\\u2600' : '\\u263E';
        }

        // Listen for system theme changes
        window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', updateThemeStyles);

        document.getElementById('theme-toggle').addEventListener('click', toggleTheme);
        document.getElementById('sidebar-toggle').addEventListener('click', function() {
            document.getElementById('sidebar').classList.toggle('hidden');
        });

        // ================================================================
        // Sidebar
        // ================================================================

        function initializeSidebar() {
            document.getElementById('project-name').textContent = componentGraph.project.name;
            document.getElementById('project-description').textContent = componentGraph.project.description;

            var navContainer = document.getElementById('nav-container');
            var hasDomains = componentGraph.domains && componentGraph.domains.length > 0;

            // Home link
            var homeSection = document.createElement('div');
            homeSection.className = 'nav-section';
            homeSection.innerHTML =
                '<div class="nav-item active" data-id="__home" onclick="showHome()">' +
                '<span class="nav-item-name">Home</span></div>';

            // Overview pages
            if (typeof MARKDOWN_DATA !== 'undefined') {
                if (MARKDOWN_DATA['__index']) {
                    homeSection.innerHTML +=
                        '<div class="nav-item" data-id="__index" onclick="loadSpecialPage(\\'__index\\', \\'Index\\')">' +
                        '<span class="nav-item-name">Index</span></div>';
                }
                if (MARKDOWN_DATA['__architecture']) {
                    homeSection.innerHTML +=
                        '<div class="nav-item" data-id="__architecture" onclick="loadSpecialPage(\\'__architecture\\', \\'Architecture\\')">' +
                        '<span class="nav-item-name">Architecture</span></div>';
                }
                if (MARKDOWN_DATA['__getting-started']) {
                    homeSection.innerHTML +=
                        '<div class="nav-item" data-id="__getting-started" onclick="loadSpecialPage(\\'__getting-started\\', \\'Getting Started\\')">' +
                        '<span class="nav-item-name">Getting Started</span></div>';
                }
            }
            navContainer.appendChild(homeSection);

            if (hasDomains) {
                // DeepWiki-style: domains as top-level, components indented underneath
                buildDomainSidebar(navContainer);
            } else {
                // Fallback: category-based grouping
                buildCategorySidebar(navContainer);
            }

            // Topics section (if any)
            if (componentGraph.topics && componentGraph.topics.length > 0) {
                buildTopicsSidebar(navContainer);
            }
${enableSearch ? `
            // Search
            document.getElementById('search').addEventListener('input', function(e) {
                var query = e.target.value.toLowerCase();
                document.querySelectorAll('.nav-domain-component[data-id], .nav-item[data-id], .nav-topic-item[data-id], .nav-topic-article[data-id]').forEach(function(item) {
                    var id = item.getAttribute('data-id');
                    if (id === '__home' || id === '__index' || id === '__architecture' || id === '__getting-started') {
                        return;
                    }
                    var text = item.textContent.toLowerCase();
                    item.style.display = text.includes(query) ? '' : 'none';
                });
                // Hide area headers when no children match
                document.querySelectorAll('.nav-domain-group').forEach(function(group) {
                    var visibleChildren = group.querySelectorAll('.nav-domain-component:not([style*="display: none"])');
                    var domainItem = group.querySelector('.nav-domain-item');
                    if (domainItem) {
                        domainItem.style.display = visibleChildren.length === 0 ? 'none' : '';
                    }
                    var childrenEl = group.querySelector('.nav-domain-children');
                    if (childrenEl) {
                        childrenEl.style.display = visibleChildren.length === 0 ? 'none' : '';
                    }
                });
                // Hide topic groups when no children match
                document.querySelectorAll('.nav-topic-group').forEach(function(group) {
                    var visibleChildren = group.querySelectorAll('.nav-topic-item:not([style*="display: none"]), .nav-topic-article:not([style*="display: none"])');
                    var headerEl = group.querySelector('.nav-topic-header');
                    if (headerEl) {
                        headerEl.style.display = visibleChildren.length === 0 ? 'none' : '';
                    }
                    var childrenEl = group.querySelector('.nav-topic-children');
                    if (childrenEl) {
                        childrenEl.style.display = visibleChildren.length === 0 ? 'none' : '';
                    }
                });
                // Show/hide category section headers
                document.querySelectorAll('.nav-section').forEach(function(section) {
                    var visibleItems = section.querySelectorAll('.nav-item[data-id]:not([style*="display: none"])');
                    var header = section.querySelector('h3');
                    if (header) {
                        header.style.display = visibleItems.length === 0 ? 'none' : '';
                    }
                });
            });` : ''}
        }

        // Build domain-based sidebar (DeepWiki-style hierarchy)
        function buildDomainSidebar(navContainer) {
            var domainComponents = {};
            componentGraph.domains.forEach(function(area) {
                domainComponents[area.id] = [];
            });

            componentGraph.components.forEach(function(mod) {
                var domainId = mod.domain;
                if (domainId && domainComponents[domainId]) {
                    domainComponents[domainId].push(mod);
                } else {
                    var found = false;
                    componentGraph.domains.forEach(function(area) {
                        if (area.components && area.components.indexOf(mod.id) !== -1) {
                            domainComponents[area.id].push(mod);
                            found = true;
                        }
                    });
                    if (!found) {
                        if (!domainComponents['__other']) domainComponents['__other'] = [];
                        domainComponents['__other'].push(mod);
                    }
                }
            });

            componentGraph.domains.forEach(function(area) {
                var components = domainComponents[area.id] || [];
                if (components.length === 0) return;

                var group = document.createElement('div');
                group.className = 'nav-area-group';

                var domainItem = document.createElement('div');
                domainItem.className = 'nav-area-item';
                domainItem.setAttribute('data-domain-id', area.id);
                domainItem.innerHTML = escapeHtml(area.name);
                group.appendChild(domainItem);

                var childrenEl = document.createElement('div');
                childrenEl.className = 'nav-area-children';

                components.forEach(function(mod) {
                    var item = document.createElement('div');
                    item.className = 'nav-area-component';
                    item.setAttribute('data-id', mod.id);
                    item.innerHTML = escapeHtml(mod.name);
                    item.onclick = function() { loadComponent(mod.id); };
                    childrenEl.appendChild(item);
                });

                group.appendChild(childrenEl);
                navContainer.appendChild(group);
            });

            var otherComponents = domainComponents['__other'] || [];
            if (otherComponents.length > 0) {
                var group = document.createElement('div');
                group.className = 'nav-area-group';
                var domainItem = document.createElement('div');
                domainItem.className = 'nav-area-item';
                domainItem.innerHTML = 'Other';
                group.appendChild(domainItem);

                var childrenEl = document.createElement('div');
                childrenEl.className = 'nav-area-children';
                otherComponents.forEach(function(mod) {
                    var item = document.createElement('div');
                    item.className = 'nav-area-component';
                    item.setAttribute('data-id', mod.id);
                    item.innerHTML = escapeHtml(mod.name);
                    item.onclick = function() { loadComponent(mod.id); };
                    childrenEl.appendChild(item);
                });
                group.appendChild(childrenEl);
                navContainer.appendChild(group);
            }
        }

        // Build category-based sidebar (fallback, uses same visual style as domain-based)
        function buildCategorySidebar(navContainer) {
            var categories = {};
            componentGraph.components.forEach(function(mod) {
                var cat = mod.category || 'other';
                if (!categories[cat]) categories[cat] = [];
                categories[cat].push(mod);
            });

            Object.keys(categories).sort().forEach(function(category) {
                var group = document.createElement('div');
                group.className = 'nav-area-group';

                var catItem = document.createElement('div');
                catItem.className = 'nav-area-item';
                catItem.innerHTML = escapeHtml(category);
                group.appendChild(catItem);

                var childrenEl = document.createElement('div');
                childrenEl.className = 'nav-area-children';

                categories[category].forEach(function(mod) {
                    var item = document.createElement('div');
                    item.className = 'nav-area-component';
                    item.setAttribute('data-id', mod.id);
                    item.innerHTML = escapeHtml(mod.name);
                    item.onclick = function() { loadComponent(mod.id); };
                    childrenEl.appendChild(item);
                });

                group.appendChild(childrenEl);
                navContainer.appendChild(group);
            });
        }

        // Build topics sidebar section
        function buildTopicsSidebar(navContainer) {
            var topicSection = document.createElement('div');
            topicSection.className = 'nav-topic-group';

            var header = document.createElement('div');
            header.className = 'nav-topic-header';
            header.textContent = '\\uD83D\\uDCCB Topics';
            topicSection.appendChild(header);

            componentGraph.topics.forEach(function(topic) {
                if (topic.layout === 'single') {
                    // Single-article topic: flat link
                    var item = document.createElement('div');
                    item.className = 'nav-topic-item';
                    item.setAttribute('data-id', '__topic_' + topic.id);
                    item.innerHTML = escapeHtml(topic.title);
                    item.onclick = function() {
                        loadTopicPage(topic.id, null, topic.title, topic.layout);
                    };
                    topicSection.appendChild(item);
                } else {
                    // Area topic: expandable group
                    var domainItem = document.createElement('div');
                    domainItem.className = 'nav-topic-item';
                    domainItem.setAttribute('data-id', '__topic_' + topic.id + '_index');
                    domainItem.innerHTML = escapeHtml(topic.title);
                    domainItem.onclick = function() {
                        loadTopicPage(topic.id, null, topic.title, topic.layout);
                    };
                    topicSection.appendChild(domainItem);

                    if (topic.articles && topic.articles.length > 0) {
                        var childrenEl = document.createElement('div');
                        childrenEl.className = 'nav-topic-children';
                        topic.articles.forEach(function(article) {
                            var artItem = document.createElement('div');
                            artItem.className = 'nav-topic-article';
                            artItem.setAttribute('data-id', '__topic_' + topic.id + '_' + article.slug);
                            artItem.innerHTML = escapeHtml(article.title);
                            artItem.onclick = function() {
                                loadTopicPage(topic.id, article.slug, article.title, topic.layout);
                            };
                            childrenEl.appendChild(artItem);
                        });
                        topicSection.appendChild(childrenEl);
                    }
                }
            });

            navContainer.appendChild(topicSection);
        }

        function setActive(id) {
            document.querySelectorAll('.nav-item, .nav-domain-component, .nav-domain-item, .nav-topic-item, .nav-topic-article').forEach(function(el) {
                el.classList.remove('active');
            });
            var target = document.querySelector('.nav-item[data-id="' + id + '"]') ||
                         document.querySelector('.nav-domain-component[data-id="' + id + '"]') ||
                         document.querySelector('.nav-topic-item[data-id="' + id + '"]') ||
                         document.querySelector('.nav-topic-article[data-id="' + id + '"]');
            if (target) target.classList.add('active');
        }

        // ================================================================
        // Content
        // ================================================================

        function showHome(skipHistory) {
            currentComponentId = null;
            setActive('__home');
            document.getElementById('breadcrumb').textContent = 'Home';
            document.getElementById('content-title').textContent = 'Project Overview';
            if (!skipHistory) {
                history.pushState({ type: 'home' }, '', location.pathname);
            }

            var stats = {
                components: componentGraph.components.length,
                categories: (componentGraph.categories || []).length,
                language: componentGraph.project.language,
                buildSystem: componentGraph.project.buildSystem,
            };

            var html = '<div class="home-view">' +
                '<p style="font-size: 15px; color: var(--content-muted); margin-bottom: 24px;">' +
                escapeHtml(componentGraph.project.description) + '</p>' +
                '<div class="project-stats">' +
                '<div class="stat-card"><h3>Components</h3><div class="value">' + stats.components + '</div></div>' +
                '<div class="stat-card"><h3>Categories</h3><div class="value">' + stats.categories + '</div></div>' +
                '<div class="stat-card"><h3>Language</h3><div class="value small">' + escapeHtml(stats.language) + '</div></div>' +
                '<div class="stat-card"><h3>Build System</h3><div class="value small">' + escapeHtml(stats.buildSystem) + '</div></div>' +
                '</div>';

            if (componentGraph.project.entryPoints && componentGraph.project.entryPoints.length > 0) {
                html += '<h3 style="margin-top: 24px; margin-bottom: 12px;">Entry Points</h3><ul>';
                componentGraph.project.entryPoints.forEach(function(ep) {
                    html += '<li><code>' + escapeHtml(ep) + '</code></li>';
                });
                html += '</ul>';
            }

            var hasDomains = componentGraph.domains && componentGraph.domains.length > 0;
            if (hasDomains) {
                componentGraph.domains.forEach(function(area) {
                    var domainComponents = componentGraph.components.filter(function(mod) {
                        if (mod.domain === area.id) return true;
                        return area.components && area.components.indexOf(mod.id) !== -1;
                    });
                    if (domainComponents.length === 0) return;

                    html += '<h3 style="margin-top: 24px; margin-bottom: 12px;">' + escapeHtml(area.name) + '</h3>';
                    if (area.description) {
                        html += '<p style="color: var(--content-muted); margin-bottom: 12px; font-size: 14px;">' +
                            escapeHtml(area.description) + '</p>';
                    }
                    html += '<div class="component-grid">';
                    domainComponents.forEach(function(mod) {
                        html += '<div class="component-card" onclick="loadComponent(\\'' +
                            mod.id.replace(/'/g, "\\\\'") + '\\')">' +
                            '<h4>' + escapeHtml(mod.name) +
                            ' <span class="complexity-badge complexity-' + mod.complexity + '">' +
                            mod.complexity + '</span></h4>' +
                            '<p>' + escapeHtml(mod.purpose) + '</p></div>';
                    });
                    html += '</div>';
                });

                var assignedIds = new Set();
                componentGraph.domains.forEach(function(area) {
                    componentGraph.components.forEach(function(mod) {
                        if (mod.domain === area.id || (area.components && area.components.indexOf(mod.id) !== -1)) {
                            assignedIds.add(mod.id);
                        }
                    });
                });
                var unassigned = componentGraph.components.filter(function(mod) { return !assignedIds.has(mod.id); });
                if (unassigned.length > 0) {
                    html += '<h3 style="margin-top: 24px; margin-bottom: 12px;">Other</h3><div class="component-grid">';
                    unassigned.forEach(function(mod) {
                        html += '<div class="component-card" onclick="loadComponent(\\'' +
                            mod.id.replace(/'/g, "\\\\'") + '\\')">' +
                            '<h4>' + escapeHtml(mod.name) +
                            ' <span class="complexity-badge complexity-' + mod.complexity + '">' +
                            mod.complexity + '</span></h4>' +
                            '<p>' + escapeHtml(mod.purpose) + '</p></div>';
                    });
                    html += '</div>';
                }
            } else {
                html += '<h3 style="margin-top: 24px; margin-bottom: 12px;">All Components</h3>' +
                    '<div class="component-grid">';
                componentGraph.components.forEach(function(mod) {
                    html += '<div class="component-card" onclick="loadComponent(\\'' +
                        mod.id.replace(/'/g, "\\\\'") + '\\')">' +
                        '<h4>' + escapeHtml(mod.name) +
                        ' <span class="complexity-badge complexity-' + mod.complexity + '">' +
                        mod.complexity + '</span></h4>' +
                        '<p>' + escapeHtml(mod.purpose) + '</p></div>';
                });
                html += '</div>';
            }

            html += '</div>';

            document.getElementById('content').innerHTML = html;
        }

        function loadComponent(componentId, skipHistory) {
            var mod = componentGraph.components.find(function(m) { return m.id === componentId; });
            if (!mod) return;

            currentComponentId = componentId;
            setActive(componentId);

            document.getElementById('breadcrumb').textContent = mod.category + ' / ' + mod.name;
            document.getElementById('content-title').textContent = mod.name;
            if (!skipHistory) {
                history.pushState({ type: 'component', id: componentId }, '', location.pathname + '#component-' + encodeURIComponent(componentId));
            }

            var markdown = (typeof MARKDOWN_DATA !== 'undefined') ? MARKDOWN_DATA[componentId] : null;
            if (markdown) {
                renderMarkdownContent(markdown);
            } else {
                document.getElementById('content').innerHTML =
                    '<div class="markdown-body">' +
                    '<h2>' + escapeHtml(mod.name) + '</h2>' +
                    '<p><strong>Purpose:</strong> ' + escapeHtml(mod.purpose) + '</p>' +
                    '<p><strong>Path:</strong> <code>' + escapeHtml(mod.path) + '</code></p>' +
                    '<p><strong>Complexity:</strong> ' + mod.complexity + '</p>' +
                    '<h3>Key Files</h3><ul>' +
                    mod.keyFiles.map(function(f) { return '<li><code>' + escapeHtml(f) + '</code></li>'; }).join('') +
                    '</ul>' +
                    '<h3>Dependencies</h3><ul>' +
                    mod.dependencies.map(function(d) { return '<li>' + escapeHtml(d) + '</li>'; }).join('') +
                    '</ul></div>';
            }
            // Scroll content to top
            document.querySelector('.content-body').scrollTop = 0;
        }

        function loadSpecialPage(key, title, skipHistory) {
            currentComponentId = null;
            setActive(key);
            document.getElementById('breadcrumb').textContent = title;
            document.getElementById('content-title').textContent = title;
            if (!skipHistory) {
                history.pushState({ type: 'special', key: key, title: title }, '', location.pathname + '#' + encodeURIComponent(key));
            }

            var markdown = MARKDOWN_DATA[key];
            if (markdown) {
                renderMarkdownContent(markdown);
            } else {
                document.getElementById('content').innerHTML = '<p>Content not available.</p>';
            }
            document.querySelector('.content-body').scrollTop = 0;
        }

        function loadTopicPage(topicId, articleSlug, title, layout, skipHistory) {
            currentComponentId = null;
            var dataKey;
            var navId;
            var breadcrumb;

            // Find topic metadata
            var topicMeta = null;
            if (componentGraph.topics) {
                for (var i = 0; i < componentGraph.topics.length; i++) {
                    if (componentGraph.topics[i].id === topicId) {
                        topicMeta = componentGraph.topics[i];
                        break;
                    }
                }
            }
            var topicTitle = topicMeta ? topicMeta.title : topicId;

            if (layout === 'single') {
                dataKey = '__topic_' + topicId;
                navId = '__topic_' + topicId;
                breadcrumb = 'Home > Topics > ' + topicTitle;
            } else if (articleSlug) {
                dataKey = '__topic_' + topicId + '_' + articleSlug;
                navId = '__topic_' + topicId + '_' + articleSlug;
                breadcrumb = 'Home > Topics > ' + topicTitle + ' > ' + title;
            } else {
                dataKey = '__topic_' + topicId + '_index';
                navId = '__topic_' + topicId + '_index';
                breadcrumb = 'Home > Topics > ' + topicTitle;
            }

            setActive(navId);
            document.getElementById('breadcrumb').textContent = breadcrumb;
            document.getElementById('content-title').textContent = title;

            if (!skipHistory) {
                history.pushState(
                    { type: 'topic', topicId: topicId, articleSlug: articleSlug, title: title, layout: layout },
                    '',
                    location.pathname + '#topic-' + encodeURIComponent(topicId) + (articleSlug ? '-' + encodeURIComponent(articleSlug) : '')
                );
            }

            var markdown = (typeof MARKDOWN_DATA !== 'undefined') ? MARKDOWN_DATA[dataKey] : null;
            if (markdown) {
                // Use wider layout for topic index pages (diagrams)
                var isIndex = !articleSlug && layout !== 'single';
                if (isIndex) {
                    document.querySelector('.content-body').classList.add('topic-wide');
                } else {
                    document.querySelector('.content-body').classList.remove('topic-wide');
                }
                renderMarkdownContent(markdown);
            } else {
                document.querySelector('.content-body').classList.remove('topic-wide');
                document.getElementById('content').innerHTML = '<p>Content not available.</p>';
            }
            document.querySelector('.content-body').scrollTop = 0;
        }

        // ================================================================
        // Markdown Rendering
        // ================================================================

        function renderMarkdownContent(markdown) {
            var html = marked.parse(markdown);
            var container = document.getElementById('content');
            container.innerHTML = '<div class="markdown-body">' + html + '</div>';

            var body = container.querySelector('.markdown-body');

            // Syntax highlighting
            body.querySelectorAll('pre code').forEach(function(block) {
                // Check for mermaid
                if (block.classList.contains('language-mermaid')) {
                    var pre = block.parentElement;
                    pre.classList.add('mermaid');
                    pre.textContent = block.textContent;
                    pre.removeAttribute('style');
                    // Build zoom/pan container (shared structure from mermaid-zoom)
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
                        '<div class="mermaid-svg-wrapper"></div>' +
                        '</div>';
                    pre.parentNode.insertBefore(mContainer, pre);
                    mContainer.querySelector('.mermaid-svg-wrapper').appendChild(pre);
                } else {
                    hljs.highlightElement(block);
                    addCopyButton(block.parentElement);
                }
            });

            // Add anchor links to headings
            body.querySelectorAll('h1, h2, h3, h4').forEach(function(heading) {
                var id = heading.textContent.toLowerCase()
                    .replace(/[^a-z0-9]+/g, '-')
                    .replace(/^-+|-+$/g, '');
                heading.id = id;
                var anchor = document.createElement('a');
                anchor.className = 'heading-anchor';
                anchor.href = '#' + id;
                anchor.textContent = '#';
                anchor.setAttribute('aria-label', 'Link to ' + heading.textContent);
                heading.appendChild(anchor);
            });

            // Render mermaid then attach zoom controls
            initMermaid().then(function() { initMermaidZoom(); });

            // Intercept internal .md links
            container.addEventListener('click', function(e) {
                var target = e.target;
                while (target && target !== container) {
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
                var slug = href.replace(/^(\\.\\/|\\.\\.\\/)*/, '').replace(/^components\\//, '').replace(/\\.md$/, '');

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

                // Try to find matching component ID
                var matchedId = findComponentIdBySlugClient(slug);
                if (matchedId) {
                    loadComponent(matchedId);
                    if (hashPart) {
                        setTimeout(function() {
                            var el = document.getElementById(hashPart);
                            if (el) el.scrollIntoView({ behavior: 'smooth' });
                        }, 100);
                    }
                }
            });
        }

        // Client-side component ID lookup by slug
        function findComponentIdBySlugClient(slug) {
            var normalized = slug.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
            for (var i = 0; i < componentGraph.components.length; i++) {
                var mod = componentGraph.components[i];
                var modSlug = mod.id.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
                if (modSlug === normalized) return mod.id;
            }
            return null;
        }

        function addCopyButton(pre) {
            var btn = document.createElement('button');
            btn.className = 'copy-btn';
            btn.textContent = 'Copy';
            btn.setAttribute('aria-label', 'Copy code');
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
            var mermaidBlocks = document.querySelectorAll('.mermaid');
            if (mermaidBlocks.length === 0) return Promise.resolve();

            var isDark = currentTheme === 'dark' ||
                (currentTheme === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);

            mermaid.initialize({
                startOnLoad: false,
                theme: isDark ? 'dark' : 'default',
                securityLevel: 'loose',
                flowchart: {
                    useMaxWidth: false,
                    htmlLabels: true,
                    curve: 'basis',
                    padding: 15,
                    nodeSpacing: 50,
                    rankSpacing: 50,
                },
                fontSize: 14,
            });
            return mermaid.run({ nodes: mermaidBlocks });
        }

        // ================================================================
        // Mermaid Zoom & Pan (shared via mermaid-zoom component)
        // ================================================================
${getMermaidZoomScript()}

        // ================================================================
        // Utility
        // ================================================================

        function escapeHtml(str) {
            if (!str) return '';
            return String(str)
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;');
        }`;
}
