/**
 * Content loading script: showHome, loadModule, renderModulePage,
 * toggleSourceFiles, loadSpecialPage.
 */
export function getContentScript(opts: { enableAI: boolean }): string {
    return `
        // ================================================================
        // Content Loading
        // ================================================================

        function showHome(skipHistory) {
            currentModuleId = null;
            setActive('__home');
            showWikiContent();
            document.getElementById('toc-nav').innerHTML = '';
            if (!skipHistory) {
                history.pushState({ type: 'home' }, '', location.pathname);
            }
${opts.enableAI ? `            updateAskSubject(moduleGraph.project.name);` : ''}

            var stats = {
                modules: moduleGraph.modules.length,
                categories: (moduleGraph.categories || []).length,
                language: moduleGraph.project.language,
                buildSystem: moduleGraph.project.buildSystem,
            };

            var html = '<div class="home-view">' +
                '<h1>' + escapeHtml(moduleGraph.project.name) + '</h1>' +
                '<p style="font-size: 15px; color: var(--content-muted); margin-bottom: 24px;">' +
                escapeHtml(moduleGraph.project.description) + '</p>' +
                '<div class="project-stats">' +
                '<div class="stat-card"><h3>Modules</h3><div class="value">' + stats.modules + '</div></div>' +
                '<div class="stat-card"><h3>Categories</h3><div class="value">' + stats.categories + '</div></div>' +
                '<div class="stat-card"><h3>Language</h3><div class="value small">' + escapeHtml(stats.language) + '</div></div>' +
                '<div class="stat-card"><h3>Build System</h3><div class="value small">' + escapeHtml(stats.buildSystem) + '</div></div>' +
                '</div>';

            var hasAreas = moduleGraph.areas && moduleGraph.areas.length > 0;
            if (hasAreas) {
                // Group modules by area for the overview
                moduleGraph.areas.forEach(function(area) {
                    var areaModules = moduleGraph.modules.filter(function(mod) {
                        if (mod.area === area.id) return true;
                        return area.modules && area.modules.indexOf(mod.id) !== -1;
                    });
                    if (areaModules.length === 0) return;

                    html += '<h3 style="margin-top: 24px; margin-bottom: 12px;">' + escapeHtml(area.name) + '</h3>';
                    if (area.description) {
                        html += '<p style="color: var(--content-muted); margin-bottom: 12px; font-size: 14px;">' +
                            escapeHtml(area.description) + '</p>';
                    }
                    html += '<div class="module-grid">';
                    areaModules.forEach(function(mod) {
                        html += '<div class="module-card" onclick="loadModule(\\'' +
                            mod.id.replace(/'/g, "\\\\'") + '\\')">' +
                            '<h4>' + escapeHtml(mod.name) +
                            ' <span class="complexity-badge complexity-' + mod.complexity + '">' +
                            mod.complexity + '</span></h4>' +
                            '<p>' + escapeHtml(mod.purpose) + '</p></div>';
                    });
                    html += '</div>';
                });

                // Show unassigned modules if any
                var assignedIds = new Set();
                moduleGraph.areas.forEach(function(area) {
                    moduleGraph.modules.forEach(function(mod) {
                        if (mod.area === area.id || (area.modules && area.modules.indexOf(mod.id) !== -1)) {
                            assignedIds.add(mod.id);
                        }
                    });
                });
                var unassigned = moduleGraph.modules.filter(function(mod) { return !assignedIds.has(mod.id); });
                if (unassigned.length > 0) {
                    html += '<h3 style="margin-top: 24px; margin-bottom: 12px;">Other</h3><div class="module-grid">';
                    unassigned.forEach(function(mod) {
                        html += '<div class="module-card" onclick="loadModule(\\'' +
                            mod.id.replace(/'/g, "\\\\'") + '\\')">' +
                            '<h4>' + escapeHtml(mod.name) +
                            ' <span class="complexity-badge complexity-' + mod.complexity + '">' +
                            mod.complexity + '</span></h4>' +
                            '<p>' + escapeHtml(mod.purpose) + '</p></div>';
                    });
                    html += '</div>';
                }
            } else {
                html += '<h3 style="margin-top: 24px; margin-bottom: 12px;">All Modules</h3><div class="module-grid">';
                moduleGraph.modules.forEach(function(mod) {
                    html += '<div class="module-card" onclick="loadModule(\\'' +
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
            document.getElementById('content-scroll').scrollTop = 0;
        }

        async function loadModule(moduleId, skipHistory) {
            var mod = moduleGraph.modules.find(function(m) { return m.id === moduleId; });
            if (!mod) return;

            currentModuleId = moduleId;
            setActive(moduleId);
            showWikiContent();
            if (!skipHistory) {
                history.pushState({ type: 'module', id: moduleId }, '', location.pathname + '#module-' + encodeURIComponent(moduleId));
            }
${opts.enableAI ? `            updateAskSubject(mod.name);` : ''}

            // Check cache
            if (markdownCache[moduleId]) {
                renderModulePage(mod, markdownCache[moduleId]);
                document.getElementById('content-scroll').scrollTop = 0;
                return;
            }

            // Fetch from API
            document.getElementById('content').innerHTML = '<div class="loading">Loading module...</div>';
            try {
                var res = await fetch('/api/modules/' + encodeURIComponent(moduleId));
                if (!res.ok) throw new Error('Failed to load module');
                var data = await res.json();
                if (data.markdown) {
                    markdownCache[moduleId] = data.markdown;
                    renderModulePage(mod, data.markdown);
                } else {
                    document.getElementById('content').innerHTML =
                        '<div class="markdown-body"><h2>' + escapeHtml(mod.name) + '</h2>' +
                        '<p>' + escapeHtml(mod.purpose) + '</p></div>';
                }
            } catch(err) {
                document.getElementById('content').innerHTML =
                    '<p style="color: red;">Error loading module: ' + err.message + '</p>';
            }
            document.getElementById('content-scroll').scrollTop = 0;
        }

        function renderModulePage(mod, markdown) {
            var html = '';

            // Source files section
            if (mod.keyFiles && mod.keyFiles.length > 0) {
                html += '<div class="source-files-section" id="source-files">' +
                    '<button class="source-files-toggle" onclick="toggleSourceFiles()">' +
                    '<span class="source-files-arrow">&#x25B6;</span> Relevant source files' +
                    '</button>' +
                    '<div class="source-files-list">';
                mod.keyFiles.forEach(function(f) {
                    html += '<span class="source-pill"><span class="source-pill-icon">&#9671;</span> ' +
                        escapeHtml(f) + '</span>';
                });
                html += '</div></div>';
            }

            // Markdown content
            html += '<div class="markdown-body">' + marked.parse(markdown) + '</div>';
            document.getElementById('content').innerHTML = html;

            // Post-processing
            processMarkdownContent();
            buildToc();
${opts.enableAI ? `            addDeepDiveButton(mod.id);` : ''}
        }

        function toggleSourceFiles() {
            var section = document.getElementById('source-files');
            if (section) section.classList.toggle('expanded');
        }

        async function loadSpecialPage(key, title, skipHistory) {
            currentModuleId = null;
            setActive(key);
            showWikiContent();
            if (!skipHistory) {
                history.pushState({ type: 'special', key: key, title: title }, '', location.pathname + '#' + encodeURIComponent(key));
            }

            var cacheKey = '__page_' + key;
            if (markdownCache[cacheKey]) {
                renderMarkdownContent(markdownCache[cacheKey]);
                buildToc();
                document.getElementById('content-scroll').scrollTop = 0;
                return;
            }

            document.getElementById('content').innerHTML = '<div class="loading">Loading page...</div>';
            try {
                var res = await fetch('/api/pages/' + encodeURIComponent(key));
                if (!res.ok) throw new Error('Page not found');
                var data = await res.json();
                markdownCache[cacheKey] = data.markdown;
                renderMarkdownContent(data.markdown);
                buildToc();
            } catch(err) {
                document.getElementById('content').innerHTML = '<p>Content not available.</p>';
            }
            document.getElementById('content-scroll').scrollTop = 0;
        }
`;
}
