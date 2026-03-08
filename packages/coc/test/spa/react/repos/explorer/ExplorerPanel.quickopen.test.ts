/**
 * Tests for ExplorerPanel Ctrl+P Quick Open integration.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const PANEL_PATH = path.join(
    __dirname, '..', '..', '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'repos', 'explorer', 'ExplorerPanel.tsx'
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
        it('handles Ctrl+P key combination', () => {
            expect(panelSource).toContain("e.key === 'p'");
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

        it('opens preview pane for selected file', () => {
            expect(panelSource).toContain('setPreviewFile({ path: filePath, name }');
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
