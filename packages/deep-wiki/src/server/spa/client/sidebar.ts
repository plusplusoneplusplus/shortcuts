/**
 * Sidebar navigation: initializeSidebar, buildAreaSidebar, buildCategorySidebar,
 * buildTopicsSidebar, setActive, showWikiContent, showAdminContent.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { moduleGraph, escapeHtml } from './core';

const config = (window as any).__WIKI_CONFIG__ as WikiConfig;

export function initializeSidebar(): void {
    const topBarProject = document.getElementById('top-bar-project');
    if (topBarProject) topBarProject.textContent = moduleGraph.project.name;

    const navContainer = document.getElementById('nav-container');
    if (!navContainer) return;
    const hasAreas = moduleGraph.areas && moduleGraph.areas.length > 0;

    // Home + special items
    const homeSection = document.createElement('div');
    homeSection.className = 'nav-section';
    homeSection.innerHTML =
        '<div class="nav-item active" data-id="__home" onclick="showHome()">' +
        '<span class="nav-item-name">Overview</span></div>' +
        (config.enableGraph
            ? '<div class="nav-item" data-id="__graph" onclick="showGraph()">' +
              '<span class="nav-item-name">Dependency Graph</span></div>'
            : '') +
        '';
    navContainer.appendChild(homeSection);

    if (hasAreas) {
        buildAreaSidebar(navContainer);
    } else {
        buildCategorySidebar(navContainer);
    }

    if (config.enableSearch) {
        const searchEl = document.getElementById('search') as HTMLInputElement | null;
        if (searchEl) {
            searchEl.addEventListener('input', function (e: Event) {
                const query = (e.target as HTMLInputElement).value.toLowerCase();
                document.querySelectorAll('.nav-area-module[data-id], .nav-item[data-id]').forEach(function (item) {
                    const id = item.getAttribute('data-id');
                    if (id === '__home' || id === '__graph') return;
                    const text = item.textContent?.toLowerCase() ?? '';
                    (item as HTMLElement).style.display = text.includes(query) ? '' : 'none';
                });
                document.querySelectorAll('.nav-area-group').forEach(function (group) {
                    const visibleChildren = group.querySelectorAll('.nav-area-module:not([style*="display: none"])');
                    const areaItem = group.querySelector('.nav-area-item') as HTMLElement | null;
                    if (areaItem) areaItem.style.display = visibleChildren.length === 0 ? 'none' : '';
                    const childrenEl = group.querySelector('.nav-area-children') as HTMLElement | null;
                    if (childrenEl) childrenEl.style.display = visibleChildren.length === 0 ? 'none' : '';
                });
                document.querySelectorAll('.nav-section').forEach(function (section) {
                    const title = section.querySelector('.nav-section-title') as HTMLElement | null;
                    if (!title) return;
                    const visible = section.querySelectorAll('.nav-item[data-id]:not([style*="display: none"])');
                    title.style.display = visible.length === 0 ? 'none' : '';
                });
            });
        }
    }
}

function buildAreaSidebar(navContainer: HTMLElement): void {
    const areaMap: Record<string, any> = {};
    moduleGraph.areas.forEach(function (area: any) {
        areaMap[area.id] = area;
    });

    const areaModules: Record<string, any[]> = {};
    moduleGraph.areas.forEach(function (area: any) {
        areaModules[area.id] = [];
    });

    moduleGraph.modules.forEach(function (mod: any) {
        const areaId = mod.area;
        if (areaId && areaModules[areaId]) {
            areaModules[areaId].push(mod);
        } else {
            let found = false;
            moduleGraph.areas.forEach(function (area: any) {
                if (area.modules && area.modules.indexOf(mod.id) !== -1) {
                    areaModules[area.id].push(mod);
                    found = true;
                }
            });
            if (!found) {
                if (!areaModules['__other']) areaModules['__other'] = [];
                areaModules['__other'].push(mod);
            }
        }
    });

    moduleGraph.areas.forEach(function (area: any) {
        const modules = areaModules[area.id] || [];
        if (modules.length === 0) return;

        const group = document.createElement('div');
        group.className = 'nav-area-group';

        const areaItem = document.createElement('div');
        areaItem.className = 'nav-area-item';
        areaItem.setAttribute('data-area-id', area.id);
        areaItem.innerHTML = '<span class="nav-item-name">' + escapeHtml(area.name) + '</span>';
        group.appendChild(areaItem);

        const childrenEl = document.createElement('div');
        childrenEl.className = 'nav-area-children';

        modules.forEach(function (mod: any) {
            const item = document.createElement('div');
            item.className = 'nav-area-module';
            item.setAttribute('data-id', mod.id);
            item.innerHTML = '<span class="nav-item-name">' + escapeHtml(mod.name) + '</span>';
            item.onclick = function () { (window as any).loadModule(mod.id); };
            childrenEl.appendChild(item);
        });

        group.appendChild(childrenEl);
        navContainer.appendChild(group);
    });

    const otherModules = areaModules['__other'] || [];
    if (otherModules.length > 0) {
        const group = document.createElement('div');
        group.className = 'nav-area-group';
        const areaItem = document.createElement('div');
        areaItem.className = 'nav-area-item';
        areaItem.innerHTML = '<span class="nav-item-name">Other</span>';
        group.appendChild(areaItem);

        const childrenEl = document.createElement('div');
        childrenEl.className = 'nav-area-children';
        otherModules.forEach(function (mod: any) {
            const item = document.createElement('div');
            item.className = 'nav-area-module';
            item.setAttribute('data-id', mod.id);
            item.innerHTML = '<span class="nav-item-name">' + escapeHtml(mod.name) + '</span>';
            item.onclick = function () { (window as any).loadModule(mod.id); };
            childrenEl.appendChild(item);
        });
        group.appendChild(childrenEl);
        navContainer.appendChild(group);
    }

    buildTopicsSidebar(navContainer);
}

function buildCategorySidebar(navContainer: HTMLElement): void {
    const categories: Record<string, any[]> = {};
    moduleGraph.modules.forEach(function (mod: any) {
        const cat = mod.category || 'other';
        if (!categories[cat]) categories[cat] = [];
        categories[cat].push(mod);
    });

    Object.keys(categories).sort().forEach(function (category) {
        const group = document.createElement('div');
        group.className = 'nav-area-group';

        const catItem = document.createElement('div');
        catItem.className = 'nav-area-item';
        catItem.innerHTML = '<span class="nav-item-name">' + escapeHtml(category) + '</span>';
        group.appendChild(catItem);

        const childrenEl = document.createElement('div');
        childrenEl.className = 'nav-area-children';

        categories[category].forEach(function (mod: any) {
            const item = document.createElement('div');
            item.className = 'nav-area-module';
            item.setAttribute('data-id', mod.id);
            item.innerHTML = '<span class="nav-item-name">' + escapeHtml(mod.name) + '</span>';
            item.onclick = function () { (window as any).loadModule(mod.id); };
            childrenEl.appendChild(item);
        });

        group.appendChild(childrenEl);
        navContainer.appendChild(group);
    });

    buildTopicsSidebar(navContainer);
}

export function buildTopicsSidebar(navContainer: HTMLElement): void {
    const topics = moduleGraph.topics;
    if (!topics || topics.length === 0) return;

    const divider = document.createElement('div');
    divider.className = 'nav-section-title';
    divider.textContent = 'Topics';
    divider.setAttribute('data-section', 'topics');
    navContainer.appendChild(divider);

    topics.forEach(function (topic: any) {
        if (topic.layout === 'area' && topic.articles.length > 1) {
            const group = document.createElement('div');
            group.className = 'nav-area-group nav-topic-group';

            const topicItem = document.createElement('div');
            topicItem.className = 'nav-area-item';
            topicItem.setAttribute('data-topic-id', topic.id);
            topicItem.innerHTML = '<span class="nav-item-name">\ud83d\udccb ' + escapeHtml(topic.title) + '</span>';
            group.appendChild(topicItem);

            const childrenEl = document.createElement('div');
            childrenEl.className = 'nav-area-children';

            topic.articles.forEach(function (article: any) {
                const item = document.createElement('div');
                item.className = 'nav-area-module nav-topic-article';
                item.setAttribute('data-id', 'topic:' + topic.id + ':' + article.slug);
                item.innerHTML = '<span class="nav-item-name">' + escapeHtml(article.title) + '</span>';
                item.onclick = function () { (window as any).loadTopicArticle(topic.id, article.slug); };
                childrenEl.appendChild(item);
            });

            group.appendChild(childrenEl);
            navContainer.appendChild(group);
        } else {
            const slug = topic.articles.length > 0 ? topic.articles[0].slug : topic.id;
            const item = document.createElement('div');
            item.className = 'nav-item nav-topic-article';
            item.setAttribute('data-id', 'topic:' + topic.id + ':' + slug);
            item.innerHTML = '<span class="nav-item-name">\ud83d\udccb ' + escapeHtml(topic.title) + '</span>';
            item.onclick = function () { (window as any).loadTopicArticle(topic.id, slug); };
            navContainer.appendChild(item);
        }
    });
}

export function setActive(id: string): void {
    document.querySelectorAll('.nav-item, .nav-area-module, .nav-area-item').forEach(function (el) {
        el.classList.remove('active');
    });
    const target = document.querySelector('.nav-item[data-id="' + id + '"]') ||
                   document.querySelector('.nav-area-module[data-id="' + id + '"]');
    if (target) target.classList.add('active');
}

export function showWikiContent(): void {
    const contentScroll = document.getElementById('content-scroll');
    if (contentScroll) contentScroll.style.display = '';
    const adminPage = document.getElementById('admin-page');
    if (adminPage) adminPage.classList.add('hidden');
    const sidebar = document.getElementById('sidebar');
    if (sidebar) sidebar.style.display = '';
    const askWidget = document.getElementById('ask-widget');
    if (askWidget) askWidget.style.display = '';
}

export function showAdminContent(): void {
    const contentScroll = document.getElementById('content-scroll');
    if (contentScroll) contentScroll.style.display = 'none';
    const adminPage = document.getElementById('admin-page');
    if (adminPage) adminPage.classList.remove('hidden');
    const sidebar = document.getElementById('sidebar');
    if (sidebar) sidebar.style.display = 'none';
    const askWidget = document.getElementById('ask-widget');
    if (askWidget) askWidget.style.display = 'none';
}
