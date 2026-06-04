/**
 * Tests for diagram-scene helpers: unwrapDiagramResponse + buildViewerInitialData.
 *
 * Regression: the diagrams REST API returns `{ filename, content: <scene>, sizeBytes, ... }`,
 * but viewers previously fed the wrapper directly to `<Excalidraw />`, so elements/appState
 * were undefined and the canvas crashed with a render-time error.
 */

import { describe, it, expect, vi } from 'vitest';
import {
    unwrapDiagramResponse,
    buildViewerInitialData,
    normaliseSceneElements,
} from '../../src/server/spa/client/react/features/diagrams/diagram-scene';
import * as ExcalidrawMod from '@excalidraw/excalidraw';

const SAMPLE_SCENE = {
    type: 'excalidraw',
    version: 2,
    elements: [{ id: 'a', type: 'rectangle' }],
    appState: { viewBackgroundColor: '#fafafa', gridSize: null },
};

describe('unwrapDiagramResponse', () => {
    it('unwraps the API wrapper { filename, content, sizeBytes }', () => {
        const apiResponse = {
            filename: 'simple.excalidraw',
            content: SAMPLE_SCENE,
            sizeBytes: 1234,
            createdAt: '2020-01-01T00:00:00.000Z',
            updatedAt: '2020-01-02T00:00:00.000Z',
        };
        const scene = unwrapDiagramResponse(apiResponse);
        expect(scene.elements).toEqual([{ id: 'a', type: 'rectangle' }]);
        expect(scene.appState).toEqual({ viewBackgroundColor: '#fafafa', gridSize: null });
    });

    it('accepts a raw scene without a content wrapper', () => {
        const scene = unwrapDiagramResponse(SAMPLE_SCENE);
        expect(scene.elements).toHaveLength(1);
        expect(scene.appState.viewBackgroundColor).toBe('#fafafa');
    });

    it('returns empty scene for null / non-object input', () => {
        expect(unwrapDiagramResponse(null)).toEqual({ elements: [], appState: {} });
        expect(unwrapDiagramResponse(undefined)).toEqual({ elements: [], appState: {} });
        expect(unwrapDiagramResponse('not an object' as any)).toEqual({ elements: [], appState: {} });
    });

    it('coerces missing elements/appState to safe defaults', () => {
        expect(unwrapDiagramResponse({ content: {} })).toEqual({ elements: [], appState: {} });
        expect(unwrapDiagramResponse({ content: { elements: 'not-an-array' } }).elements).toEqual([]);
        expect(unwrapDiagramResponse({ content: { appState: 'not-an-object' } }).appState).toEqual({});
    });

    it('passes through optional files dictionary', () => {
        const files = { 'img1': { dataURL: 'data:...', mimeType: 'image/png' } };
        const scene = unwrapDiagramResponse({ content: { ...SAMPLE_SCENE, files } });
        expect(scene.files).toEqual(files);
    });

    it('omits files when not an object', () => {
        const scene = unwrapDiagramResponse({ content: { ...SAMPLE_SCENE, files: 'oops' } });
        expect(scene.files).toBeUndefined();
    });
});

describe('buildViewerInitialData', () => {
    it('forces view-mode flags and provides a collaborators Map', () => {
        const scene = unwrapDiagramResponse({ content: SAMPLE_SCENE });
        const initial = buildViewerInitialData(scene);
        // Elements pass through `restoreElements` (stubbed to identity in test setup)
        // so they should remain equal by value even though they may be a new array.
        expect(initial.elements).toEqual(scene.elements);
        expect(initial.appState.viewModeEnabled).toBe(true);
        expect(initial.appState.zenModeEnabled).toBe(true);
        expect(initial.appState.gridModeEnabled).toBe(false);
        expect(initial.appState.collaborators).toBeInstanceOf(Map);
        expect((initial.appState.collaborators as Map<any, any>).size).toBe(0);
    });

    it('preserves caller-provided appState fields except overridden view flags', () => {
        const scene = unwrapDiagramResponse({
            content: { ...SAMPLE_SCENE, appState: { viewBackgroundColor: '#000', theme: 'dark' } },
        });
        const initial = buildViewerInitialData(scene);
        expect(initial.appState.viewBackgroundColor).toBe('#000');
        expect(initial.appState.theme).toBe('dark');
        expect(initial.appState.viewModeEnabled).toBe(true);
    });

    it('survives an empty scene (regression for sad-face render crash)', () => {
        const empty = unwrapDiagramResponse(null);
        const initial = buildViewerInitialData(empty);
        expect(initial.elements).toEqual([]);
        expect(initial.appState.collaborators).toBeInstanceOf(Map);
        expect(initial.appState.viewModeEnabled).toBe(true);
        expect(initial.files).toBeUndefined();
    });

    it('runs scene elements through Excalidraw normalisers so LLM-skeleton diagrams render', () => {
        // Regression: LLM-generated diagrams omit Excalidraw's bookkeeping fields
        // (`version`, `versionNonce`, `groupIds`, `isDeleted`, fractional `index`, ...).
        // The viewer must pipe them through `convertToExcalidrawElements` +
        // `restoreElements` or the canvas renders blank.
        const convertSpy = vi.spyOn(ExcalidrawMod, 'convertToExcalidrawElements');
        const restoreSpy = vi.spyOn(ExcalidrawMod, 'restoreElements');
        try {
            const scene = unwrapDiagramResponse({
                content: {
                    elements: [{ id: 'box1', type: 'rectangle', x: 0, y: 0, width: 10, height: 10 }],
                    appState: {},
                },
            });
            buildViewerInitialData(scene);
            expect(convertSpy).toHaveBeenCalledTimes(1);
            expect(convertSpy).toHaveBeenCalledWith(
                scene.elements,
                expect.objectContaining({ regenerateIds: false }),
            );
            expect(restoreSpy).toHaveBeenCalledTimes(1);
            expect(restoreSpy).toHaveBeenCalledWith(
                scene.elements,
                null,
                expect.objectContaining({ repairBindings: true, refreshDimensions: true }),
            );
        } finally {
            convertSpy.mockRestore();
            restoreSpy.mockRestore();
        }
    });
});

describe('normaliseSceneElements', () => {
    it('delegates to convertToExcalidrawElements (regenerateIds=false) then restoreElements (repairBindings=true, refreshDimensions=true)', () => {
        const convertSpy = vi.spyOn(ExcalidrawMod, 'convertToExcalidrawElements');
        const restoreSpy = vi.spyOn(ExcalidrawMod, 'restoreElements');
        try {
            const input = [{ id: 'a', type: 'rectangle' }];
            const out = normaliseSceneElements(input);
            expect(convertSpy).toHaveBeenCalledWith(input, expect.objectContaining({ regenerateIds: false }));
            expect(restoreSpy).toHaveBeenCalledWith(input, null, expect.objectContaining({ repairBindings: true, refreshDimensions: true }));
            // With the identity mocks from test/setup.ts, output mirrors input by value.
            expect(out).toEqual(input);
        } finally {
            convertSpy.mockRestore();
            restoreSpy.mockRestore();
        }
    });

    it('returns an empty array for empty/invalid input without calling Excalidraw helpers', () => {
        const convertSpy = vi.spyOn(ExcalidrawMod, 'convertToExcalidrawElements');
        const restoreSpy = vi.spyOn(ExcalidrawMod, 'restoreElements');
        try {
            expect(normaliseSceneElements([])).toEqual([]);
            expect(normaliseSceneElements(null as any)).toEqual([]);
            expect(convertSpy).not.toHaveBeenCalled();
            expect(restoreSpy).not.toHaveBeenCalled();
        } finally {
            convertSpy.mockRestore();
            restoreSpy.mockRestore();
        }
    });

    it('falls back gracefully when both normalisers throw', () => {
        const convertSpy = vi.spyOn(ExcalidrawMod, 'convertToExcalidrawElements').mockImplementation(() => {
            throw new Error('boom-convert');
        });
        const restoreSpy = vi.spyOn(ExcalidrawMod, 'restoreElements').mockImplementation(() => {
            throw new Error('boom-restore');
        });
        try {
            const input = [{ id: 'a', type: 'rectangle' }];
            const out = normaliseSceneElements(input);
            expect(out).toEqual(input);
        } finally {
            convertSpy.mockRestore();
            restoreSpy.mockRestore();
        }
    });

    it('recenters bound text elements within their container rectangles', () => {
        const container = {
            id: 'box1', type: 'rectangle',
            x: 100, y: 200, width: 200, height: 80,
        };
        const text = {
            id: 'txt1', type: 'text',
            x: 110, y: 220, width: 160, height: 22,
            containerId: 'box1', textAlign: 'center', verticalAlign: 'middle',
            text: 'Hello', originalText: 'Hello',
        };
        const result = normaliseSceneElements([container, text]);
        const recentered = result.find((e: any) => e.id === 'txt1');
        expect(recentered.x).toBe(100 + (200 - 160) / 2); // 120
        expect(recentered.y).toBe(200 + (80 - 22) / 2);   // 229
    });

    it('does not modify unbound text elements', () => {
        const freeText = {
            id: 'lbl1', type: 'text',
            x: 50, y: 75, width: 60, height: 18,
            containerId: null, textAlign: 'center', verticalAlign: 'top',
            text: 'uses', originalText: 'uses',
        };
        const result = normaliseSceneElements([freeText]);
        const out = result.find((e: any) => e.id === 'lbl1');
        expect(out.x).toBe(50);
        expect(out.y).toBe(75);
    });

    it('handles text whose container is missing gracefully', () => {
        const orphanText = {
            id: 'txt-orphan', type: 'text',
            x: 30, y: 40, width: 100, height: 20,
            containerId: 'nonexistent',
            text: 'Orphan', originalText: 'Orphan',
        };
        const result = normaliseSceneElements([orphanText]);
        const out = result.find((e: any) => e.id === 'txt-orphan');
        expect(out.x).toBe(30);
        expect(out.y).toBe(40);
    });

    it('recenters multiple bound texts across different containers', () => {
        const elements = [
            { id: 'box-a', type: 'rectangle', x: 0, y: 0, width: 120, height: 70 },
            { id: 'txt-a', type: 'text', x: 5, y: 10, width: 80, height: 22, containerId: 'box-a', text: 'A' },
            { id: 'box-b', type: 'rectangle', x: 300, y: 0, width: 220, height: 70 },
            { id: 'txt-b', type: 'text', x: 305, y: 10, width: 180, height: 22, containerId: 'box-b', text: 'B' },
        ];
        const result = normaliseSceneElements(elements);
        const txtA = result.find((e: any) => e.id === 'txt-a');
        const txtB = result.find((e: any) => e.id === 'txt-b');
        expect(txtA.x).toBe((120 - 80) / 2);   // 20
        expect(txtA.y).toBe((70 - 22) / 2);     // 24
        expect(txtB.x).toBe(300 + (220 - 180) / 2); // 320
        expect(txtB.y).toBe((70 - 22) / 2);         // 24
    });

    it('does not mutate text that is already perfectly centered', () => {
        const container = { id: 'box', type: 'rectangle', x: 100, y: 100, width: 200, height: 60 };
        const text = {
            id: 'txt', type: 'text',
            x: 100 + (200 - 150) / 2, y: 100 + (60 - 20) / 2,
            width: 150, height: 20,
            containerId: 'box', text: 'OK',
        };
        const result = normaliseSceneElements([container, text]);
        const out = result.find((e: any) => e.id === 'txt');
        expect(out).toBe(text);
    });
});
