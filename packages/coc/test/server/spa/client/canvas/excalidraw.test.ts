/**
 * @vitest-environment jsdom
 *
 * Layer D — excalidraw rasterization tests (jsdom for XMLSerializer / real
 * SVGSVGElement serialization; the `exportToSvg` renderer is an injected mock).
 *
 * `excalidrawToInlineSvg` is deliberately free of any `@excalidraw/excalidraw`
 * import (that package cannot load under Node ≥ 24), so these tests exercise it
 * with a plain mock and never touch the real renderer. Covers: scene JSON → inline
 * `<svg>`; embedded scene `files` passed through so the exporter can inline them;
 * the API-wrapper (`{ content: … }`) scene shape; empty / malformed scene →
 * placeholder without calling the exporter; render throw / empty-SVG → placeholder
 * + warning (no crash); serialization of both a real SVGSVGElement and an
 * `{ outerHTML }` stub; and byte-deterministic output.
 */

import { describe, it, expect, vi } from 'vitest';
import {
    excalidrawToInlineSvg,
    type ExcalidrawExportToSvgFn,
} from '../../../../../src/server/spa/client/react/features/canvas/html-export/excalidraw';

/** A single rectangle scene, the shape excalidraw canvases persist (server-normalized). */
function rectScene(extra: Record<string, unknown> = {}): string {
    return JSON.stringify({
        elements: [{ id: 'r1', type: 'rectangle', x: 0, y: 0, width: 100, height: 50 }],
        appState: { viewBackgroundColor: '#fafafa' },
        ...extra,
    });
}

/** A mock `exportToSvg` returning a stub element with a fixed `outerHTML`. */
const stubExport: ExcalidrawExportToSvgFn = () => ({
    outerHTML: '<svg xmlns="http://www.w3.org/2000/svg"><rect width="100" height="50"/></svg>',
});

describe('excalidrawToInlineSvg', () => {
    it('renders a scene to an inline <svg> string with no warnings', async () => {
        const result = await excalidrawToInlineSvg(rectScene(), stubExport);
        expect(result.svg).toContain('<svg');
        expect(result.svg).toContain('</svg>');
        expect(result.warnings).toEqual([]);
    });

    it('passes elements and appState (with a background) to the injected exporter', async () => {
        const spy = vi.fn(stubExport);
        await excalidrawToInlineSvg(rectScene(), spy);
        expect(spy).toHaveBeenCalledTimes(1);
        const input = spy.mock.calls[0][0];
        expect(input.elements).toHaveLength(1);
        expect((input.elements[0] as any).id).toBe('r1');
        expect(input.appState).toMatchObject({
            exportBackground: true,
            viewBackgroundColor: '#fafafa',
        });
    });

    it('falls back to a white background when the scene omits one', async () => {
        const spy = vi.fn(stubExport);
        const scene = JSON.stringify({
            elements: [{ id: 'r1', type: 'rectangle', x: 0, y: 0, width: 10, height: 10 }],
        });
        await excalidrawToInlineSvg(scene, spy);
        expect(spy.mock.calls[0][0].appState).toMatchObject({ viewBackgroundColor: '#ffffff' });
    });

    it('passes embedded scene `files` through so the exporter inlines them as data URIs', async () => {
        const dataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANS';
        const scene = rectScene({
            files: { f1: { id: 'f1', mimeType: 'image/png', dataURL: dataUrl } },
        });
        // Simulate excalidraw embedding the file's dataURL into the exported <svg>.
        const inliningExport: ExcalidrawExportToSvgFn = (input) => ({
            outerHTML: `<svg xmlns="http://www.w3.org/2000/svg"><image href="${
                input.files?.f1?.dataURL ?? ''
            }"/></svg>`,
        });
        const result = await excalidrawToInlineSvg(scene, inliningExport);
        expect(result.svg).toContain(dataUrl);
        expect(result.warnings).toEqual([]);
    });

    it('unwraps an API-style `{ content: scene }` wrapper', async () => {
        const spy = vi.fn(stubExport);
        const wrapped = JSON.stringify({
            content: {
                elements: [{ id: 'w1', type: 'ellipse', x: 0, y: 0, width: 20, height: 20 }],
                appState: {},
            },
            sizeBytes: 123,
        });
        await excalidrawToInlineSvg(wrapped, spy);
        expect(spy).toHaveBeenCalledTimes(1);
        expect((spy.mock.calls[0][0].elements[0] as any).id).toBe('w1');
    });

    it('serializes a real SVGSVGElement via XMLSerializer', async () => {
        const realExport: ExcalidrawExportToSvgFn = () => {
            const el = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            el.setAttribute('data-marker', 'from-dom');
            return el as unknown as SVGSVGElement;
        };
        const result = await excalidrawToInlineSvg(rectScene(), realExport);
        expect(result.svg).toContain('<svg');
        expect(result.svg).toContain('data-marker="from-dom"');
        expect(result.warnings).toEqual([]);
    });

    it('accepts a plain SVG string return', async () => {
        const stringExport: ExcalidrawExportToSvgFn = () => '<svg xmlns="http://www.w3.org/2000/svg"/>';
        const result = await excalidrawToInlineSvg(rectScene(), stringExport);
        expect(result.svg).toBe('<svg xmlns="http://www.w3.org/2000/svg"/>');
        expect(result.warnings).toEqual([]);
    });

    it('returns a placeholder + warning for an empty scene without calling the exporter', async () => {
        const spy = vi.fn(stubExport);
        const result = await excalidrawToInlineSvg(JSON.stringify({ elements: [] }), spy);
        expect(spy).not.toHaveBeenCalled();
        expect(result.svg).toContain('canvas-export__placeholder');
        expect(result.svg).not.toContain('<svg');
        expect(result.warnings).toHaveLength(1);
        expect(result.warnings[0]).toMatch(/empty or invalid/i);
    });

    it('returns a placeholder for malformed JSON without calling the exporter', async () => {
        const spy = vi.fn(stubExport);
        const result = await excalidrawToInlineSvg('{ not valid json', spy);
        expect(spy).not.toHaveBeenCalled();
        expect(result.svg).toContain('canvas-export__placeholder');
        expect(result.warnings).toHaveLength(1);
    });

    it('returns a placeholder for an empty string', async () => {
        const spy = vi.fn(stubExport);
        const result = await excalidrawToInlineSvg('', spy);
        expect(spy).not.toHaveBeenCalled();
        expect(result.svg).toContain('canvas-export__placeholder');
    });

    it('degrades to a placeholder + warning when the exporter throws (no crash)', async () => {
        const throwingExport: ExcalidrawExportToSvgFn = () => {
            throw new Error('canvas boom');
        };
        const result = await excalidrawToInlineSvg(rectScene(), throwingExport);
        expect(result.svg).toContain('canvas-export__placeholder');
        expect(result.warnings).toHaveLength(1);
        expect(result.warnings[0]).toMatch(/canvas boom/);
    });

    it('degrades to a placeholder + warning when the exporter yields no SVG', async () => {
        const emptyExport: ExcalidrawExportToSvgFn = () => ({ outerHTML: '   ' });
        const result = await excalidrawToInlineSvg(rectScene(), emptyExport);
        expect(result.svg).toContain('canvas-export__placeholder');
        expect(result.warnings).toHaveLength(1);
        expect(result.warnings[0]).toMatch(/no SVG/i);
    });

    it('awaits an async exporter', async () => {
        const asyncExport: ExcalidrawExportToSvgFn = async () => ({
            outerHTML: '<svg xmlns="http://www.w3.org/2000/svg" data-async="1"/>',
        });
        const result = await excalidrawToInlineSvg(rectScene(), asyncExport);
        expect(result.svg).toContain('data-async="1"');
    });

    it('produces byte-identical output for the same input (deterministic)', async () => {
        const a = await excalidrawToInlineSvg(rectScene(), stubExport);
        const b = await excalidrawToInlineSvg(rectScene(), stubExport);
        expect(a.svg).toBe(b.svg);
        expect(a.warnings).toEqual(b.warnings);
    });

    it('placeholder output is self-contained (no external refs, no data URI)', async () => {
        const result = await excalidrawToInlineSvg('', stubExport);
        expect(result.svg).not.toMatch(/https?:\/\//);
        expect(result.svg).not.toContain('/api/');
        expect(result.svg).not.toContain('data:');
    });
});
