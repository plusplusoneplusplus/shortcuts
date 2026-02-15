/**
 * Wiki component tree sidebar — port of deep-wiki sidebar.ts domain/category tree building.
 *
 * Renders a collapsible tree of components grouped by domain (if present) or category.
 * Uses CoC-scoped CSS class names (.wiki-tree-*) to avoid collision with deep-wiki styles.
 */

import { appState } from './state';
import { setHashSilent } from './core';
import { escapeHtmlClient } from './utils';
import type { ComponentGraph, ComponentInfo, DomainInfo } from './wiki-types';

/**
 * Build the component tree DOM inside the given container.
 * Groups by domains if present, otherwise by categories.
 */
export function buildComponentTree(graph: ComponentGraph, container: HTMLElement): void {
    container.innerHTML = '';

    if (!graph.components || graph.components.length === 0) {
        container.innerHTML = '<div class="wiki-tree-empty">No components found</div>';
        return;
    }

    if (graph.domains && graph.domains.length > 0) {
        buildDomainTree(graph, container);
    } else {
        buildCategoryTree(graph, container);
    }
}

function buildDomainTree(graph: ComponentGraph, container: HTMLElement): void {
    const componentMap = new Map<string, ComponentInfo>();
    for (const comp of graph.components) {
        componentMap.set(comp.id, comp);
    }

    const assignedIds = new Set<string>();

    for (const domain of graph.domains!) {
        const domainComponents = (domain.components || [])
            .map(id => componentMap.get(id))
            .filter((c): c is ComponentInfo => !!c);

        if (domainComponents.length === 0) continue;

        for (const c of domainComponents) assignedIds.add(c.id);

        const group = createTreeGroup(domain.name, domainComponents);
        container.appendChild(group);
    }

    // Components without a domain
    const unassigned = graph.components.filter(c => !assignedIds.has(c.id));
    if (unassigned.length > 0) {
        const group = createTreeGroup('Other', unassigned);
        container.appendChild(group);
    }
}

function buildCategoryTree(graph: ComponentGraph, container: HTMLElement): void {
    const categoryMap = new Map<string, ComponentInfo[]>();

    for (const comp of graph.components) {
        const cat = comp.category || 'other';
        if (!categoryMap.has(cat)) categoryMap.set(cat, []);
        categoryMap.get(cat)!.push(comp);
    }

    const sortedCategories = Array.from(categoryMap.keys()).sort();
    for (const cat of sortedCategories) {
        const group = createTreeGroup(cat, categoryMap.get(cat)!);
        container.appendChild(group);
    }
}

function createTreeGroup(name: string, components: ComponentInfo[]): HTMLElement {
    const group = document.createElement('div');
    group.className = 'wiki-tree-group';

    const header = document.createElement('div');
    header.className = 'wiki-tree-item';
    header.innerHTML = `<span class="wiki-tree-arrow">&#9654;</span> ${escapeHtmlClient(name)} <span class="wiki-tree-count">(${components.length})</span>`;
    header.addEventListener('click', () => {
        group.classList.toggle('expanded');
    });

    const children = document.createElement('div');
    children.className = 'wiki-tree-children';

    for (const comp of components) {
        const item = document.createElement('div');
        item.className = 'wiki-tree-component';
        item.setAttribute('data-id', comp.id);
        item.textContent = comp.name;
        item.title = comp.purpose || '';
        item.addEventListener('click', () => {
            const wikiId = appState.selectedWikiId;
            if (wikiId) {
                setHashSilent(`#wiki/${encodeURIComponent(wikiId)}/component/${encodeURIComponent(comp.id)}`);
                (window as any).showWikiComponent?.(wikiId, comp.id);
            }
        });
        children.appendChild(item);
    }

    group.appendChild(header);
    group.appendChild(children);
    // Start expanded
    group.classList.add('expanded');

    return group;
}

(window as any).buildComponentTree = buildComponentTree;
