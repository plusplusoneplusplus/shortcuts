/**
 * Tests for the server-side Excalidraw scene normalizer used on the canvas
 * write path. This module is intentionally pure and dependency-free (it does
 * NOT import `@excalidraw/excalidraw`, which cannot load in Node ≥ 24), so it
 * runs in a plain Node test environment without the `@excalidraw` mock.
 */

import { describe, it, expect } from 'vitest';
import {
    normaliseSceneElements,
    normaliseExcalidrawScene,
} from '../../../src/server/canvas/excalidraw-scene';

describe('normaliseSceneElements', () => {
    it('completes a skeleton element with Excalidraw bookkeeping defaults', () => {
        const [el] = normaliseSceneElements([
            { id: 'box1', type: 'rectangle', x: 0, y: 0, width: 100, height: 40 },
        ]);
        expect(el.id).toBe('box1');
        expect(el.type).toBe('rectangle');
        expect(el.isDeleted).toBe(false);
        expect(el.groupIds).toEqual([]);
        expect(typeof el.version).toBe('number');
        expect(typeof el.versionNonce).toBe('number');
        expect(typeof el.seed).toBe('number');
        expect(el.strokeColor).toBe('#1e1e1e');
        expect(el.opacity).toBe(100);
    });

    it('preserves fields the author already supplied', () => {
        const [el] = normaliseSceneElements([
            { id: 'a', type: 'rectangle', strokeColor: '#ff0000', opacity: 50, version: 7 },
        ]);
        expect(el.strokeColor).toBe('#ff0000');
        expect(el.opacity).toBe(50);
        expect(el.version).toBe(7);
    });

    it('fills text-specific defaults and mirrors originalText', () => {
        const [el] = normaliseSceneElements([{ id: 't', type: 'text', text: 'Hello' }]);
        expect(el.fontSize).toBe(20);
        expect(el.textAlign).toBe('left');
        expect(el.containerId).toBeNull();
        expect(el.originalText).toBe('Hello');
        expect(el.lineHeight).toBe(1.25);
    });

    it('fills arrow-specific defaults including an arrowhead', () => {
        const [el] = normaliseSceneElements([
            { id: 'arr', type: 'arrow', x: 0, y: 0, width: 50, height: 0 },
        ]);
        expect(Array.isArray(el.points)).toBe(true);
        expect(el.endArrowhead).toBe('arrow');
        expect(el.startBinding).toBeNull();
    });

    it('returns an empty array for empty / invalid input', () => {
        expect(normaliseSceneElements([])).toEqual([]);
        expect(normaliseSceneElements(null as any)).toEqual([]);
        expect(normaliseSceneElements(undefined as any)).toEqual([]);
    });

    it('drops non-object entries', () => {
        const out = normaliseSceneElements([{ id: 'a', type: 'rectangle' }, 'nope' as any, 42 as any, null as any]);
        expect(out).toHaveLength(1);
        expect(out[0].id).toBe('a');
    });

    it('is deterministic (no Math.random)', () => {
        const input = [{ id: 'a', type: 'rectangle' }, { id: 'b', type: 'ellipse' }];
        expect(normaliseSceneElements(input)).toEqual(normaliseSceneElements(input));
    });
});

describe('normaliseExcalidrawScene', () => {
    it('parses a JSON string scene and normalizes elements + appState on the way out', () => {
        const raw = JSON.stringify({
            type: 'excalidraw',
            elements: [{ id: 'box', type: 'rectangle', x: 0, y: 0, width: 10, height: 10 }],
            appState: { viewBackgroundColor: '#fafafa' },
        });
        const result = normaliseExcalidrawScene(raw);
        expect(result.ok).toBe(true);
        if (!result.ok) return;

        const parsed = JSON.parse(result.content);
        expect(parsed.type).toBe('excalidraw');
        expect(parsed.appState.viewBackgroundColor).toBe('#fafafa');
        expect(parsed.elements).toHaveLength(1);
        expect(parsed.elements[0].isDeleted).toBe(false);
        expect(typeof parsed.elements[0].versionNonce).toBe('number');
    });

    it('accepts a pre-parsed object scene', () => {
        const result = normaliseExcalidrawScene({ elements: [{ id: 'a', type: 'rectangle' }], appState: {} });
        expect(result.ok).toBe(true);
        if (result.ok) expect(result.scene.elements[0].groupIds).toEqual([]);
    });

    it('defaults a missing appState to an empty object', () => {
        const result = normaliseExcalidrawScene({ elements: [] });
        expect(result.ok).toBe(true);
        if (result.ok) expect(result.scene.appState).toEqual({});
    });

    it('defaults a missing type to "excalidraw"', () => {
        const result = normaliseExcalidrawScene({ elements: [], appState: {} });
        expect(result.ok).toBe(true);
        if (result.ok) expect(result.scene.type).toBe('excalidraw');
    });

    it('rejects invalid JSON', () => {
        const result = normaliseExcalidrawScene('{ not json');
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error).toMatch(/valid scene JSON/i);
    });

    it('rejects a non-object scene (array / primitive)', () => {
        expect(normaliseExcalidrawScene('[]').ok).toBe(false);
        expect(normaliseExcalidrawScene('42').ok).toBe(false);
        expect(normaliseExcalidrawScene('"hi"').ok).toBe(false);
    });

    it('rejects elements that are not an array', () => {
        const result = normaliseExcalidrawScene({ elements: 'nope', appState: {} });
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error).toMatch(/elements.*array/i);
    });

    it('rejects an appState that is not an object', () => {
        const result = normaliseExcalidrawScene({ elements: [], appState: 'nope' });
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error).toMatch(/appState.*object/i);
    });

    it('preserves a passthrough files dictionary', () => {
        const files = { img1: { dataURL: 'data:...', mimeType: 'image/png' } };
        const result = normaliseExcalidrawScene({ elements: [], appState: {}, files });
        expect(result.ok).toBe(true);
        if (result.ok) expect(result.scene.files).toEqual(files);
    });
});
