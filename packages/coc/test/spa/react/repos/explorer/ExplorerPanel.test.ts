/**
 * Tests for ExplorerPanel component source structure.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const COMPONENT_PATH = path.join(
    __dirname, '..', '..', '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'repos', 'explorer', 'ExplorerPanel.tsx'
);

describe('ExplorerPanel', () => {
    let source: string;

    beforeAll(() => {
        source = fs.readFileSync(COMPONENT_PATH, 'utf-8');
    });

    describe('exports', () => {
        it('exports ExplorerPanel as a named export', () => {
            expect(source).toContain('export function ExplorerPanel');
        });

        it('exports ExplorerPanelProps interface', () => {
            expect(source).toContain('export interface ExplorerPanelProps');
        });
    });

    describe('component signature', () => {
        it('accepts workspaceId prop', () => {
            expect(source).toContain('workspaceId: string');
        });
    });

    describe('state management', () => {
        it('manages rootEntries state', () => {
            expect(source).toContain('rootEntries');
            expect(source).toContain('setRootEntries');
        });

        it('manages selectedPath state', () => {
            expect(source).toContain('selectedPath');
            expect(source).toContain('setSelectedPath');
        });

        it('manages loading state', () => {
            expect(source).toContain('loading');
            expect(source).toContain('setLoading');
        });

        it('manages error state', () => {
            expect(source).toContain("[error, setError]");
        });

        it('manages expandedPaths state', () => {
            expect(source).toContain('expandedPaths');
            expect(source).toContain('setExpandedPaths');
        });

        it('manages childrenMap state', () => {
            expect(source).toContain('childrenMap');
            expect(source).toContain('setChildrenMap');
        });
    });

    describe('API integration', () => {
        it('fetches root entries from the tree API', () => {
            expect(source).toContain('/api/repos/');
            expect(source).toContain('/tree?path=/');
        });

        it('uses fetchApi for API calls', () => {
            expect(source).toContain("import { fetchApi } from '../../hooks/useApi'");
        });

        it('encodes workspaceId in the URL', () => {
            expect(source).toContain('encodeURIComponent(workspaceId)');
        });
    });

    describe('layout', () => {
        it('uses flex split layout (left/right)', () => {
            expect(source).toContain('flex flex-col lg:flex-row h-full overflow-hidden');
        });

        it('has left aside for file tree', () => {
            expect(source).toContain('<aside');
            expect(source).toContain('lg:w-80');
        });

        it('has right main for preview pane', () => {
            expect(source).toContain('<main');
            expect(source).toContain('data-testid="explorer-preview-pane"');
        });

        it('shows placeholder text in right pane', () => {
            expect(source).toContain('Double-click a file to preview');
        });

        it('has sidebar background colors', () => {
            expect(source).toContain('bg-[#f3f3f3] dark:bg-[#252526]');
        });

        it('has main pane background colors', () => {
            expect(source).toContain('bg-white dark:bg-[#1e1e1e]');
        });
    });

    describe('loading state', () => {
        it('shows Spinner while loading', () => {
            expect(source).toContain('<Spinner size="lg"');
        });

        it('has data-testid for loading state', () => {
            expect(source).toContain('data-testid="explorer-loading"');
        });
    });

    describe('error state', () => {
        it('displays error message', () => {
            expect(source).toContain('data-testid="explorer-error"');
        });

        it('uses error text color', () => {
            expect(source).toContain('text-[#d32f2f]');
        });
    });

    describe('refresh functionality', () => {
        it('has a refresh button', () => {
            expect(source).toContain('data-testid="explorer-refresh-btn"');
        });

        it('clears childrenMap on refresh', () => {
            expect(source).toContain('setChildrenMap(new Map())');
        });

        it('clears expandedPaths on refresh', () => {
            expect(source).toContain('setExpandedPaths(new Set())');
        });
    });

    describe('deep-link support', () => {
        it('reads location.hash on mount', () => {
            expect(source).toContain('location.hash');
        });

        it('updates hash on file selection', () => {
            expect(source).toContain('#repos/');
            expect(source).toContain('/explorer/');
        });

        it('decodes path from hash', () => {
            expect(source).toContain('decodeURIComponent');
        });
    });

    describe('data-testid attributes', () => {
        it('has explorer-panel testid', () => {
            expect(source).toContain('data-testid="explorer-panel"');
        });

        it('has explorer-loading testid', () => {
            expect(source).toContain('data-testid="explorer-loading"');
        });

        it('has explorer-error testid', () => {
            expect(source).toContain('data-testid="explorer-error"');
        });

        it('has explorer-preview-pane testid', () => {
            expect(source).toContain('data-testid="explorer-preview-pane"');
        });

        it('has explorer-refresh-btn testid', () => {
            expect(source).toContain('data-testid="explorer-refresh-btn"');
        });
    });

    describe('cancellation', () => {
        it('handles fetch cancellation on unmount', () => {
            expect(source).toContain('cancelled = true');
        });
    });

    describe('child component wiring', () => {
        it('renders FileTree component', () => {
            expect(source).toContain('<FileTree');
        });

        it('passes workspaceId to FileTree', () => {
            expect(source).toContain('workspaceId={workspaceId}');
        });

        it('passes entries to FileTree', () => {
            expect(source).toContain('entries={rootEntries}');
        });

        it('passes selectedPath to FileTree', () => {
            expect(source).toContain('selectedPath={selectedPath}');
        });

        it('passes expandedPaths to FileTree', () => {
            expect(source).toContain('expandedPaths={expandedPaths}');
        });

        it('passes childrenMap to FileTree', () => {
            expect(source).toContain('childrenMap={childrenMap}');
        });
    });
});
