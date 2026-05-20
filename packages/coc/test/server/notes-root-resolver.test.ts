import { describe, it, expect } from 'vitest';
import * as path from 'path';
import { resolveNotesRoot, isRootResolveError, validateNotesRootPath, DEFAULT_ROOT_ID } from '../../src/server/notes/notes-root-resolver';

describe('resolveNotesRoot', () => {
    const dataDir = '/mock/coc-data';
    const workspaceId = 'ws-123';
    const workspaceRoot = '/mock/workspace';

    it('returns default root when rootParam is undefined', () => {
        const result = resolveNotesRoot(dataDir, workspaceId, workspaceRoot, undefined, []);
        expect(isRootResolveError(result)).toBe(false);
        if (!isRootResolveError(result)) {
            expect(result.isDefault).toBe(true);
            expect(result.rootId).toBe(DEFAULT_ROOT_ID);
            // Should contain 'notes' in the path
            expect(result.absolutePath).toContain('notes');
        }
    });

    it('returns default root when rootParam is "default"', () => {
        const result = resolveNotesRoot(dataDir, workspaceId, workspaceRoot, 'default', []);
        expect(isRootResolveError(result)).toBe(false);
        if (!isRootResolveError(result)) {
            expect(result.isDefault).toBe(true);
            expect(result.rootId).toBe(DEFAULT_ROOT_ID);
        }
    });

    it('resolves a configured additional root', () => {
        const result = resolveNotesRoot(dataDir, workspaceId, workspaceRoot, 'docs/notes', ['docs/notes']);
        expect(isRootResolveError(result)).toBe(false);
        if (!isRootResolveError(result)) {
            expect(result.isDefault).toBe(false);
            expect(result.rootId).toBe('docs/notes');
            expect(result.absolutePath).toBe(path.resolve(workspaceRoot, 'docs/notes'));
        }
    });

    it('returns error for unconfigured root', () => {
        const result = resolveNotesRoot(dataDir, workspaceId, workspaceRoot, 'unconfigured', ['docs/notes']);
        expect(isRootResolveError(result)).toBe(true);
        if (isRootResolveError(result)) {
            expect(result.statusCode).toBe(400);
            expect(result.error).toContain('not configured');
        }
    });

    it('returns error when workspace root is undefined for non-default root', () => {
        const result = resolveNotesRoot(dataDir, workspaceId, undefined, 'docs/notes', ['docs/notes']);
        expect(isRootResolveError(result)).toBe(true);
        if (isRootResolveError(result)) {
            expect(result.statusCode).toBe(400);
        }
    });

    it('normalizes backslashes in rootParam', () => {
        const result = resolveNotesRoot(dataDir, workspaceId, workspaceRoot, 'docs\\notes', ['docs/notes']);
        expect(isRootResolveError(result)).toBe(false);
        if (!isRootResolveError(result)) {
            expect(result.rootId).toBe('docs/notes');
        }
    });

    it('strips trailing slashes from rootParam', () => {
        const result = resolveNotesRoot(dataDir, workspaceId, workspaceRoot, 'docs/notes/', ['docs/notes']);
        expect(isRootResolveError(result)).toBe(false);
        if (!isRootResolveError(result)) {
            expect(result.rootId).toBe('docs/notes');
        }
    });

    it('returns error for empty additionalRoots', () => {
        const result = resolveNotesRoot(dataDir, workspaceId, workspaceRoot, 'docs/notes', undefined);
        expect(isRootResolveError(result)).toBe(true);
    });
});

describe('validateNotesRootPath', () => {
    it('accepts valid relative path', () => {
        expect(validateNotesRootPath('docs/notes')).toBeUndefined();
    });

    it('accepts single segment path', () => {
        expect(validateNotesRootPath('notes')).toBeUndefined();
    });

    it('accepts deeply nested path', () => {
        expect(validateNotesRootPath('a/b/c/d')).toBeUndefined();
    });

    it('rejects empty string', () => {
        expect(validateNotesRootPath('')).toBeDefined();
    });

    it('rejects absolute path', () => {
        expect(validateNotesRootPath('/absolute/path')).toBeDefined();
    });

    it('rejects Windows absolute path', () => {
        expect(validateNotesRootPath('C:\\Users\\foo')).toBeDefined();
    });

    it('rejects parent directory traversal (..)', () => {
        expect(validateNotesRootPath('../outside')).toBeDefined();
    });

    it('rejects path with embedded ..', () => {
        expect(validateNotesRootPath('docs/../../../etc')).toBeDefined();
    });

    it('rejects workspace root itself (.)', () => {
        expect(validateNotesRootPath('.')).toBeDefined();
    });

    it('rejects double dot (..)', () => {
        expect(validateNotesRootPath('..')).toBeDefined();
    });

    it('rejects path exceeding max length', () => {
        expect(validateNotesRootPath('a'.repeat(501))).toBeDefined();
    });
});
