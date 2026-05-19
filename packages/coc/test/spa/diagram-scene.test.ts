/**
 * Tests for diagram-scene helpers: unwrapDiagramResponse + buildViewerInitialData.
 *
 * Regression: the diagrams REST API returns `{ filename, content: <scene>, sizeBytes, ... }`,
 * but viewers previously fed the wrapper directly to `<Excalidraw />`, so elements/appState
 * were undefined and the canvas crashed with a render-time error.
 */

import { describe, it, expect } from 'vitest';
import {
    unwrapDiagramResponse,
    buildViewerInitialData,
} from '../../src/server/spa/client/react/features/diagrams/diagram-scene';

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
        expect(initial.elements).toBe(scene.elements);
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
});
