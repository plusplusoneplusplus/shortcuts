/**
 * Tests for ExplorerPanel Ctrl+O Exact Open integration.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const PANEL_PATH = path.join(
    __dirname, '..', '..', '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'repos', 'explorer', 'ExplorerPanel.tsx'
);

describe('ExplorerPanel — Exact Open (Ctrl+O) integration', () => {
    let panelSource: string;

    beforeAll(() => {
        panelSource = fs.readFileSync(PANEL_PATH, 'utf-8');
    });

    describe('ExactOpen import and rendering', () => {
        it('imports ExactOpen component and TRUSTED_PATH_PREFIX', () => {
            expect(panelSource).toContain("import { ExactOpen, TRUSTED_PATH_PREFIX");
        });

        it('renders ExactOpen component', () => {
            expect(panelSource).toContain('<ExactOpen');
        });

        it('passes workspaceId to ExactOpen', () => {
            // workspaceId={workspaceId} is already present multiple times; confirm ExactOpen uses it
            const idx = panelSource.indexOf('<ExactOpen');
            const snippet = panelSource.slice(idx, idx + 300);
            expect(snippet).toContain('workspaceId={workspaceId}');
        });

        it('passes open state to ExactOpen', () => {
            expect(panelSource).toContain('open={exactOpenVisible}');
        });

        it('passes onClose handler to ExactOpen', () => {
            expect(panelSource).toContain('onClose={() => setExactOpenVisible(false)}');
        });

        it('passes onFileSelect handler to ExactOpen', () => {
            const idx = panelSource.indexOf('<ExactOpen');
            const snippet = panelSource.slice(idx, idx + 400);
            expect(snippet).toContain('onFileSelect={handleQuickOpenSelect}');
        });
    });

    describe('Exact Open state management', () => {
        it('manages exactOpenVisible state', () => {
            expect(panelSource).toContain('exactOpenVisible');
            expect(panelSource).toContain('setExactOpenVisible');
        });

        it('initializes exactOpenVisible to false', () => {
            // Check that useState(false) appears (used for both quickOpenVisible and exactOpenVisible)
            expect(panelSource).toContain('useState(false)');
        });
    });

    describe('Ctrl+O keyboard shortcut', () => {
        it('handles Ctrl+O key combination', () => {
            expect(panelSource).toContain("e.key === 'o'");
        });

        it('checks for ctrlKey modifier', () => {
            expect(panelSource).toContain('e.ctrlKey');
        });

        it('checks for metaKey modifier (macOS Cmd)', () => {
            expect(panelSource).toContain('e.metaKey');
        });

        it('prevents default browser behavior on Ctrl+O', () => {
            expect(panelSource).toContain('e.preventDefault()');
        });

        it('opens ExactOpen on Ctrl+O', () => {
            expect(panelSource).toContain('setExactOpenVisible(true)');
        });
    });

    describe('layout order', () => {
        it('renders ExactOpen after QuickOpen', () => {
            const quickOpenIdx = panelSource.indexOf('<QuickOpen');
            const exactOpenIdx = panelSource.indexOf('<ExactOpen');
            expect(quickOpenIdx).toBeGreaterThan(-1);
            expect(exactOpenIdx).toBeGreaterThan(-1);
            expect(exactOpenIdx).toBeGreaterThan(quickOpenIdx);
        });
    });

    describe('trusted path handling in handleQuickOpenSelect', () => {
        it('detects TRUSTED_PATH_PREFIX in handleQuickOpenSelect', () => {
            expect(panelSource).toContain('filePath.startsWith(TRUSTED_PATH_PREFIX)');
        });

        it('does not expand tree paths for trusted files', () => {
            // The trusted path branch should NOT call setExpandedPaths
            const handler = panelSource.match(/if \(filePath\.startsWith\(TRUSTED_PATH_PREFIX\)\)[\s\S]*?return;\s*\}/);
            expect(handler).toBeTruthy();
            expect(handler![0]).not.toContain('setExpandedPaths');
        });

        it('does not update location hash for trusted files', () => {
            const handler = panelSource.match(/if \(filePath\.startsWith\(TRUSTED_PATH_PREFIX\)\)[\s\S]*?return;\s*\}/);
            expect(handler).toBeTruthy();
            expect(handler![0]).not.toContain('location.hash');
        });

        it('sets selectedPath to null for trusted files', () => {
            const handler = panelSource.match(/if \(filePath\.startsWith\(TRUSTED_PATH_PREFIX\)\)[\s\S]*?return;\s*\}/);
            expect(handler).toBeTruthy();
            expect(handler![0]).toContain('setSelectedPath(null)');
        });

        it('sets previewFile with the full trusted-prefixed path', () => {
            const handler = panelSource.match(/if \(filePath\.startsWith\(TRUSTED_PATH_PREFIX\)\)[\s\S]*?return;\s*\}/);
            expect(handler).toBeTruthy();
            expect(handler![0]).toContain('setPreviewFile');
        });
    });
});
