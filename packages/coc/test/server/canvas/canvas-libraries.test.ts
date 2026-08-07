/**
 * Canvas library allowlist — id validation, dependency expansion, load order,
 * and vendored-asset URL construction.
 */

import { describe, it, expect } from 'vitest';
import {
    CANVAS_LIBRARIES,
    CANVAS_LIBRARY_IDS,
    CANVAS_VENDOR_PATH,
    canvasLibraryUrl,
    isCanvasLibraryId,
    resolveCanvasLibraries,
} from '../../../src/server/canvas/canvas-libraries';

describe('canvas library allowlist', () => {
    it('recognises exactly the allowlisted ids', () => {
        expect([...CANVAS_LIBRARY_IDS].sort()).toEqual(['papaparse', 'react', 'recharts', 'tailwind']);
        expect(isCanvasLibraryId('recharts')).toBe(true);
        expect(isCanvasLibraryId('d3')).toBe(false);
        expect(isCanvasLibraryId('toString')).toBe(false);
        expect(isCanvasLibraryId(undefined)).toBe(false);
    });

    it('every declared dependency is itself allowlisted', () => {
        for (const id of CANVAS_LIBRARY_IDS) {
            for (const dep of CANVAS_LIBRARIES[id].requires) {
                expect(isCanvasLibraryId(dep)).toBe(true);
            }
        }
    });

    it('treats an absent list as no libraries', () => {
        expect(resolveCanvasLibraries(undefined)).toEqual({ ok: true, libraries: [] });
        expect(resolveCanvasLibraries([])).toEqual({ ok: true, libraries: [] });
    });

    it('pulls in transitive dependencies ahead of their dependents', () => {
        const result = resolveCanvasLibraries(['recharts']);
        expect(result).toEqual({ ok: true, libraries: ['react', 'recharts'] });
    });

    it('puts stylesheets first and de-duplicates while keeping declared order', () => {
        const result = resolveCanvasLibraries(['papaparse', 'recharts', 'tailwind', 'react', 'papaparse']);
        expect(result).toEqual({ ok: true, libraries: ['tailwind', 'papaparse', 'react', 'recharts'] });
    });

    it('rejects an unknown id rather than dropping it silently', () => {
        const result = resolveCanvasLibraries(['react', 'three']);
        expect(result.ok).toBe(false);
        expect(result.ok === false && result.error).toContain('Unknown canvas library "three"');
        // The message lists what IS allowed, so the AI can retry in one turn.
        expect(result.ok === false && result.error).toContain('papaparse');
    });

    it('rejects a non-array', () => {
        const result = resolveCanvasLibraries('recharts' as unknown as string[]);
        expect(result.ok).toBe(false);
    });

    it('builds absolute vendored URLs and tolerates a trailing slash on the base', () => {
        expect(canvasLibraryUrl('react', 'http://127.0.0.1:4000'))
            .toBe(`http://127.0.0.1:4000${CANVAS_VENDOR_PATH}/react.js`);
        expect(canvasLibraryUrl('tailwind', 'http://127.0.0.1:4000/'))
            .toBe(`http://127.0.0.1:4000${CANVAS_VENDOR_PATH}/tailwind.css`);
    });
});
