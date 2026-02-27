/**
 * Pure function unit tests — covers gaps not in isContextFile.test.ts / useTaskTree.test.ts.
 * Focuses on: CONTEXT_FILES exact membership, isGitMetadataFolder edge cases,
 * filterGitMetadataFolders edge cases, getFolderKey, countMarkdownFilesInFolder.
 */

import { describe, it, expect } from 'vitest';
import {
    CONTEXT_FILES,
    isContextFile,
    isGitMetadataFolder,
    filterGitMetadataFolders,
    countMarkdownFilesInFolder,
    type TaskFolder,
    type TaskDocument,
    type TaskDocumentGroup,
} from '../../../src/server/spa/client/react/hooks/useTaskTree';
import { getFolderKey, rebuildColumnsFromKeys } from '../../../src/server/spa/client/react/tasks/TaskTree';

// ── Helpers ────────────────────────────────────────────────────────────

function makeFolder(overrides: Partial<TaskFolder> & { name: string }): TaskFolder {
    return {
        relativePath: overrides.name,
        children: [],
        documentGroups: [],
        singleDocuments: [],
        ...overrides,
    };
}

function makeDoc(overrides: Partial<TaskDocument> & { fileName: string }): TaskDocument {
    return {
        baseName: overrides.fileName.replace(/\.[^.]+$/, ''),
        isArchived: false,
        ...overrides,
    };
}

function makeGroup(baseName: string, docs: TaskDocument[]): TaskDocumentGroup {
    return { baseName, documents: docs, isArchived: false };
}

// ── CONTEXT_FILES exact membership ─────────────────────────────────────

describe('CONTEXT_FILES', () => {
    it('is a Set instance', () => {
        expect(CONTEXT_FILES).toBeInstanceOf(Set);
    });

    it('has exactly 15 entries', () => {
        expect(CONTEXT_FILES.size).toBe(15);
    });

    it('contains all expected lowercase values', () => {
        const expected = [
            'readme', 'readme.md', 'claude.md', 'license', 'license.md',
            'changelog.md', 'contributing.md', 'code_of_conduct.md', 'security.md',
            'index', 'index.md', 'context', 'context.md',
            '.gitignore', '.gitattributes',
        ];
        for (const entry of expected) {
            expect(CONTEXT_FILES.has(entry), `missing: ${entry}`).toBe(true);
        }
    });
});

// ── isContextFile additional edge cases ────────────────────────────────

describe('isContextFile edge cases', () => {
    it('returns false for partial matches', () => {
        expect(isContextFile('my-readme.md')).toBe(false);
    });
});

// ── isGitMetadataFolder standalone tests ───────────────────────────────

describe('isGitMetadataFolder', () => {
    it('returns true for folder with name .git', () => {
        expect(isGitMetadataFolder(makeFolder({ name: '.git', relativePath: '.git' }))).toBe(true);
    });

    it('returns true for nested .git in relativePath (forward slash)', () => {
        expect(isGitMetadataFolder(makeFolder({ name: 'objects', relativePath: 'modules/.git/objects' }))).toBe(true);
    });

    it('returns true for nested .git in relativePath (backslash)', () => {
        expect(isGitMetadataFolder(makeFolder({ name: 'b', relativePath: 'a\\.git\\b' }))).toBe(true);
    });

    it('returns false for regular folder', () => {
        expect(isGitMetadataFolder(makeFolder({ name: 'src', relativePath: 'src' }))).toBe(false);
    });

    it('returns false for .github (substring, not exact segment)', () => {
        expect(isGitMetadataFolder(makeFolder({ name: '.github', relativePath: '.github' }))).toBe(false);
    });

    it('returns false for .gitignore folder name', () => {
        expect(isGitMetadataFolder(makeFolder({ name: '.gitignore', relativePath: '.gitignore' }))).toBe(false);
    });

    it('handles empty relativePath', () => {
        expect(isGitMetadataFolder(makeFolder({ name: 'src', relativePath: '' }))).toBe(false);
    });

    it('handles folder where only name is .git (empty relativePath)', () => {
        expect(isGitMetadataFolder(makeFolder({ name: '.git', relativePath: '' }))).toBe(true);
    });
});

// ── filterGitMetadataFolders edge cases ────────────────────────────────

describe('filterGitMetadataFolders edge cases', () => {
    it('returns folder with empty children when all children are git folders', () => {
        const folder = makeFolder({
            name: 'root',
            relativePath: '',
            children: [
                makeFolder({ name: '.git', relativePath: '.git' }),
            ],
        });
        const filtered = filterGitMetadataFolders(folder);
        expect(filtered.children).toHaveLength(0);
    });

    it('handles folder with empty children array', () => {
        const folder = makeFolder({ name: 'empty', relativePath: 'empty', children: [] });
        const filtered = filterGitMetadataFolders(folder);
        expect(filtered.children).toHaveLength(0);
    });

    it('handles folder with children: undefined (Array.isArray guard)', () => {
        const folder = makeFolder({ name: 'broken', relativePath: 'broken' });
        (folder as any).children = undefined;
        const filtered = filterGitMetadataFolders(folder);
        expect(filtered.children).toHaveLength(0);
    });

    it('preserves non-git children while removing git children', () => {
        const folder = makeFolder({
            name: 'root',
            relativePath: '',
            children: [
                makeFolder({ name: '.git', relativePath: '.git' }),
                makeFolder({ name: 'src', relativePath: 'src' }),
                makeFolder({ name: 'docs', relativePath: 'docs' }),
            ],
        });
        const filtered = filterGitMetadataFolders(folder);
        expect(filtered.children.map(c => c.name)).toEqual(['src', 'docs']);
    });
});

// ── getFolderKey ───────────────────────────────────────────────────────

describe('getFolderKey', () => {
    it('uses relativePath when present', () => {
        expect(getFolderKey(makeFolder({ name: 'components', relativePath: 'src/components' }))).toBe('src/components');
    });

    it('falls back to name when relativePath is empty string', () => {
        expect(getFolderKey(makeFolder({ name: 'root', relativePath: '' }))).toBe('root');
    });

    it('falls back to name when relativePath is falsy', () => {
        const folder = makeFolder({ name: 'orphan', relativePath: '' });
        (folder as any).relativePath = undefined;
        expect(getFolderKey(folder)).toBe('orphan');
    });
});

// ── countMarkdownFilesInFolder ─────────────────────────────────────────

describe('countMarkdownFilesInFolder', () => {
    it('returns 0 for empty folder', () => {
        expect(countMarkdownFilesInFolder(makeFolder({ name: 'empty' }))).toBe(0);
    });

    it('counts .md files in singleDocuments', () => {
        const folder = makeFolder({
            name: 'docs',
            singleDocuments: [
                makeDoc({ fileName: 'readme.md' }),
                makeDoc({ fileName: 'notes.md' }),
            ],
        });
        expect(countMarkdownFilesInFolder(folder)).toBe(2);
    });

    it('ignores non-markdown files in singleDocuments', () => {
        const folder = makeFolder({
            name: 'mixed',
            singleDocuments: [
                makeDoc({ fileName: 'readme.md' }),
                makeDoc({ fileName: 'script.ts' }),
                makeDoc({ fileName: 'data.txt' }),
            ],
        });
        expect(countMarkdownFilesInFolder(folder)).toBe(1);
    });

    it('counts .md files inside documentGroups', () => {
        const folder = makeFolder({
            name: 'grouped',
            documentGroups: [
                makeGroup('feature', [
                    makeDoc({ fileName: 'feature.plan.md' }),
                    makeDoc({ fileName: 'feature.spec.md' }),
                ]),
            ],
        });
        expect(countMarkdownFilesInFolder(folder)).toBe(2);
    });

    it('recursively counts through child folders', () => {
        const child = makeFolder({
            name: 'sub',
            relativePath: 'parent/sub',
            singleDocuments: [makeDoc({ fileName: 'child.md' })],
        });
        const parent = makeFolder({
            name: 'parent',
            singleDocuments: [makeDoc({ fileName: 'parent.md' })],
            children: [child],
        });
        expect(countMarkdownFilesInFolder(parent)).toBe(2);
    });

    it('handles case-insensitive .MD extension', () => {
        const folder = makeFolder({
            name: 'upper',
            singleDocuments: [makeDoc({ fileName: 'README.MD' })],
        });
        expect(countMarkdownFilesInFolder(folder)).toBe(1);
    });

    it('combines singles, groups, and child folders', () => {
        const grandchild = makeFolder({
            name: 'gc',
            relativePath: 'a/b/gc',
            singleDocuments: [makeDoc({ fileName: 'deep.md' })],
        });
        const child = makeFolder({
            name: 'b',
            relativePath: 'a/b',
            children: [grandchild],
            documentGroups: [makeGroup('feat', [makeDoc({ fileName: 'feat.plan.md' })])],
        });
        const root = makeFolder({
            name: 'a',
            children: [child],
            singleDocuments: [makeDoc({ fileName: 'top.md' }), makeDoc({ fileName: 'style.css' })],
        });
        // top.md (1) + feat.plan.md (1) + deep.md (1) = 3
        expect(countMarkdownFilesInFolder(root)).toBe(3);
    });
});
