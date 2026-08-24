import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    resolveNotesRoot, isRootResolveError, validateNotesRootPath, DEFAULT_ROOT_ID,
    discoverTaskDerivedNotesRoots, encodeRootPath,
} from '../../src/server/notes/notes-root-resolver';
import { getRepoDataPath } from '@plusplusoneplusplus/forge';

describe('resolveNotesRoot', () => {
    const dataDir = '/mock/coc-data';
    const workspaceId = 'ws-123';
    const workspaceRoot = '/mock/workspace';

    it('returns default root when rootParam is undefined', () => {
        const result = resolveNotesRoot(dataDir, workspaceId, workspaceRoot, undefined, []);
        expect(isRootResolveError(result)).toBe(false);
        if (!isRootResolveError(result)) {
            expect(result.isDefault).toBe(true);
            expect(result.isTaskDerived).toBe(false);
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
            expect(result.isTaskDerived).toBe(false);
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

    it('resolves only task identities currently derived for the requested workspace', () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'notes-task-root-resolver-'));
        try {
            const currentWorkspaceRoot = path.join(tempDir, 'current-workspace');
            const otherWorkspaceRoot = path.join(tempDir, 'other-workspace');
            fs.mkdirSync(currentWorkspaceRoot, { recursive: true });
            fs.mkdirSync(otherWorkspaceRoot, { recursive: true });
            fs.mkdirSync(getRepoDataPath(tempDir, 'current', 'tasks'), { recursive: true });

            const [taskRoot] = discoverTaskDerivedNotesRoots(tempDir, 'current', currentWorkspaceRoot);
            const current = resolveNotesRoot(tempDir, 'current', currentWorkspaceRoot, taskRoot.rootId, []);
            expect(isRootResolveError(current)).toBe(false);
            if (!isRootResolveError(current)) {
                expect(current.absolutePath).toBe(fs.realpathSync.native(getRepoDataPath(tempDir, 'current', 'tasks')));
                expect(current.rootId).toBe(taskRoot.rootId);
                expect(current.isTaskDerived).toBe(true);
            }

            const other = resolveNotesRoot(tempDir, 'other', otherWorkspaceRoot, taskRoot.rootId, []);
            expect(isRootResolveError(other)).toBe(true);
        } finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    it('stops resolving a task identity after its directory disappears', () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'notes-task-root-missing-'));
        try {
            const currentWorkspaceRoot = path.join(tempDir, 'workspace');
            const primary = getRepoDataPath(tempDir, 'current', 'tasks');
            fs.mkdirSync(currentWorkspaceRoot, { recursive: true });
            fs.mkdirSync(primary, { recursive: true });
            const [taskRoot] = discoverTaskDerivedNotesRoots(tempDir, 'current', currentWorkspaceRoot);

            fs.rmSync(primary, { recursive: true });
            const result = resolveNotesRoot(tempDir, 'current', currentWorkspaceRoot, taskRoot.rootId, []);
            expect(isRootResolveError(result)).toBe(true);
        } finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    it('uses the protected task identity when an additional Notes root overlaps it', () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'notes-task-root-overlap-'));
        try {
            const currentWorkspaceRoot = path.join(tempDir, 'workspace');
            const shared = path.join(currentWorkspaceRoot, 'shared');
            fs.mkdirSync(shared, { recursive: true });
            const settingsPath = getRepoDataPath(tempDir, 'current', 'tasks-settings.json');
            fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
            fs.writeFileSync(settingsPath, JSON.stringify({ folderPaths: ['shared'] }), 'utf-8');
            const [taskRoot] = discoverTaskDerivedNotesRoots(tempDir, 'current', currentWorkspaceRoot);

            const result = resolveNotesRoot(tempDir, 'current', currentWorkspaceRoot, 'shared', ['shared']);
            expect(isRootResolveError(result)).toBe(false);
            if (!isRootResolveError(result)) {
                expect(result.rootId).toBe(taskRoot.rootId);
                expect(result.absolutePath).toBe(fs.realpathSync.native(shared));
                expect(result.isTaskDerived).toBe(true);
            }
        } finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
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

describe('encodeRootPath', () => {
    it('produces a filesystem-safe string', () => {
        const encoded = encodeRootPath('docs/notes');
        expect(encoded).not.toContain('/');
        expect(encoded).not.toContain('\\');
        expect(encoded).toContain('docs_notes');
    });

    it('produces deterministic output', () => {
        expect(encodeRootPath('docs/notes')).toBe(encodeRootPath('docs/notes'));
    });

    it('normalizes backslashes', () => {
        expect(encodeRootPath('docs\\notes')).toBe(encodeRootPath('docs/notes'));
    });

    it('produces different results for different paths', () => {
        expect(encodeRootPath('a/b')).not.toBe(encodeRootPath('a/c'));
    });
});

// Sidecar path placement is covered by notes-sidecar-resolver.test.ts.
