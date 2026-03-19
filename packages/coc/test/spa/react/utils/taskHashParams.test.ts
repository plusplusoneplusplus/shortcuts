import { describe, it, expect } from 'vitest';
import { parseTaskHashParams } from '../../../../src/server/spa/client/react/utils/taskHashParams';

const WS = 'ws-123';

describe('parseTaskHashParams — repos path', () => {
    it('returns nulls for non-repos hash', () => {
        const result = parseTaskHashParams('#other/path', WS);
        expect(result.initialFolderPath).toBeNull();
        expect(result.initialFilePath).toBeNull();
        expect(result.initialViewMode).toBeNull();
    });

    it('returns nulls when wsId does not match', () => {
        const result = parseTaskHashParams(`#repos/other-ws/tasks`, WS);
        expect(result.initialFolderPath).toBeNull();
        expect(result.initialFilePath).toBeNull();
    });

    it('returns nulls when segment is not tasks', () => {
        const result = parseTaskHashParams(`#repos/${WS}/other`, WS);
        expect(result.initialFolderPath).toBeNull();
        expect(result.initialFilePath).toBeNull();
    });

    it('returns null paths for root tasks hash with no deeper path', () => {
        const result = parseTaskHashParams(`#repos/${WS}/tasks`, WS);
        expect(result.initialFolderPath).toBeNull();
        expect(result.initialFilePath).toBeNull();
        expect(result.initialViewMode).toBeNull();
    });

    it('treats last segment ending in .md as a file path', () => {
        const result = parseTaskHashParams(`#repos/${WS}/tasks/my-file.md`, WS);
        expect(result.initialFilePath).toBe('my-file.md');
        expect(result.initialFolderPath).toBeNull();
    });

    it('sets folder for nested file path', () => {
        const result = parseTaskHashParams(`#repos/${WS}/tasks/subdir/my-file.md`, WS);
        expect(result.initialFilePath).toBe('subdir/my-file.md');
        expect(result.initialFolderPath).toBe('subdir');
    });

    it('treats last segment without .md as a folder path', () => {
        const result = parseTaskHashParams(`#repos/${WS}/tasks/subdir`, WS);
        expect(result.initialFolderPath).toBe('subdir');
        expect(result.initialFilePath).toBeNull();
    });

    it('decodes percent-encoded path segments', () => {
        const encoded = encodeURIComponent('my folder');
        const result = parseTaskHashParams(`#repos/${WS}/tasks/${encoded}/file.md`, WS);
        expect(result.initialFolderPath).toBe('my folder');
        expect(result.initialFilePath).toBe('my folder/file.md');
    });
});

describe('parseTaskHashParams — mode query param', () => {
    it('parses mode=source', () => {
        const result = parseTaskHashParams(`#repos/${WS}/tasks/f.md?mode=source`, WS);
        expect(result.initialViewMode).toBe('source');
    });

    it('parses mode=review', () => {
        const result = parseTaskHashParams(`#repos/${WS}/tasks/f.md?mode=review`, WS);
        expect(result.initialViewMode).toBe('review');
    });

    it('returns null for unknown mode', () => {
        const result = parseTaskHashParams(`#repos/${WS}/tasks/f.md?mode=unknown`, WS);
        expect(result.initialViewMode).toBeNull();
    });

    it('returns null view mode when no query string', () => {
        const result = parseTaskHashParams(`#repos/${WS}/tasks/f.md`, WS);
        expect(result.initialViewMode).toBeNull();
    });
});

describe('parseTaskHashParams — edge cases', () => {
    it('handles empty string without throwing', () => {
        expect(() => parseTaskHashParams('', WS)).not.toThrow();
    });

    it('handles hash with just #', () => {
        expect(() => parseTaskHashParams('#', WS)).not.toThrow();
    });

    it('handles wsId with special characters when encoded', () => {
        const specialWs = 'ws/special';
        const encoded = encodeURIComponent(specialWs);
        const result = parseTaskHashParams(`#repos/${encoded}/tasks/file.md`, specialWs);
        expect(result.initialFilePath).toBe('file.md');
    });
});
