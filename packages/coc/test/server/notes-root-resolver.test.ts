import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    resolveNotesRoot, isRootResolveError, validateNotesRootPath, DEFAULT_ROOT_ID,
    discoverTaskDerivedNotesRoots, encodeRootPath, resolveCommentsSidecarPath,
} from '../../src/server/notes/notes-root-resolver';
import type { ResolvedNotesRoot } from '../../src/server/notes/notes-root-resolver';
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

describe('resolveCommentsSidecarPath', () => {
    const dataDir = '/mock/coc-data';
    const workspaceId = 'ws-123';

    it('returns co-located path for default root', () => {
        const root: ResolvedNotesRoot = {
            absolutePath: '/mock/coc-data/repos/ws-123/notes',
            isDefault: true,
            rootId: DEFAULT_ROOT_ID,
        };
        const result = resolveCommentsSidecarPath(dataDir, workspaceId, root, 'page.md');
        expect(result).toBe(path.resolve('/mock/coc-data/repos/ws-123/notes', 'page.md.comments.json'));
    });

    it('returns managed area path for repo-folder root', () => {
        const root: ResolvedNotesRoot = {
            absolutePath: '/mock/workspace/docs/notes',
            isDefault: false,
            rootId: 'docs/notes',
        };
        const result = resolveCommentsSidecarPath(dataDir, workspaceId, root, 'page.md');
        const encoded = encodeRootPath('docs/notes');
        const expected = path.resolve(dataDir, 'repos', workspaceId, 'notes-comments', encoded, 'page.md.comments.json');
        expect(result).toBe(expected);
    });

    it('handles absolute notePath for default root', () => {
        const root: ResolvedNotesRoot = {
            absolutePath: '/mock/coc-data/repos/ws-123/notes',
            isDefault: true,
            rootId: DEFAULT_ROOT_ID,
        };
        const absPath = '/some/absolute/file.md';
        const result = resolveCommentsSidecarPath(dataDir, workspaceId, root, absPath);
        expect(result).toBe(path.resolve(absPath + '.comments.json'));
    });

    it('handles nested note path for repo-folder root', () => {
        const root: ResolvedNotesRoot = {
            absolutePath: '/mock/workspace/docs/notes',
            isDefault: false,
            rootId: 'docs/notes',
        };
        const result = resolveCommentsSidecarPath(dataDir, workspaceId, root, 'sub/page.md');
        expect(result).toContain('notes-comments');
        expect(result).toContain('sub');
        expect(result.endsWith('.comments.json')).toBe(true);
    });
});
