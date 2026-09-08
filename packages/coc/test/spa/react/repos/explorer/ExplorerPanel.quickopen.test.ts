/**
 * Tests for ExplorerPanel Ctrl+P Quick Open integration.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const PANEL_PATH = path.join(
    __dirname, '..', '..', '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'features', 'repo-detail', 'explorer', 'ExplorerPanel.tsx'
);

describe('ExplorerPanel — Quick Open (Ctrl+P) integration', () => {
    let panelSource: string;

    beforeAll(() => {
        panelSource = fs.readFileSync(PANEL_PATH, 'utf-8');
    });

    describe('QuickOpen import and rendering', () => {
        it('imports QuickOpen component', () => {
            expect(panelSource).toContain("import { QuickOpen } from './QuickOpen'");
        });

        it('renders QuickOpen component', () => {
            expect(panelSource).toContain('<QuickOpen');
        });

        it('passes workspaceId to QuickOpen', () => {
            expect(panelSource).toContain('workspaceId={workspaceId}');
        });

        it('passes open state to QuickOpen', () => {
            expect(panelSource).toContain('open={quickOpenVisible}');
        });

        it('passes onClose handler to QuickOpen', () => {
            expect(panelSource).toContain('onClose={() => setQuickOpenVisible(false)}');
        });

        it('passes onFileSelect handler to QuickOpen', () => {
            expect(panelSource).toContain('onFileSelect={handleQuickOpenSelect}');
        });
    });

    describe('Quick Open state management', () => {
        it('manages quickOpenVisible state', () => {
            expect(panelSource).toContain('quickOpenVisible');
            expect(panelSource).toContain('setQuickOpenVisible');
        });

        it('initializes quickOpenVisible to false', () => {
            expect(panelSource).toContain('useState(false)');
        });
    });

    describe('Ctrl+P keyboard shortcut', () => {
        // The key literals moved into `quickOpenRouting.quickOpenShortcut` when
        // the unified right panel became a second owner of Ctrl+P: matching the
        // keys in two places is how the two owners drifted apart. What this
        // panel must still do is ask the router which shortcut was pressed.
        it('delegates key matching to the shared router', () => {
            expect(panelSource).toContain("from '../unified-right-panel/quickOpenRouting'");
            expect(panelSource).toContain('quickOpenShortcut(e)');
        });

        // The regression: a navigator/sidebar mount is somebody else's file-tree
        // column, and its host owns Ctrl+P on its behalf. While these mounts also
        // registered a document listener, one keypress opened two dialogs.
        it('takes the shortcut only in editor mode', () => {
            expect(panelSource).toContain('navigatorMode ? null : quickOpenShortcut(e)');
        });

        // And the other half of the routing input: only the Explorer sub-tab
        // announces itself, so the panel can tell "a real Explorer tab is
        // mounted" from "my own column is open".
        it('registers its focus probe with the router', () => {
            expect(panelSource).toContain('registerExplorerQuickOpen(');
            expect(panelSource).toMatch(/if \(navigatorMode\) return;\s*\n\s*return registerExplorerQuickOpen/);
        });

        it('checks for ctrlKey modifier', () => {
            expect(panelSource).toContain('e.ctrlKey');
        });

        it('checks for metaKey modifier (macOS Cmd)', () => {
            expect(panelSource).toContain('e.metaKey');
        });

        it('prevents default browser behavior on Ctrl+P', () => {
            expect(panelSource).toContain('e.preventDefault()');
        });

        it('opens QuickOpen on Ctrl+P', () => {
            expect(panelSource).toContain('setQuickOpenVisible(true)');
        });
    });

    describe('file selection handler', () => {
        it('defines handleQuickOpenSelect callback', () => {
            expect(panelSource).toContain('handleQuickOpenSelect');
        });

        it('sets selected path on file select', () => {
            expect(panelSource).toContain('setSelectedPath(filePath)');
        });

        it('opens the selected file as a preview', () => {
            expect(panelSource).toContain('openFileInEditor({ path: filePath, name }, { preview: true })');
        });

        it('expands ancestor directories', () => {
            expect(panelSource).toContain('setExpandedPaths');
            expect(panelSource).toContain("filePath.split('/')");
        });

        it('updates URL hash for deep linking', () => {
            expect(panelSource).toContain('location.hash');
        });
    });

    describe('layout order', () => {
        it('renders QuickOpen after ContextMenu', () => {
            const contextMenuIdx = panelSource.indexOf('<ContextMenu');
            const quickOpenIdx = panelSource.indexOf('<QuickOpen');
            expect(contextMenuIdx).toBeGreaterThan(-1);
            expect(quickOpenIdx).toBeGreaterThan(-1);
            expect(quickOpenIdx).toBeGreaterThan(contextMenuIdx);
        });
    });
});
