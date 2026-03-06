/**
 * Integration tests for ExplorerPanel search, filter, and breadcrumb features.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const PANEL_PATH = path.join(
    __dirname, '..', '..', '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'repos', 'explorer', 'ExplorerPanel.tsx'
);

const TREE_PATH = path.join(
    __dirname, '..', '..', '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'repos', 'explorer', 'FileTree.tsx'
);

const TREENODE_PATH = path.join(
    __dirname, '..', '..', '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'repos', 'explorer', 'TreeNode.tsx'
);

describe('ExplorerPanel — search integration', () => {
    let panelSource: string;
    let treeSource: string;
    let nodeSource: string;

    beforeAll(() => {
        panelSource = fs.readFileSync(PANEL_PATH, 'utf-8');
        treeSource = fs.readFileSync(TREE_PATH, 'utf-8');
        nodeSource = fs.readFileSync(TREENODE_PATH, 'utf-8');
    });

    describe('search state', () => {
        it('manages searchInput state', () => {
            expect(panelSource).toContain('searchInput');
            expect(panelSource).toContain('setSearchInput');
        });

        it('manages searchQuery state with debounce', () => {
            expect(panelSource).toContain('searchQuery');
            expect(panelSource).toContain('setSearchQuery');
            expect(panelSource).toContain('debounceRef');
        });

        it('uses 150ms debounce', () => {
            expect(panelSource).toContain('150');
        });

        it('has search input ref for programmatic focus', () => {
            expect(panelSource).toContain('searchInputRef');
        });
    });

    describe('SearchBar integration', () => {
        it('imports SearchBar', () => {
            expect(panelSource).toContain("import { SearchBar } from './SearchBar'");
        });

        it('renders SearchBar component', () => {
            expect(panelSource).toContain('<SearchBar');
        });

        it('passes value, onChange, onClear, inputRef to SearchBar', () => {
            expect(panelSource).toContain('value={searchInput}');
            expect(panelSource).toContain('onChange={onSearchChange}');
            expect(panelSource).toContain('onClear={onSearchClear}');
            expect(panelSource).toContain('inputRef={searchInputRef}');
        });

        it('passes placeholder to SearchBar', () => {
            expect(panelSource).toContain('placeholder="Filter files…"');
        });
    });

    describe('Breadcrumbs integration', () => {
        it('imports Breadcrumbs', () => {
            expect(panelSource).toContain("import { Breadcrumbs } from './Breadcrumbs'");
        });

        it('renders Breadcrumbs component', () => {
            expect(panelSource).toContain('<Breadcrumbs');
        });

        it('derives breadcrumbSegments from selectedPath', () => {
            expect(panelSource).toContain('breadcrumbSegments');
            expect(panelSource).toContain("selectedPath.split('/').filter(Boolean)");
        });

        it('passes segments and onNavigate to Breadcrumbs', () => {
            expect(panelSource).toContain('segments={breadcrumbSegments}');
            expect(panelSource).toContain('onNavigate={handleBreadcrumbNavigate}');
        });
    });

    describe('FileTree filter prop', () => {
        it('passes filterQuery to FileTree', () => {
            expect(panelSource).toContain('filterQuery={searchQuery}');
        });

        it('FileTree accepts filterQuery prop', () => {
            expect(treeSource).toContain('filterQuery?: string');
        });
    });

    describe('filtering logic in FileTree', () => {
        it('exports filterEntries function', () => {
            expect(treeSource).toContain('export function filterEntries');
        });

        it('exports hasMatchingDescendant function', () => {
            expect(treeSource).toContain('export function hasMatchingDescendant');
        });

        it('uses case-insensitive matching', () => {
            expect(treeSource).toContain('.toLowerCase().includes(');
        });

        it('keeps un-fetched directories visible during filtering', () => {
            expect(treeSource).toContain('!childrenMap.has(entry.path)');
        });

        it('applies filterEntries to root entries', () => {
            expect(treeSource).toContain('filteredEntries');
        });
    });

    describe('match highlighting in TreeNode', () => {
        it('imports highlightMatch', () => {
            expect(nodeSource).toContain("import { highlightMatch } from '../../tasks/TaskSearchResults'");
        });

        it('applies highlightMatch when filterQuery is present', () => {
            expect(nodeSource).toContain('highlightMatch(entry.name, filterQuery)');
        });

        it('falls back to plain name when no filterQuery', () => {
            expect(nodeSource).toContain('filterQuery ? highlightMatch(entry.name, filterQuery) : entry.name');
        });
    });

    describe('TreeNode child filtering', () => {
        it('imports filterEntries for recursive filtering', () => {
            expect(nodeSource).toContain("import { filterEntries } from './FileTree'");
        });

        it('applies filterEntries to children', () => {
            expect(nodeSource).toContain('filterEntries(children, filterQuery');
        });

        it('passes filterQuery to child TreeNode', () => {
            expect(nodeSource).toContain('filterQuery={filterQuery}');
        });
    });

    describe('keyboard shortcuts', () => {
        it('registers keydown listener for "/" to focus search', () => {
            expect(panelSource).toContain("e.key === '/'");
            expect(panelSource).toContain('searchInputRef.current?.focus()');
        });

        it('prevents default on "/" key', () => {
            expect(panelSource).toContain('e.preventDefault()');
        });

        it('checks that no input is focused before handling "/"', () => {
            expect(panelSource).toContain("document.activeElement?.tagName !== 'INPUT'");
        });

        it('handles Escape to clear search', () => {
            expect(panelSource).toContain("e.key === 'Escape'");
            expect(panelSource).toContain('onSearchClear()');
        });

        it('blurs input on Escape', () => {
            expect(panelSource).toContain('searchInputRef.current?.blur()');
        });
    });

    describe('expanded state preservation', () => {
        it('saves pre-filter expanded state', () => {
            expect(panelSource).toContain('preFilterExpandedRef');
        });

        it('restores expanded state when search is cleared', () => {
            expect(panelSource).toContain('setExpandedPaths(preFilterExpandedRef.current)');
            expect(panelSource).toContain('preFilterExpandedRef.current = null');
        });
    });

    describe('breadcrumb navigation', () => {
        it('handleBreadcrumbNavigate reconstructs path from segments', () => {
            expect(panelSource).toContain('segments.slice(0, segmentIndex + 1)');
        });

        it('expands the navigated path', () => {
            expect(panelSource).toContain('next.add(targetPath)');
        });

        it('handles root navigation (index < 0)', () => {
            expect(panelSource).toContain('segmentIndex < 0');
            expect(panelSource).toContain('setSelectedPath(null)');
        });
    });

    describe('layout order', () => {
        it('renders Breadcrumbs before SearchBar before FileTree', () => {
            const breadcrumbIdx = panelSource.indexOf('<Breadcrumbs');
            const searchIdx = panelSource.indexOf('<SearchBar');
            const treeIdx = panelSource.indexOf('<FileTree');
            expect(breadcrumbIdx).toBeLessThan(searchIdx);
            expect(searchIdx).toBeLessThan(treeIdx);
        });
    });
});
