/**
 * Sidebar script: initializeSidebar, buildAreaSidebar, buildCategorySidebar,
 * setActive, showWikiContent, showAdminContent.
 */
export function getSidebarScript(opts: { enableSearch: boolean; enableGraph: boolean }): string {
    return `
        // ================================================================
        // Sidebar Navigation
        // ================================================================

        function initializeSidebar() {
            document.getElementById('top-bar-project').textContent = moduleGraph.project.name;

            var navContainer = document.getElementById('nav-container');
            var hasAreas = moduleGraph.areas && moduleGraph.areas.length > 0;

            // Home + special items
            var homeSection = document.createElement('div');
            homeSection.className = 'nav-section';
            homeSection.innerHTML =
                '<div class="nav-item active" data-id="__home" onclick="showHome()">' +
                '<span class="nav-item-name">Overview</span></div>' +
${opts.enableGraph ? `                '<div class="nav-item" data-id="__graph" onclick="showGraph()">' +
                '<span class="nav-item-name">Dependency Graph</span></div>' +` : ''}
                '';
            navContainer.appendChild(homeSection);

            if (hasAreas) {
                // DeepWiki-style: areas as top-level, modules indented underneath
                buildAreaSidebar(navContainer);
            } else {
                // Fallback: category-based grouping
                buildCategorySidebar(navContainer);
            }
${opts.enableSearch ? `
            document.getElementById('search').addEventListener('input', function(e) {
                var query = e.target.value.toLowerCase();
                // Search area-based items
                document.querySelectorAll('.nav-area-module[data-id], .nav-item[data-id]').forEach(function(item) {
                    var id = item.getAttribute('data-id');
                    if (id === '__home' || id === '__graph') return;
                    var text = item.textContent.toLowerCase();
                    item.style.display = text.includes(query) ? '' : 'none';
                });
                // Hide area headers when no children match
                document.querySelectorAll('.nav-area-group').forEach(function(group) {
                    var visibleChildren = group.querySelectorAll('.nav-area-module:not([style*="display: none"])');
                    var areaItem = group.querySelector('.nav-area-item');
                    if (areaItem) {
                        areaItem.style.display = visibleChildren.length === 0 ? 'none' : '';
                    }
                    var childrenEl = group.querySelector('.nav-area-children');
                    if (childrenEl) {
                        childrenEl.style.display = visibleChildren.length === 0 ? 'none' : '';
                    }
                });
                // Hide category sections when no children match
                document.querySelectorAll('.nav-section').forEach(function(section) {
                    var title = section.querySelector('.nav-section-title');
                    if (!title) return;
                    var visible = section.querySelectorAll('.nav-item[data-id]:not([style*="display: none"])');
                    title.style.display = visible.length === 0 ? 'none' : '';
                });
            });` : ''}
        }

        // Build area-based sidebar (DeepWiki-style hierarchy)
        function buildAreaSidebar(navContainer) {
            // Build a map of area ID → area info
            var areaMap = {};
            moduleGraph.areas.forEach(function(area) {
                areaMap[area.id] = area;
            });

            // Build a map of area ID → modules
            var areaModules = {};
            moduleGraph.areas.forEach(function(area) {
                areaModules[area.id] = [];
            });

            // Assign modules to their areas
            moduleGraph.modules.forEach(function(mod) {
                var areaId = mod.area;
                if (areaId && areaModules[areaId]) {
                    areaModules[areaId].push(mod);
                } else {
                    // Try to find area by module ID listed in area.modules
                    var found = false;
                    moduleGraph.areas.forEach(function(area) {
                        if (area.modules && area.modules.indexOf(mod.id) !== -1) {
                            areaModules[area.id].push(mod);
                            found = true;
                        }
                    });
                    if (!found) {
                        // Put unassigned modules in an "Other" group
                        if (!areaModules['__other']) areaModules['__other'] = [];
                        areaModules['__other'].push(mod);
                    }
                }
            });

            // Render each area with its modules
            moduleGraph.areas.forEach(function(area) {
                var modules = areaModules[area.id] || [];
                if (modules.length === 0) return;

                var group = document.createElement('div');
                group.className = 'nav-area-group';

                // Area header (top-level item)
                var areaItem = document.createElement('div');
                areaItem.className = 'nav-area-item';
                areaItem.setAttribute('data-area-id', area.id);
                areaItem.innerHTML = '<span class="nav-item-name">' + escapeHtml(area.name) + '</span>';
                group.appendChild(areaItem);

                // Module children (indented)
                var childrenEl = document.createElement('div');
                childrenEl.className = 'nav-area-children';

                modules.forEach(function(mod) {
                    var item = document.createElement('div');
                    item.className = 'nav-area-module';
                    item.setAttribute('data-id', mod.id);
                    item.innerHTML = '<span class="nav-item-name">' + escapeHtml(mod.name) + '</span>';
                    item.onclick = function() { loadModule(mod.id); };
                    childrenEl.appendChild(item);
                });

                group.appendChild(childrenEl);
                navContainer.appendChild(group);
            });

            // Render unassigned modules if any
            var otherModules = areaModules['__other'] || [];
            if (otherModules.length > 0) {
                var group = document.createElement('div');
                group.className = 'nav-area-group';
                var areaItem = document.createElement('div');
                areaItem.className = 'nav-area-item';
                areaItem.innerHTML = '<span class="nav-item-name">Other</span>';
                group.appendChild(areaItem);

                var childrenEl = document.createElement('div');
                childrenEl.className = 'nav-area-children';
                otherModules.forEach(function(mod) {
                    var item = document.createElement('div');
                    item.className = 'nav-area-module';
                    item.setAttribute('data-id', mod.id);
                    item.innerHTML = '<span class="nav-item-name">' + escapeHtml(mod.name) + '</span>';
                    item.onclick = function() { loadModule(mod.id); };
                    childrenEl.appendChild(item);
                });
                group.appendChild(childrenEl);
                navContainer.appendChild(group);
            }
        }

        // Build category-based sidebar (fallback for non-area repos)
        // Uses the same visual style as area-based sidebar (DeepWiki-style)
        function buildCategorySidebar(navContainer) {
            var categories = {};
            moduleGraph.modules.forEach(function(mod) {
                var cat = mod.category || 'other';
                if (!categories[cat]) categories[cat] = [];
                categories[cat].push(mod);
            });

            Object.keys(categories).sort().forEach(function(category) {
                var group = document.createElement('div');
                group.className = 'nav-area-group';

                // Category header (same style as area header)
                var catItem = document.createElement('div');
                catItem.className = 'nav-area-item';
                catItem.innerHTML = '<span class="nav-item-name">' + escapeHtml(category) + '</span>';
                group.appendChild(catItem);

                // Module children (indented)
                var childrenEl = document.createElement('div');
                childrenEl.className = 'nav-area-children';

                categories[category].forEach(function(mod) {
                    var item = document.createElement('div');
                    item.className = 'nav-area-module';
                    item.setAttribute('data-id', mod.id);
                    item.innerHTML = '<span class="nav-item-name">' + escapeHtml(mod.name) + '</span>';
                    item.onclick = function() { loadModule(mod.id); };
                    childrenEl.appendChild(item);
                });

                group.appendChild(childrenEl);
                navContainer.appendChild(group);
            });
        }

        function setActive(id) {
            document.querySelectorAll('.nav-item, .nav-area-module, .nav-area-item').forEach(function(el) {
                el.classList.remove('active');
            });
            var target = document.querySelector('.nav-item[data-id="' + id + '"]') ||
                         document.querySelector('.nav-area-module[data-id="' + id + '"]');
            if (target) target.classList.add('active');
        }

        function showWikiContent() {
            document.getElementById('content-scroll').style.display = '';
            document.getElementById('admin-page').classList.add('hidden');
            document.getElementById('sidebar').style.display = '';
            var askWidget = document.getElementById('ask-widget');
            if (askWidget) askWidget.style.display = '';
        }

        function showAdminContent() {
            document.getElementById('content-scroll').style.display = 'none';
            document.getElementById('admin-page').classList.remove('hidden');
            document.getElementById('sidebar').style.display = 'none';
            var askWidget = document.getElementById('ask-widget');
            if (askWidget) askWidget.style.display = 'none';
        }
`;
}
