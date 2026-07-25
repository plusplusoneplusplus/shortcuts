/**
 * paperPathFromPdfUrl — recover the `.papers/<id>.pdf` cache relpath from a
 * rendered PDF embed URL (Goal 3, AC-04 client half). Only ingested arXiv papers
 * (embedded through the notes image API with a `.papers/` path query) qualify for
 * whole-paper grounding; everything else returns undefined so the toggle hides.
 */

import { describe, expect, it } from 'vitest';
import { paperPathFromPdfUrl }
    from '../../../../src/server/spa/client/react/features/notes/editor/extensions/paperPathFromUrl';

describe('paperPathFromPdfUrl', () => {
    it('recovers the cache relpath from a relative inline notes-image URL', () => {
        const url = '/api/workspaces/ws-1/notes/image?path=' + encodeURIComponent('.papers/1802.05799.pdf');
        expect(paperPathFromPdfUrl(url)).toBe('.papers/1802.05799.pdf');
    });

    it('recovers the relpath from an absolute (full-window) href with a root param', () => {
        const url = 'http://localhost:3000/api/workspaces/ws-1/notes/image?path='
            + encodeURIComponent('.papers/2401.00001.pdf') + '&root=r1';
        expect(paperPathFromPdfUrl(url)).toBe('.papers/2401.00001.pdf');
    });

    it('recovers an old-style arXiv id filename (slash replaced at ingest)', () => {
        const url = '/api/workspaces/ws-1/notes/image?path=' + encodeURIComponent('.papers/hep-th_9901001.pdf');
        expect(paperPathFromPdfUrl(url)).toBe('.papers/hep-th_9901001.pdf');
    });

    it('returns undefined for an uploaded attachment PDF (not in the papers cache)', () => {
        const url = '/api/workspaces/ws-1/notes/image?path=' + encodeURIComponent('.attachments/paper.pdf');
        expect(paperPathFromPdfUrl(url)).toBeUndefined();
    });

    it('returns undefined for an external hotlinked PDF (no path query)', () => {
        expect(paperPathFromPdfUrl('https://arxiv.org/pdf/1802.05799')).toBeUndefined();
    });

    it('returns undefined for a non-pdf path query', () => {
        const url = '/api/workspaces/ws-1/notes/image?path=' + encodeURIComponent('.papers/1802.05799.txt');
        expect(paperPathFromPdfUrl(url)).toBeUndefined();
    });

    it('rejects traversal / nested paths under the cache prefix', () => {
        const nested = '/img?path=' + encodeURIComponent('.papers/sub/1802.05799.pdf');
        const escape = '/img?path=' + encodeURIComponent('.papers/../secrets.pdf');
        expect(paperPathFromPdfUrl(nested)).toBeUndefined();
        expect(paperPathFromPdfUrl(escape)).toBeUndefined();
    });

    it('returns undefined for empty / nullish / unparsable input', () => {
        expect(paperPathFromPdfUrl(undefined)).toBeUndefined();
        expect(paperPathFromPdfUrl(null)).toBeUndefined();
        expect(paperPathFromPdfUrl('')).toBeUndefined();
    });
});
