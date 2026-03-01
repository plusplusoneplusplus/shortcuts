/**
 * Tests for flattenTaskTree and filterTaskItems utilities.
 */

import { describe, it, expect } from 'vitest';
import {
    flattenTaskTree,
    filterTaskItems,
    isTaskDocument,
    isTaskDocumentGroup,
    type TaskFolder,
    type TaskDocumentGroup,
    type TaskDocument,
} from '../../../src/server/spa/client/react/hooks/useTaskTree';

// ── Helpers ────────────────────────────────────────────────────────────

function makeDoc(overrides: Partial<TaskDocument> & { baseName: string; fileName: string }): TaskDocument {
    return { isArchived: false, ...overrides };
}

function makeGroup(baseName: string, documents: TaskDocument[]): TaskDocumentGroup {
    return { baseName, documents, isArchived: false };
}

function makeFolder(
    name: string,
    opts?: {
        children?: TaskFolder[];
        documentGroups?: TaskDocumentGroup[];
        singleDocuments?: TaskDocument[];
        contextDocuments?: TaskDocument[];
    },
): TaskFolder {
    const folder: TaskFolder = {
        name,
        relativePath: name,
        children: opts?.children ?? [],
        documentGroups: opts?.documentGroups ?? [],
        singleDocuments: opts?.singleDocuments ?? [],
    };
    if (opts?.contextDocuments) {
        (folder as any).contextDocuments = opts.contextDocuments;
    }
    return folder;
}

// ── flattenTaskTree ────────────────────────────────────────────────────

describe('flattenTaskTree', () => {
    it('returns empty array for empty folder', () => {
        const folder = makeFolder('empty');
        expect(flattenTaskTree(folder)).toEqual([]);
    });

    it('returns singleDocuments from folder', () => {
        const doc = makeDoc({ baseName: 'task1', fileName: 'task1.md' });
        const folder = makeFolder('f', { singleDocuments: [doc] });
        const result = flattenTaskTree(folder);
        expect(result).toHaveLength(1);
        expect(result[0]).toBe(doc);
    });

    it('returns documentGroups from folder', () => {
        const group = makeGroup('task1', [makeDoc({ baseName: 'task1', fileName: 'task1.plan.md' })]);
        const folder = makeFolder('f', { documentGroups: [group] });
        const result = flattenTaskTree(folder);
        expect(result).toHaveLength(1);
        expect(result[0]).toBe(group);
    });

    it('includes contextDocuments', () => {
        const ctxDoc = makeDoc({ baseName: 'README', fileName: 'README.md' });
        const folder = makeFolder('f', { contextDocuments: [ctxDoc] });
        const result = flattenTaskTree(folder);
        expect(result).toHaveLength(1);
        expect(result[0]).toBe(ctxDoc);
    });

    it('returns all item types from a folder', () => {
        const doc = makeDoc({ baseName: 'single', fileName: 'single.md' });
        const group = makeGroup('grouped', [makeDoc({ baseName: 'grouped', fileName: 'grouped.plan.md' })]);
        const ctxDoc = makeDoc({ baseName: 'CONTEXT', fileName: 'CONTEXT.md' });
        const folder = makeFolder('f', {
            singleDocuments: [doc],
            documentGroups: [group],
            contextDocuments: [ctxDoc],
        });
        const result = flattenTaskTree(folder);
        expect(result).toHaveLength(3);
        expect(result).toContain(doc);
        expect(result).toContain(group);
        expect(result).toContain(ctxDoc);
    });

    it('collects items from nested folders', () => {
        const childDoc = makeDoc({ baseName: 'child-task', fileName: 'child-task.md' });
        const parentDoc = makeDoc({ baseName: 'parent-task', fileName: 'parent-task.md' });
        const child = makeFolder('child', { singleDocuments: [childDoc] });
        const parent = makeFolder('parent', { children: [child], singleDocuments: [parentDoc] });

        const result = flattenTaskTree(parent);
        expect(result).toHaveLength(2);
        expect(result).toContain(parentDoc);
        expect(result).toContain(childDoc);
    });

    it('handles deeply nested structure (3+ levels)', () => {
        const deepDoc = makeDoc({ baseName: 'deep', fileName: 'deep.md' });
        const midDoc = makeDoc({ baseName: 'mid', fileName: 'mid.md' });
        const topDoc = makeDoc({ baseName: 'top', fileName: 'top.md' });

        const level3 = makeFolder('l3', { singleDocuments: [deepDoc] });
        const level2 = makeFolder('l2', { children: [level3], singleDocuments: [midDoc] });
        const level1 = makeFolder('l1', { children: [level2], singleDocuments: [topDoc] });

        const result = flattenTaskTree(level1);
        expect(result).toHaveLength(3);
        expect(result).toContain(topDoc);
        expect(result).toContain(midDoc);
        expect(result).toContain(deepDoc);
    });

    it('does not include TaskFolder nodes in output', () => {
        const doc = makeDoc({ baseName: 'task', fileName: 'task.md' });
        const child = makeFolder('child', { singleDocuments: [doc] });
        const parent = makeFolder('parent', { children: [child] });

        const result = flattenTaskTree(parent);
        for (const item of result) {
            expect(isTaskDocument(item) || isTaskDocumentGroup(item)).toBe(true);
        }
    });
});

// ── filterTaskItems ────────────────────────────────────────────────────

describe('filterTaskItems', () => {
    const docA = makeDoc({ baseName: 'alpha', fileName: 'alpha.plan.md', relativePath: 'feature/sub' });
    const docB = makeDoc({ baseName: 'beta', fileName: 'beta.spec.md' });
    const docC = makeDoc({ baseName: 'gamma', fileName: 'gamma.md' });
    const groupD = makeGroup('delta', [
        makeDoc({ baseName: 'delta', fileName: 'delta.spec.md', relativePath: 'feature' }),
        makeDoc({ baseName: 'delta', fileName: 'delta.plan.md' }),
    ]);
    const items: (TaskDocument | TaskDocumentGroup)[] = [docC, docA, docB, groupD];

    it('empty query returns all items sorted by baseName', () => {
        const result = filterTaskItems(items, '');
        expect(result.map((i) => i.baseName)).toEqual(['alpha', 'beta', 'delta', 'gamma']);
    });

    it('exact baseName match', () => {
        const result = filterTaskItems(items, 'alpha');
        expect(result).toHaveLength(1);
        expect(result[0]).toBe(docA);
    });

    it('partial baseName match', () => {
        const result = filterTaskItems(items, 'lph');
        expect(result).toHaveLength(1);
        expect(result[0]).toBe(docA);
    });

    it('case-insensitive match', () => {
        const result = filterTaskItems(items, 'BETA');
        expect(result).toHaveLength(1);
        expect(result[0]).toBe(docB);
    });

    it('matches against fileName', () => {
        const result = filterTaskItems(items, 'plan.md');
        // alpha.plan.md and delta group (contains delta.plan.md)
        expect(result.map((i) => i.baseName)).toEqual(['alpha', 'delta']);
    });

    it('matches against relativePath', () => {
        const result = filterTaskItems(items, 'feature');
        // docA has relativePath 'feature/sub', groupD has child with relativePath 'feature'
        expect(result.map((i) => i.baseName)).toEqual(['alpha', 'delta']);
    });

    it('matches TaskDocumentGroup via child document fileName', () => {
        const result = filterTaskItems(items, 'delta.spec');
        expect(result).toHaveLength(1);
        expect(result[0]).toBe(groupD);
    });

    it('no match returns empty array', () => {
        const result = filterTaskItems(items, 'nonexistent');
        expect(result).toEqual([]);
    });

    it('special characters in query (no regex interpretation)', () => {
        const result = filterTaskItems(items, 'alpha.plan');
        expect(result).toHaveLength(1);
        expect(result[0]).toBe(docA);
    });

    it('results are sorted alphabetically by baseName', () => {
        const result = filterTaskItems(items, 'a');
        // alpha (baseName), beta (baseName), gamma (baseName), delta (baseName has no 'a'... but delta.plan.md has 'a')
        // alpha: baseName 'alpha' has 'a' → yes
        // beta: baseName 'beta' has 'a' → yes
        // gamma: baseName 'gamma' has 'a' → yes
        // delta: baseName 'delta' has 'a' → no; fileName? not a TaskDocument; child fileNames: 'delta.spec.md' no, 'delta.plan.md' has 'a' → yes
        const names = result.map((i) => i.baseName);
        const sorted = [...names].sort();
        expect(names).toEqual(sorted);
    });
});
