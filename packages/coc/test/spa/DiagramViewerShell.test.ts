/**
 * Tests for DiagramViewerShell — URL parsing and component structure.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { parseDiagramViewerRoute } from '../../src/server/spa/client/react/features/diagrams/DiagramViewerShell';

// ── parseDiagramViewerRoute ────────────────────────────────────────────────────

describe('parseDiagramViewerRoute', () => {
    it('parses a valid /diagram/<wsId>/<canvasId> route', () => {
        const result = parseDiagramViewerRoute('/diagram/ws-abc123/architecture');
        expect(result).toEqual({
            workspaceId: 'ws-abc123',
            canvasId: 'architecture',
        });
    });

    it('decodes URL-encoded components', () => {
        const result = parseDiagramViewerRoute('/diagram/ws%2Dabc/my%2Dcanvas');
        expect(result).toEqual({
            workspaceId: 'ws-abc',
            canvasId: 'my-canvas',
        });
    });

    it('returns null for root path', () => {
        expect(parseDiagramViewerRoute('/')).toBeNull();
    });

    it('returns null for missing canvasId segment', () => {
        expect(parseDiagramViewerRoute('/diagram/ws-abc')).toBeNull();
    });

    it('returns null for bare /diagram/ with no segments', () => {
        expect(parseDiagramViewerRoute('/diagram/')).toBeNull();
    });

    it('returns null for unrelated path', () => {
        expect(parseDiagramViewerRoute('/api/workspaces')).toBeNull();
    });

    // Filename addressing was dropped in the canvas cutover — canvas IDs are
    // single-segment slugs, so a nested filename-style path no longer matches.
    it('returns null for a nested filename-style path', () => {
        expect(parseDiagramViewerRoute('/diagram/ws-123/subdir/file.excalidraw')).toBeNull();
    });

    it('parses a slug canvasId', () => {
        const result = parseDiagramViewerRoute('/diagram/ws-x/my-diagram');
        expect(result).toEqual({
            workspaceId: 'ws-x',
            canvasId: 'my-diagram',
        });
    });
});

// ── Source-level checks (entry.tsx wiring) ──────────────────────────────────────

describe('client entry point: diagram viewer route', () => {
    let source: string;

    it('imports DiagramViewerShell', () => {
        source = fs.readFileSync(
            path.join(__dirname, '..', '..', 'src', 'server', 'spa', 'client', 'entry.tsx'),
            'utf-8',
        );
        expect(source).toContain("import { DiagramViewerShell }");
    });

    it('detects /diagram/ pathname', () => {
        source = fs.readFileSync(
            path.join(__dirname, '..', '..', 'src', 'server', 'spa', 'client', 'entry.tsx'),
            'utf-8',
        );
        expect(source).toContain("'/diagram/'");
    });

    it('renders DiagramViewerShell for diagram routes', () => {
        source = fs.readFileSync(
            path.join(__dirname, '..', '..', 'src', 'server', 'spa', 'client', 'entry.tsx'),
            'utf-8',
        );
        expect(source).toContain('<DiagramViewerShell />');
    });

    it('checks diagram pathname before hash-based routes', () => {
        source = fs.readFileSync(
            path.join(__dirname, '..', '..', 'src', 'server', 'spa', 'client', 'entry.tsx'),
            'utf-8',
        );
        const diagramIdx = source.indexOf("startsWith('/diagram/')");
        const popoutIdx = source.indexOf("startsWith('#popout/activity/')");
        expect(diagramIdx).toBeGreaterThan(-1);
        expect(popoutIdx).toBeGreaterThan(-1);
        expect(diagramIdx).toBeLessThan(popoutIdx);
    });

    // Regression: Excalidraw ships its renderer CSS as a separate package entry.
    // Without importing it the canvas renders blank (the React component still
    // mounts its UI chrome — back button, menu, zoom indicator — but the
    // <canvas> elements lack their positioning/sizing styles). Keep this
    // import wired at the SPA entry so any route that surfaces a diagram
    // viewer or preview gets the styles.
    it('imports @excalidraw/excalidraw/index.css so the canvas can render', () => {
        source = fs.readFileSync(
            path.join(__dirname, '..', '..', 'src', 'server', 'spa', 'client', 'entry.tsx'),
            'utf-8',
        );
        expect(source).toContain("import '@excalidraw/excalidraw/index.css'");
    });
});

// ── DiagramViewerShell source structure ─────────────────────────────────────────

describe('DiagramViewerShell component source', () => {
    let source: string;

    it('uses view-only Excalidraw with expected props', () => {
        source = fs.readFileSync(
            path.join(
                __dirname, '..', '..', 'src', 'server', 'spa', 'client', 'react',
                'features', 'diagrams', 'DiagramViewerShell.tsx',
            ),
            'utf-8',
        );
        expect(source).toContain('viewModeEnabled={true}');
        expect(source).toContain('zenModeEnabled={true}');
    });

    it('has data-testid attributes for key elements', () => {
        source = fs.readFileSync(
            path.join(
                __dirname, '..', '..', 'src', 'server', 'spa', 'client', 'react',
                'features', 'diagrams', 'DiagramViewerShell.tsx',
            ),
            'utf-8',
        );
        expect(source).toContain('data-testid="diagram-viewer-shell"');
        expect(source).toContain('data-testid="diagram-viewer-back"');
        expect(source).toContain('data-testid="diagram-viewer-title"');
        expect(source).toContain('data-testid="diagram-viewer-canvas"');
    });

    it('checks both compile-time and runtime feature flags', () => {
        source = fs.readFileSync(
            path.join(
                __dirname, '..', '..', 'src', 'server', 'spa', 'client', 'react',
                'features', 'diagrams', 'DiagramViewerShell.tsx',
            ),
            'utf-8',
        );
        expect(source).toContain('SHOW_EXCALIDRAW_DIAGRAMS');
        expect(source).toContain('isExcalidrawEnabled');
    });

    it('shows "Page not found" when feature flag is off', () => {
        source = fs.readFileSync(
            path.join(
                __dirname, '..', '..', 'src', 'server', 'spa', 'client', 'react',
                'features', 'diagrams', 'DiagramViewerShell.tsx',
            ),
            'utf-8',
        );
        expect(source).toContain('Page not found.');
    });

    it('shows "Diagram not found" error for 404 response', () => {
        source = fs.readFileSync(
            path.join(
                __dirname, '..', '..', 'src', 'server', 'spa', 'client', 'react',
                'features', 'diagrams', 'DiagramViewerShell.tsx',
            ),
            'utf-8',
        );
        expect(source).toContain('Diagram not found');
    });

    it('has back button with history navigation', () => {
        source = fs.readFileSync(
            path.join(
                __dirname, '..', '..', 'src', 'server', 'spa', 'client', 'react',
                'features', 'diagrams', 'DiagramViewerShell.tsx',
            ),
            'utf-8',
        );
        expect(source).toContain('window.history.back()');
        expect(source).toContain("window.location.href = '/'");
    });

    it('disables all canvas editing actions', () => {
        source = fs.readFileSync(
            path.join(
                __dirname, '..', '..', 'src', 'server', 'spa', 'client', 'react',
                'features', 'diagrams', 'DiagramViewerShell.tsx',
            ),
            'utf-8',
        );
        expect(source).toContain('clearCanvas: false');
        expect(source).toContain('export: false');
        expect(source).toContain('loadScene: false');
        expect(source).toContain('saveToActiveFile: false');
        expect(source).toContain('saveAsImage: false');
    });
});

// ── Canvas-store repoint regression ──────────────────────────────────────────────
//
// Excalidraw diagrams became canvases in the cutover and the `/api/diagrams`
// endpoint was removed. The standalone viewer must read the scene from the
// canvas store, not the dead diagrams endpoint — these assertions guard against
// a regression back to the removed endpoint or the old filename addressing.
describe('DiagramViewerShell canvas-store repoint', () => {
    function readSource(): string {
        return fs.readFileSync(
            path.join(
                __dirname, '..', '..', 'src', 'server', 'spa', 'client', 'react',
                'features', 'diagrams', 'DiagramViewerShell.tsx',
            ),
            'utf-8',
        );
    }

    it('fetches the canvas-store endpoint, not the removed /api/diagrams route', () => {
        const source = readSource();
        expect(source).toContain('/canvases/');
        expect(source).not.toContain('/diagrams/');
    });

    it('parses the scene from canvas.content via parseSceneContent', () => {
        const source = readSource();
        expect(source).toContain('parseSceneContent');
        expect(source).toContain('canvas?.content');
        // The legacy /api/diagrams response unwrapper is gone post-repoint.
        expect(source).not.toContain('unwrapDiagramResponse');
    });

    it('keys the viewer on a canvasId, not a filename path', () => {
        const source = readSource();
        expect(source).toContain('canvasId: string');
        expect(source).not.toContain('diagramPath');
    });

    it('shows the viewer whenever the canvas or excalidraw feature is enabled', () => {
        const source = readSource();
        expect(source).toContain('isCanvasEnabled');
        expect(source).toContain('isExcalidrawEnabled');
    });
});
