/**
 * Tests for ExplorerPanel mobile responsiveness.
 * Verifies the "show file tree OR preview" toggle pattern,
 * mobile back bar, and touch-friendly sizing.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const COMPONENT_PATH = path.join(
    __dirname, '..', '..', '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'repos', 'explorer', 'ExplorerPanel.tsx',
);

const TREE_NODE_PATH = path.join(
    __dirname, '..', '..', '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'repos', 'explorer', 'TreeNode.tsx',
);

const SEARCH_BAR_PATH = path.join(
    __dirname, '..', '..', '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'repos', 'explorer', 'SearchBar.tsx',
);

describe('ExplorerPanel mobile responsiveness', () => {
    let source: string;
    let treeNodeSource: string;
    let searchBarSource: string;

    beforeAll(() => {
        source = fs.readFileSync(COMPONENT_PATH, 'utf-8');
        treeNodeSource = fs.readFileSync(TREE_NODE_PATH, 'utf-8');
        searchBarSource = fs.readFileSync(SEARCH_BAR_PATH, 'utf-8');
    });

    describe('useBreakpoint integration', () => {
        it('imports useBreakpoint hook', () => {
            expect(source).toContain("import { useBreakpoint }");
        });

        it('destructures isMobile from useBreakpoint', () => {
            expect(source).toContain('const { isMobile } = useBreakpoint()');
        });
    });

    describe('mobile toggle pattern — show file tree OR preview', () => {
        it('computes showMobilePreview flag', () => {
            expect(source).toContain('const showMobilePreview = isMobile && !!previewFile');
        });

        it('hides sidebar via display:none when showing mobile preview', () => {
            expect(source).toContain("showMobilePreview ? { display: 'none' }");
        });

        it('hides preview pane on mobile when no file is selected', () => {
            expect(source).toContain("isMobile && !previewFile ? { display: 'none' }");
        });
    });

    describe('mobile back bar', () => {
        it('renders a mobile back bar with data-testid', () => {
            expect(source).toContain('data-testid="explorer-mobile-back-bar"');
        });

        it('renders a mobile back button with data-testid', () => {
            expect(source).toContain('data-testid="explorer-mobile-back-btn"');
        });

        it('back button clears previewFile to return to file tree', () => {
            expect(source).toContain('onClick={() => setPreviewFile(null)}');
        });

        it('shows the file name in the mobile back bar', () => {
            expect(source).toContain('{previewFile.name}');
        });

        it('only renders back bar on mobile', () => {
            expect(source).toContain('{isMobile && (');
        });
    });

    describe('onClose conditional for desktop vs mobile', () => {
        it('passes onClose only on desktop, undefined on mobile', () => {
            expect(source).toContain('onClose={isMobile ? undefined : () => setPreviewFile(null)}');
        });
    });

    describe('touch-friendly sizing', () => {
        it('TreeNode uses larger padding on mobile (py-2) and smaller on desktop (lg:py-1)', () => {
            expect(treeNodeSource).toContain('py-2');
            expect(treeNodeSource).toContain('lg:py-1');
        });

        it('TreeNode uses larger font on mobile (text-sm) and smaller on desktop (lg:text-xs)', () => {
            expect(treeNodeSource).toContain('text-sm');
            expect(treeNodeSource).toContain('lg:text-xs');
        });

        it('SearchBar uses larger padding on mobile (py-2.5) and smaller on desktop (lg:py-1.5)', () => {
            expect(searchBarSource).toContain('py-2.5');
            expect(searchBarSource).toContain('lg:py-1.5');
        });

        it('SearchBar uses larger font on mobile (text-base) and smaller on desktop (lg:text-sm)', () => {
            expect(searchBarSource).toContain('text-base');
            expect(searchBarSource).toContain('lg:text-sm');
        });
    });

    describe('layout structure', () => {
        it('uses flex-col lg:flex-row for responsive split', () => {
            expect(source).toContain('flex flex-col lg:flex-row');
        });

        it('resize handle is hidden on mobile (hidden lg:flex)', () => {
            expect(source).toContain('hidden lg:flex');
        });

        it('sidebar uses w-full and lg:flex-none for responsive width', () => {
            expect(source).toContain('w-full');
            expect(source).toContain('lg:flex-none');
        });
    });
});
