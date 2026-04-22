/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@plusplusoneplusplus/forge', () => ({}));

import {
    normalizeRefPath,
    deduplicateReferenceFiles,
    ReferenceList,
} from '../../../../../src/server/spa/client/react/ui/ReferencesDropdown';

// ---------------------------------------------------------------------------
// normalizeRefPath
// ---------------------------------------------------------------------------

describe('normalizeRefPath', () => {
    it('converts backslashes to forward slashes', () => {
        expect(normalizeRefPath('C:\\Users\\docs\\plan.md')).toBe('c:/users/docs/plan.md');
    });

    it('lowercases the path', () => {
        expect(normalizeRefPath('/Home/User/Plan.MD')).toBe('/home/user/plan.md');
    });

    it('handles already-normalized paths', () => {
        expect(normalizeRefPath('src/index.ts')).toBe('src/index.ts');
    });
});

// ---------------------------------------------------------------------------
// deduplicateReferenceFiles
// ---------------------------------------------------------------------------

describe('deduplicateReferenceFiles', () => {
    it('removes files whose path matches planPath (exact)', () => {
        const result = deduplicateReferenceFiles(
            'src/plan.md',
            [{ filePath: 'src/plan.md' }, { filePath: 'src/other.ts' }],
        );
        expect(result).toEqual([{ filePath: 'src/other.ts' }]);
    });

    it('removes files matching planPath after separator normalization', () => {
        const result = deduplicateReferenceFiles(
            'src/plan.md',
            [{ filePath: 'src\\plan.md' }, { filePath: 'src/other.ts' }],
        );
        expect(result).toEqual([{ filePath: 'src/other.ts' }]);
    });

    it('removes files matching planPath case-insensitively', () => {
        const result = deduplicateReferenceFiles(
            'Src/Plan.MD',
            [{ filePath: 'src/plan.md' }, { filePath: 'src/other.ts' }],
        );
        expect(result).toEqual([{ filePath: 'src/other.ts' }]);
    });

    it('removes internal duplicates within files', () => {
        const result = deduplicateReferenceFiles(undefined, [
            { filePath: 'src/a.ts' },
            { filePath: 'src/b.ts' },
            { filePath: 'src/a.ts' },
        ]);
        expect(result).toEqual([
            { filePath: 'src/a.ts' },
            { filePath: 'src/b.ts' },
        ]);
    });

    it('removes internal duplicates differing only by separator/casing', () => {
        const result = deduplicateReferenceFiles(undefined, [
            { filePath: 'src/a.ts' },
            { filePath: 'src\\A.ts' },
        ]);
        expect(result).toEqual([{ filePath: 'src/a.ts' }]);
    });

    it('returns all files when no duplicates exist', () => {
        const files = [{ filePath: 'a.ts' }, { filePath: 'b.ts' }];
        const result = deduplicateReferenceFiles('plan.md', files);
        expect(result).toEqual(files);
    });

    it('handles undefined files', () => {
        expect(deduplicateReferenceFiles('plan.md', undefined)).toEqual([]);
    });

    it('handles undefined planPath', () => {
        const files = [{ filePath: 'a.ts' }];
        expect(deduplicateReferenceFiles(undefined, files)).toEqual(files);
    });

    it('handles both undefined', () => {
        expect(deduplicateReferenceFiles(undefined, undefined)).toEqual([]);
    });
});

// ---------------------------------------------------------------------------
// ReferenceList component rendering
// ---------------------------------------------------------------------------

describe('ReferenceList', () => {
    it('renders planPath and non-duplicate files', () => {
        const { container } = render(
            <ReferenceList
                planPath="src/plan.md"
                files={[
                    { filePath: 'src/plan.md' },
                    { filePath: 'src/other.ts' },
                ]}
            />,
        );
        // Top-level spans: one for planPath, one for "other.ts" (duplicate "plan.md" filtered)
        const topSpans = container.querySelectorAll(':scope > span');
        expect(topSpans).toHaveLength(2);
    });

    it('renders only planPath when all files are duplicates of it', () => {
        const { container } = render(
            <ReferenceList
                planPath="src/plan.md"
                files={[{ filePath: 'src\\plan.md' }]}
            />,
        );
        const topSpans = container.querySelectorAll(':scope > span');
        expect(topSpans).toHaveLength(1);
    });

    it('deduplicates internal file duplicates', () => {
        const { container } = render(
            <ReferenceList
                files={[
                    { filePath: 'src/a.ts' },
                    { filePath: 'src/b.ts' },
                    { filePath: 'src/a.ts' },
                ]}
            />,
        );
        const spans = container.querySelectorAll(':scope > span');
        expect(spans).toHaveLength(2);
    });

    it('renders nothing when no planPath and no files', () => {
        const { container } = render(<ReferenceList />);
        expect(container.innerHTML).toBe('');
    });
});
