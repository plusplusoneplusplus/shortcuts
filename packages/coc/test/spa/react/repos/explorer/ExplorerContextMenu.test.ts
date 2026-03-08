/**
 * Tests for Explorer context menu integration.
 * Verifies that TreeNode, FileTree, and ExplorerPanel correctly
 * support right-click context menus.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const EXPLORER_DIR = path.join(
    __dirname, '..', '..', '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'repos', 'explorer'
);

describe('Explorer Context Menu', () => {
    let treeNodeSource: string;
    let fileTreeSource: string;
    let explorerPanelSource: string;

    beforeAll(() => {
        treeNodeSource = fs.readFileSync(path.join(EXPLORER_DIR, 'TreeNode.tsx'), 'utf-8');
        fileTreeSource = fs.readFileSync(path.join(EXPLORER_DIR, 'FileTree.tsx'), 'utf-8');
        explorerPanelSource = fs.readFileSync(path.join(EXPLORER_DIR, 'ExplorerPanel.tsx'), 'utf-8');
    });

    describe('TreeNode — onContextMenu prop', () => {
        it('declares onContextMenu in TreeNodeProps', () => {
            expect(treeNodeSource).toContain('onContextMenu?: (e: React.MouseEvent, entry: TreeEntry) => void');
        });

        it('destructures onContextMenu in the component', () => {
            expect(treeNodeSource).toContain('onContextMenu,');
        });

        it('has a handleContextMenu function', () => {
            expect(treeNodeSource).toContain('const handleContextMenu');
        });

        it('prevents default browser context menu', () => {
            expect(treeNodeSource).toContain('e.preventDefault()');
            expect(treeNodeSource).toContain('e.stopPropagation()');
        });

        it('selects the node on right-click', () => {
            const handler = treeNodeSource.slice(
                treeNodeSource.indexOf('const handleContextMenu'),
                treeNodeSource.indexOf('};', treeNodeSource.indexOf('const handleContextMenu')) + 2,
            );
            expect(handler).toContain('onSelect(entry.path, isDir)');
        });

        it('invokes onContextMenu callback with event and entry', () => {
            expect(treeNodeSource).toContain('onContextMenu?.(e, entry)');
        });

        it('attaches onContextMenu to the row div', () => {
            expect(treeNodeSource).toContain('onContextMenu={handleContextMenu}');
        });

        it('passes onContextMenu to recursive child TreeNodes', () => {
            // Count occurrences of onContextMenu={onContextMenu} — should appear in child rendering
            const matches = treeNodeSource.match(/onContextMenu=\{onContextMenu\}/g);
            expect(matches).toBeTruthy();
            expect(matches!.length).toBeGreaterThanOrEqual(1);
        });
    });

    describe('FileTree — onContextMenu prop', () => {
        it('declares onContextMenu in FileTreeProps', () => {
            expect(fileTreeSource).toContain('onContextMenu?: (e: React.MouseEvent, entry: TreeEntry) => void');
        });

        it('destructures onContextMenu in the component', () => {
            expect(fileTreeSource).toContain('onContextMenu,');
        });

        it('passes onContextMenu to TreeNode children', () => {
            expect(fileTreeSource).toContain('onContextMenu={onContextMenu}');
        });
    });

    describe('ExplorerPanel — context menu state & rendering', () => {
        it('imports ContextMenu component', () => {
            expect(explorerPanelSource).toContain("import { ContextMenu");
        });

        it('imports ContextMenuItem type', () => {
            expect(explorerPanelSource).toContain('ContextMenuItem');
        });

        it('manages contextMenu state', () => {
            expect(explorerPanelSource).toContain('contextMenu');
            expect(explorerPanelSource).toContain('setContextMenu');
        });

        it('has handleTreeContextMenu callback', () => {
            expect(explorerPanelSource).toContain('handleTreeContextMenu');
        });

        it('has buildContextMenuItems function', () => {
            expect(explorerPanelSource).toContain('buildContextMenuItems');
        });

        it('passes onContextMenu to FileTree', () => {
            expect(explorerPanelSource).toContain('onContextMenu={handleTreeContextMenu}');
        });

        it('renders ContextMenu when contextMenu state is set', () => {
            expect(explorerPanelSource).toContain('{contextMenu && (');
            expect(explorerPanelSource).toContain('<ContextMenu');
        });

        it('passes position from contextMenu state', () => {
            expect(explorerPanelSource).toContain('position={contextMenu.position}');
        });

        it('passes built items from contextMenu entry', () => {
            expect(explorerPanelSource).toContain('items={buildContextMenuItems(contextMenu.entry)}');
        });

        it('clears contextMenu on close', () => {
            expect(explorerPanelSource).toContain('onClose={() => setContextMenu(null)}');
        });
    });

    describe('context menu items', () => {
        it('includes Open Preview action for files', () => {
            expect(explorerPanelSource).toContain("'Open Preview'");
        });

        it('includes Expand/Collapse action for directories', () => {
            expect(explorerPanelSource).toContain("'Collapse'");
            expect(explorerPanelSource).toContain("'Expand'");
        });

        it('includes Copy Path action', () => {
            expect(explorerPanelSource).toContain("'Copy Path'");
        });

        it('includes Copy Name action', () => {
            expect(explorerPanelSource).toContain("'Copy Name'");
        });

        it('uses navigator.clipboard for copy operations', () => {
            expect(explorerPanelSource).toContain('navigator.clipboard.writeText(entry.path)');
            expect(explorerPanelSource).toContain('navigator.clipboard.writeText(entry.name)');
        });

        it('includes a separator between primary and clipboard actions', () => {
            expect(explorerPanelSource).toContain('separator: true');
        });
    });
});
