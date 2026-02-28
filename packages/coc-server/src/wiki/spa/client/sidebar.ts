/**
 * Sidebar navigation: initializeSidebar, buildDomainSidebar, buildCategorySidebar,
 * buildThemesSidebar, setActive, showWikiContent, showAdminContent.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { componentGraph, escapeHtml } from './core';

const config = (window as any).__WIKI_CONFIG__ as WikiConfig;

export function initializeSidebar(): void {
    const topBarProject = document.getElementById('top-bar-project');
    if (topBarProject) topBarProject.textContent = componentGraph.project.name;

    const navContainer = document.getElementById('nav-container');
    if (!navContainer) return;
    const hasDomains = componentGraph.domains && componentGraph.domains.length > 0;

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

    if (hasDomains) {
        buildDomainSidebar(navContainer);
    } else {
        buildCategorySidebar(navContainer);
    }

    if (config.enableSearch) {
        const searchEl = document.getElementById('search') as HTMLInputElement | null;
        if (searchEl) {
            searchEl.addEventListener('input', function (e: Event) {
                const query = (e.target as HTMLInputElement).value.toLowerCase();
                document.querySelectorAll('.nav-domain-component[data-id], .nav-item[data-id]').forEach(function (item) {
                    const id = item.getAttribute('data-id');
                    if (id === '__home' || id === '__graph') return;
                    const text = item.textContent?.toLowerCase() ?? '';
                    (item as HTMLElement).style.display = text.includes(query) ? '' : 'none';
                });
                document.querySelectorAll('.nav-domain-group').forEach(function (group) {
                    const visibleChildren = group.querySelectorAll('.nav-domain-component:not([style*="display: none"])');
                    const domainItem = group.querySelector('.nav-domain-item') as HTMLElement | null;
                    if (domainItem) domainItem.style.display = visibleChildren.length === 0 ? 'none' : '';
                    const childrenEl = group.querySelector('.nav-domain-children') as HTMLElement | null;
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

function buildDomainSidebar(navContainer: HTMLElement): void {
    const domainMap: Record<string, any> = {};
    componentGraph.domains.forEach(function (domain: any) {
        domainMap[area.id] = area;
    });

    const domainComponents: Record<string, any[]> = {};
    componentGraph.domains.forEach(function (domain: any) {
        domainComponents[area.id] = [];
    });

    componentGraph.components.forEach(function (mod: any) {
        const domainId = mod.domain;
        if (domainId && domainComponents[domainId]) {
            domainComponents[domainId].push(mod);
        } else {
            let found = false;
            componentGraph.domains.forEach(function (domain: any) {
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

    componentGraph.domains.forEach(function (domain: any) {
        const components = domainComponents[area.id] || [];
        if (components.length === 0) return;

        const group = document.createElement('div');
        group.className = 'nav-area-group';

        const domainItem = document.createElement('div');
        domainItem.className = 'nav-area-item';
        domainItem.setAttribute('data-domain-id', area.id);
        domainItem.innerHTML = '<span class="nav-item-name">' + escapeHtml(area.name) + '</span>';
        group.appendChild(domainItem);

        const childrenEl = document.createElement('div');
        childrenEl.className = 'nav-area-children';

        components.forEach(function (mod: any) {
            const item = document.createElement('div');
            item.className = 'nav-area-component';
            item.setAttribute('data-id', mod.id);
            item.innerHTML = '<span class="nav-item-name">' + escapeHtml(mod.name) + '</span>';
            item.onclick = function () { (window as any).loadComponent(mod.id); };
            childrenEl.appendChild(item);
        });

        group.appendChild(childrenEl);
        navContainer.appendChild(group);
    });

    const otherComponents = domainComponents['__other'] || [];
    if (otherComponents.length > 0) {
        const group = document.createElement('div');
        group.className = 'nav-area-group';
        const domainItem = document.createElement('div');
        domainItem.className = 'nav-area-item';
        domainItem.innerHTML = '<span class="nav-item-name">Other</span>';
        group.appendChild(domainItem);

        const childrenEl = document.createElement('div');
        childrenEl.className = 'nav-area-children';
        otherComponents.forEach(function (mod: any) {
            const item = document.createElement('div');
            item.className = 'nav-area-component';
            item.setAttribute('data-id', mod.id);
            item.innerHTML = '<span class="nav-item-name">' + escapeHtml(mod.name) + '</span>';
            item.onclick = function () { (window as any).loadComponent(mod.id); };
            childrenEl.appendChild(item);
        });
        group.appendChild(childrenEl);
        navContainer.appendChild(group);
    }

    buildThemesSidebar(navContainer);
}

function buildCategorySidebar(navContainer: HTMLElement): void {
    const categories: Record<string, any[]> = {};
    componentGraph.components.forEach(function (mod: any) {
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
            item.className = 'nav-area-component';
            item.setAttribute('data-id', mod.id);
            item.innerHTML = '<span class="nav-item-name">' + escapeHtml(mod.name) + '</span>';
            item.onclick = function () { (window as any).loadComponent(mod.id); };
            childrenEl.appendChild(item);
        });

        group.appendChild(childrenEl);
        navContainer.appendChild(group);
    });

    buildThemesSidebar(navContainer);
}

export function buildThemesSidebar(navContainer: HTMLElement): void {
    const themes = componentGraph.themes;
    if (!themes || themes.length === 0) return;

    const divider = document.createElement('div');
    divider.className = 'nav-section-title';
    divider.textContent = 'Themes';
    divider.setAttribute('data-section', 'themes');
    navContainer.appendChild(divider);

    themes.forEach(function (theme: any) {
        if (theme.layout === 'area' && theme.articles.length > 1) {
            const group = document.createElement('div');
            group.className = 'nav-area-group nav-theme-group';

            const themeItem = document.createElement('div');
            themeItem.className = 'nav-area-item';
            themeItem.setAttribute('data-theme-id', theme.id);
            themeItem.innerHTML = '<span class="nav-item-name">\ud83d\udccb ' + escapeHtml(theme.title) + '</span>';
            group.appendChild(themeItem);

            const childrenEl = document.createElement('div');
            childrenEl.className = 'nav-area-children';

            theme.articles.forEach(function (article: any) {
                const item = document.createElement('div');
                item.className = 'nav-area-component nav-theme-article';
                item.setAttribute('data-id', 'theme:' + theme.id + ':' + article.slug);
                item.innerHTML = '<span class="nav-item-name">' + escapeHtml(article.title) + '</span>';
                item.onclick = function () { (window as any).loadThemeArticle(theme.id, article.slug); };
                childrenEl.appendChild(item);
            });

            group.appendChild(childrenEl);
            navContainer.appendChild(group);
        } else {
            const slug = theme.articles.length > 0 ? theme.articles[0].slug : theme.id;
            const item = document.createElement('div');
            item.className = 'nav-item nav-theme-article';
            item.setAttribute('data-id', 'theme:' + theme.id + ':' + slug);
            item.innerHTML = '<span class="nav-item-name">\ud83d\udccb ' + escapeHtml(theme.title) + '</span>';
            item.onclick = function () { (window as any).loadThemeArticle(theme.id, slug); };
            navContainer.appendChild(item);
        }
    });
}

export function setActive(id: string): void {
    document.querySelectorAll('.nav-item, .nav-area-component, .nav-domain-item').forEach(function (el) {
        el.classList.remove('active');
    });
    const target = document.querySelector('.nav-item[data-id="' + id + '"]') ||
                   document.querySelector('.nav-area-component[data-id="' + id + '"]');
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
