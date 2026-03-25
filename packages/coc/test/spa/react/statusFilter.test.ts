/**
 * Tests for status-filter helpers: isDocumentMatchingFilter, filterFolderTree.
 */

import { describe, it, expect } from 'vitest';
import {
    isDocumentMatchingFilter,
    filterFolderTree,
    TASK_STATUSES,
    STATUS_PILLS,
    type TaskStatusValue,
    type TaskFolder,
    type TaskDocument,
    type TaskDocumentGroup,
} from '../../../src/server/spa/client/react/hooks/useTaskTree';

// ── Fixtures ───────────────────────────────────────────────────────────

function makeDoc(status?: string): TaskDocument {
    return { baseName: 'task', fileName: 'task.md', isArchived: false, status };
}

function makeFolder(name: string, opts?: {
    children?: TaskFolder[];
    singleDocuments?: TaskDocument[];
    documentGroups?: TaskDocumentGroup[];
    contextDocuments?: TaskDocument[];
}): TaskFolder {
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

// ── Constants ──────────────────────────────────────────────────────────

describe('TASK_STATUSES', () => {
    it('contains four statuses', () => {
        expect(TASK_STATUSES).toEqual(['pending', 'in-progress', 'done', 'future']);
    });
});

describe('STATUS_PILLS', () => {
    it('has one pill per status', () => {
        expect(STATUS_PILLS).toHaveLength(4);
        expect(STATUS_PILLS.map(p => p.status)).toEqual(['pending', 'in-progress', 'done', 'future']);
    });

    it('each pill has icon and label', () => {
        for (const pill of STATUS_PILLS) {
            expect(pill.icon).toBeTruthy();
            expect(pill.label).toBeTruthy();
        }
    });
});

// ── isDocumentMatchingFilter ───────────────────────────────────────────

describe('isDocumentMatchingFilter', () => {
    it('returns true for any doc when filter is empty', () => {
        expect(isDocumentMatchingFilter(makeDoc('done'), [])).toBe(true);
        expect(isDocumentMatchingFilter(makeDoc(undefined), [])).toBe(true);
    });

    it('returns true when doc status is in filter', () => {
        expect(isDocumentMatchingFilter(makeDoc('done'), ['done'])).toBe(true);
        expect(isDocumentMatchingFilter(makeDoc('pending'), ['done', 'pending'])).toBe(true);
    });

    it('returns false when doc status is not in filter', () => {
        expect(isDocumentMatchingFilter(makeDoc('done'), ['pending'])).toBe(false);
    });

    it('returns false for undefined status when filter is active', () => {
        expect(isDocumentMatchingFilter(makeDoc(undefined), ['pending'])).toBe(false);
    });

    it('works with all four statuses', () => {
        const all: TaskStatusValue[] = ['pending', 'in-progress', 'done', 'future'];
        for (const s of all) {
            expect(isDocumentMatchingFilter(makeDoc(s), [s])).toBe(true);
            expect(isDocumentMatchingFilter(makeDoc(s), all.filter(x => x !== s))).toBe(false);
        }
    });
});

// ── filterFolderTree ───────────────────────────────────────────────────

describe('filterFolderTree', () => {
    it('returns the original folder when filter is empty', () => {
        const folder = makeFolder('root', { singleDocuments: [makeDoc('done')] });
        expect(filterFolderTree(folder, [])).toBe(folder);
    });

    it('filters out non-matching single documents', () => {
        const folder = makeFolder('root', {
            singleDocuments: [makeDoc('done'), makeDoc('pending'), makeDoc('future')],
        });
        const result = filterFolderTree(folder, ['done']);
        expect(result).not.toBeNull();
        expect(result!.singleDocuments).toHaveLength(1);
        expect(result!.singleDocuments[0].status).toBe('done');
    });

    it('filters out document groups with no matching docs', () => {
        const group: TaskDocumentGroup = {
            baseName: 'task',
            documents: [makeDoc('future')],
            isArchived: false,
        };
        const folder = makeFolder('root', { documentGroups: [group] });
        const result = filterFolderTree(folder, ['done']);
        expect(result).toBeNull();
    });

    it('keeps document groups with at least one matching doc', () => {
        const group: TaskDocumentGroup = {
            baseName: 'task',
            documents: [makeDoc('done'), makeDoc('future')],
            isArchived: false,
        };
        const folder = makeFolder('root', { documentGroups: [group] });
        const result = filterFolderTree(folder, ['done']);
        expect(result).not.toBeNull();
        expect(result!.documentGroups).toHaveLength(1);
    });

    it('returns null for folder with no matching content', () => {
        const folder = makeFolder('root', { singleDocuments: [makeDoc('future')] });
        expect(filterFolderTree(folder, ['done'])).toBeNull();
    });

    it('recursively filters child folders', () => {
        const child = makeFolder('child', { singleDocuments: [makeDoc('done')] });
        const emptyChild = makeFolder('empty', { singleDocuments: [makeDoc('future')] });
        const root = makeFolder('root', { children: [child, emptyChild] });

        const result = filterFolderTree(root, ['done']);
        expect(result).not.toBeNull();
        expect(result!.children).toHaveLength(1);
        expect(result!.children[0].name).toBe('child');
    });

    it('filters context documents', () => {
        const ctxDoc = makeDoc('done');
        const folder = makeFolder('root', { contextDocuments: [ctxDoc, makeDoc('future')] });
        const result = filterFolderTree(folder, ['done']);
        expect(result).not.toBeNull();
        expect((result as any).contextDocuments).toHaveLength(1);
    });

    it('preserves folder structure for matching documents', () => {
        const deepChild = makeFolder('deep', { singleDocuments: [makeDoc('pending')] });
        const midChild = makeFolder('mid', { children: [deepChild] });
        const root = makeFolder('root', { children: [midChild] });

        const result = filterFolderTree(root, ['pending']);
        expect(result).not.toBeNull();
        expect(result!.children).toHaveLength(1);
        expect(result!.children[0].name).toBe('mid');
        expect(result!.children[0].children).toHaveLength(1);
        expect(result!.children[0].children[0].name).toBe('deep');
    });

    it('handles multiple active statuses', () => {
        const folder = makeFolder('root', {
            singleDocuments: [makeDoc('done'), makeDoc('pending'), makeDoc('future')],
        });
        const result = filterFolderTree(folder, ['done', 'pending']);
        expect(result).not.toBeNull();
        expect(result!.singleDocuments).toHaveLength(2);
    });

    it('handles folder with undefined-status docs (hidden when filter active)', () => {
        const folder = makeFolder('root', {
            singleDocuments: [makeDoc(undefined), makeDoc('done')],
        });
        const result = filterFolderTree(folder, ['done']);
        expect(result).not.toBeNull();
        expect(result!.singleDocuments).toHaveLength(1);
        expect(result!.singleDocuments[0].status).toBe('done');
    });
});
