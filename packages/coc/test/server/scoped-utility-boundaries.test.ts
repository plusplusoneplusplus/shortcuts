import { describe, expect, it } from 'vitest';
import * as path from 'path';
import { getRepoDataPath } from '../../src/server/paths';
import { clampIntegerLimit } from '../../src/server/core/limit-utils';
import { isImageDataUrl as serverImageDataUrl } from '../../src/server/core/image-utils';
import { isDisplayImageDataUrl } from '../../src/server/core/image-data-url';
import { isImageDataUrl as renderedImageDataUrl } from '../../src/server/spa/client/react/features/chat/conversation/tool-calls/toolCallRenderModel';
import { getNotesRoot } from '../../src/server/notes/notes-paths';
import { resolveNotesRoot } from '../../src/server/notes/notes-root-resolver';

describe('clampIntegerLimit', () => {
    it.each([undefined, null, '', '12', false, {}, [], NaN, Infinity, -Infinity])(
        'uses the caller fallback without coercing %j', value => {
            expect(clampIntegerLimit(value, 50, 1, 200)).toBe(50);
            expect(clampIntegerLimit(value, 8, 1, 30)).toBe(8);
            expect(clampIntegerLimit(value, 20, 1, 100)).toBe(20);
        },
    );

    it.each([
        [-10, 1, 1], [0, 1, 1], [0.9, 1, 1], [1, 1, 1],
        [12.9, 12, 12], [30.9, 30, 30], [199.9, 199, 30], [250, 200, 30],
    ])('floors and clamps %s with caller-specific bounds', (value, native, memory) => {
        expect(clampIntegerLimit(value, 50, 1, 200)).toBe(native);
        expect(clampIntegerLimit(value, 8, 1, 30)).toBe(memory);
    });

    it('applies explicit bounds to fallback values', () => {
        expect(clampIntegerLimit(undefined, 500, 2, 10)).toBe(10);
        expect(clampIntegerLimit(undefined, 0, 2, 10)).toBe(2);
    });

    it.each([-100.9, -0.5, 0, 0.9, 1.9, 99.9, 100.9, 500])(
        'preserves Dream selection truncation after its positive minimum: %s', value => {
            expect(clampIntegerLimit(value, 20, 1, 100)).toBe(Math.min(Math.max(1, Math.trunc(value)), 100));
        },
    );
});

describe('managed notes paths', () => {
    it('preserves separate data-directory and workspace namespaces', () => {
        const dataDir = path.resolve('test-data');
        const otherDataDir = path.resolve('other-test-data');
        const first = getNotesRoot(dataDir, 'workspace-a');
        expect(first).toBe(getRepoDataPath(dataDir, 'workspace-a', 'notes'));
        expect(getNotesRoot(dataDir, 'workspace-b')).not.toBe(first);
        expect(getNotesRoot(otherDataDir, 'workspace-a')).not.toBe(first);
        expect(resolveNotesRoot(dataDir, 'workspace-a', undefined, 'default', [])).toMatchObject({
            absolutePath: first, isDefault: true,
        });
    });

    it('does not redirect configured roots into managed storage', () => {
        const dataDir = path.resolve('test-data');
        const repoRoot = path.resolve('test-repo');
        expect(resolveNotesRoot(dataDir, 'workspace-a', repoRoot, 'docs', ['docs'])).toMatchObject({
            absolutePath: path.join(repoRoot, 'docs'), isDefault: false,
        });
    });
});

describe('image data URL policies', () => {
    it.each([
        ['data:image/png;base64,AAAA', true, true],
        ['data:image/svg+xml;base64,AAAA', true, true],
        ['data:image/avif;base64,AAAA', true, false],
        ['data:image/png;base64,', false, true],
        [' DATA:IMAGE/PNG;BASE64,AAAA ', false, true],
        ['data:application/pdf;base64,AAAA', false, false],
        ['data:image/x-icon;base64,AAAA', false, false],
        ['data:image/png;base64,\nAAAA', false, true],
        ['data:image/png,AAAA', false, false],
        ['', false, false],
    ])('preserves server/display differences for %j', (value, server, display) => {
        expect(serverImageDataUrl(value)).toBe(server);
        expect(isDisplayImageDataUrl(value)).toBe(display);
        expect(renderedImageDataUrl(value)).toBe(display);
    });
});
