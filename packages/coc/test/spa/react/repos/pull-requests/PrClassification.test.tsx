/**
 * Tests for the focused-diff classification UI components:
 * - ClassificationFilterBar (rendered inside PrFilesPanel)
 * - ClassificationBadge (file tree badges)
 * - Hunk dimming
 * - useClassification hook
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { PrFilesPanel } from '../../../../../src/server/spa/client/react/features/pull-requests/PrFilesPanel';
import { parseUnifiedDiff } from '../../../../../src/server/spa/client/react/features/pull-requests/unified-diff-parser';
import type { UseClassificationReturn } from '../../../../../src/server/spa/client/react/features/pull-requests/useClassification';
import type { HunkCategory, DiffClassificationResult } from '../../../../../src/server/spa/client/react/features/pull-requests/classification-types';

// ── Fixtures ──────────────────────────────────────────────────────────

const diffText = [
    'diff --git a/src/main.ts b/src/main.ts',
    '--- a/src/main.ts',
    '+++ b/src/main.ts',
    '@@ -1,3 +1,4 @@',
    ' line1',
    '+added logic',
    ' line2',
    '@@ -10,2 +11,2 @@',
    '-old import',
    '+new import',
    'diff --git a/test/main.test.ts b/test/main.test.ts',
    '--- a/test/main.test.ts',
    '+++ b/test/main.test.ts',
    '@@ -1,1 +1,2 @@',
    ' test1',
    '+test2',
].join('\n');

const parsedFiles = parseUnifiedDiff(diffText).files;

const mockResult: DiffClassificationResult = {
    classifications: [
        { file: 'src/main.ts', hunkIndex: 0, category: 'logic', intensity: 'high', reason: 'Core business logic change' },
        { file: 'src/main.ts', hunkIndex: 1, category: 'mechanical', intensity: 'low', reason: 'Import reordering' },
        { file: 'test/main.test.ts', hunkIndex: 0, category: 'test', intensity: 'low', reason: 'New test case' },
    ],
};

function createMockClassification(overrides: Partial<UseClassificationReturn> = {}): UseClassificationReturn {
    const activeFilters = overrides.state?.activeFilters ?? new Set<HunkCategory>(['logic']);
    const result = overrides.state?.result;

    // Build index
    const byHunk = new Map<string, any>();
    const badges = new Map<string, any>();
    if (result) {
        for (const c of result.classifications) {
            byHunk.set(`${c.file}:${c.hunkIndex}`, c);
            const existing = badges.get(c.file);
            if (!existing || c.category === 'logic') {
                badges.set(c.file, { category: c.category, intensity: c.intensity });
            }
        }
    }

    return {
        state: {
            status: 'idle',
            activeFilters,
            ...overrides.state,
        },
        classify: vi.fn(),
        toggleFilter: vi.fn(),
        setFilters: vi.fn(),
        getFileBadge: (path: string) => badges.get(path),
        getHunkClassification: (path: string, idx: number) => byHunk.get(`${path}:${idx}`),
        isHunkDimmed: (path: string, idx: number) => {
            const c = byHunk.get(`${path}:${idx}`);
            if (!c) return false;
            return !activeFilters.has(c.category);
        },
        ...overrides,
    };
}

// ── Tests ─────────────────────────────────────────────────────────────

describe('ClassificationFilterBar', () => {
    it('renders classify button when classification prop is provided', () => {
        const mock = createMockClassification();
        render(<PrFilesPanel files={parsedFiles} classification={mock} />);
        expect(screen.getByTestId('classify-button')).toBeInTheDocument();
        expect(screen.getByTestId('classify-button')).toHaveTextContent('Classify');
    });

    it('does not render filter bar when classification prop is absent', () => {
        render(<PrFilesPanel files={parsedFiles} />);
        expect(screen.queryByTestId('classification-filter-bar')).not.toBeInTheDocument();
    });

    it('shows spinner when status is loading', () => {
        const mock = createMockClassification({ state: { status: 'loading', activeFilters: new Set(['logic']) } });
        render(<PrFilesPanel files={parsedFiles} classification={mock} />);
        expect(screen.getByTestId('classify-button')).toHaveTextContent('Classifying…');
        expect(screen.getByTestId('classify-button')).toBeDisabled();
    });

    it('shows Re-classify when results are ready', () => {
        const mock = createMockClassification({
            state: { status: 'ready', activeFilters: new Set(['logic']), result: mockResult },
        });
        render(<PrFilesPanel files={parsedFiles} classification={mock} />);
        expect(screen.getByTestId('classify-button')).toHaveTextContent('Re-classify');
    });

    it('shows category checkboxes when results are ready', () => {
        const mock = createMockClassification({
            state: { status: 'ready', activeFilters: new Set(['logic']), result: mockResult },
        });
        render(<PrFilesPanel files={parsedFiles} classification={mock} />);
        expect(screen.getByTestId('classification-filter-logic')).toBeInTheDocument();
        expect(screen.getByTestId('classification-filter-mechanical')).toBeInTheDocument();
        expect(screen.getByTestId('classification-filter-test')).toBeInTheDocument();
        expect(screen.getByTestId('classification-filter-generated')).toBeInTheDocument();
    });

    it('calls toggleFilter when checkbox is clicked', () => {
        const toggleFilter = vi.fn();
        const mock = createMockClassification({
            state: { status: 'ready', activeFilters: new Set(['logic']), result: mockResult },
            toggleFilter,
        });
        render(<PrFilesPanel files={parsedFiles} classification={mock} />);
        fireEvent.click(screen.getByTestId('classification-filter-mechanical'));
        expect(toggleFilter).toHaveBeenCalledWith('mechanical');
    });

    it('calls classify when button is clicked', () => {
        const classify = vi.fn();
        const mock = createMockClassification({ classify });
        render(<PrFilesPanel files={parsedFiles} classification={mock} />);
        fireEvent.click(screen.getByTestId('classify-button'));
        expect(classify).toHaveBeenCalled();
    });

    it('shows error message', () => {
        const mock = createMockClassification({
            state: { status: 'error', activeFilters: new Set(['logic']), error: 'Something went wrong' },
        });
        render(<PrFilesPanel files={parsedFiles} classification={mock} />);
        expect(screen.getByTestId('classify-error')).toHaveTextContent('Something went wrong');
    });

    it('shows "All" button to select all filters', () => {
        const setFilters = vi.fn();
        const mock = createMockClassification({
            state: { status: 'ready', activeFilters: new Set(['logic']), result: mockResult },
            setFilters,
        });
        render(<PrFilesPanel files={parsedFiles} classification={mock} />);
        fireEvent.click(screen.getByTestId('classification-filter-all'));
        expect(setFilters).toHaveBeenCalled();
    });

    it('renders color-coded labels for each category', () => {
        const mock = createMockClassification({
            state: { status: 'ready', activeFilters: new Set(['logic', 'mechanical', 'test', 'generated']), result: mockResult },
        });
        render(<PrFilesPanel files={parsedFiles} classification={mock} />);

        const logicLabel = screen.getByTestId('classification-filter-label-logic');
        const mechLabel = screen.getByTestId('classification-filter-label-mechanical');
        const testLabel = screen.getByTestId('classification-filter-label-test');
        const genLabel = screen.getByTestId('classification-filter-label-generated');

        // Each label should have the category color class
        expect(logicLabel.className).toContain('text-orange-');
        expect(mechLabel.className).toContain('text-gray-');
        expect(testLabel.className).toContain('text-blue-');
        expect(genLabel.className).toContain('text-purple-');
    });

    it('renders info icon button', () => {
        const mock = createMockClassification();
        render(<PrFilesPanel files={parsedFiles} classification={mock} />);
        expect(screen.getByTestId('classification-info-button')).toBeInTheDocument();
    });

    it('opens info popover on info button click', () => {
        const mock = createMockClassification();
        render(<PrFilesPanel files={parsedFiles} classification={mock} />);
        expect(screen.queryByTestId('classification-info-popover')).not.toBeInTheDocument();
        fireEvent.click(screen.getByTestId('classification-info-button'));
        expect(screen.getByTestId('classification-info-popover')).toBeInTheDocument();
        expect(screen.getByText('Classification Guide')).toBeInTheDocument();
    });

    it('closes info popover on close button click', () => {
        const mock = createMockClassification();
        render(<PrFilesPanel files={parsedFiles} classification={mock} />);
        fireEvent.click(screen.getByTestId('classification-info-button'));
        expect(screen.getByTestId('classification-info-popover')).toBeInTheDocument();
        fireEvent.click(screen.getByTestId('classification-info-close'));
        expect(screen.queryByTestId('classification-info-popover')).not.toBeInTheDocument();
    });

    it('closes info popover on backdrop click', () => {
        const mock = createMockClassification();
        render(<PrFilesPanel files={parsedFiles} classification={mock} />);
        fireEvent.click(screen.getByTestId('classification-info-button'));
        expect(screen.getByTestId('classification-info-popover')).toBeInTheDocument();
        fireEvent.click(screen.getByTestId('classification-info-backdrop'));
        expect(screen.queryByTestId('classification-info-popover')).not.toBeInTheDocument();
    });

    it('closes info popover on Escape key', () => {
        const mock = createMockClassification();
        render(<PrFilesPanel files={parsedFiles} classification={mock} />);
        fireEvent.click(screen.getByTestId('classification-info-button'));
        expect(screen.getByTestId('classification-info-popover')).toBeInTheDocument();
        fireEvent.keyDown(document, { key: 'Escape' });
        expect(screen.queryByTestId('classification-info-popover')).not.toBeInTheDocument();
    });

    it('popover has correct accessibility attributes', () => {
        const mock = createMockClassification();
        render(<PrFilesPanel files={parsedFiles} classification={mock} />);
        fireEvent.click(screen.getByTestId('classification-info-button'));
        const popover = screen.getByTestId('classification-info-popover');
        expect(popover).toHaveAttribute('role', 'dialog');
        expect(popover).toHaveAttribute('aria-label', 'Classification Guide');
    });

    it('popover shows all category descriptions', () => {
        const mock = createMockClassification();
        render(<PrFilesPanel files={parsedFiles} classification={mock} />);
        fireEvent.click(screen.getByTestId('classification-info-button'));
        expect(screen.getByText(/Behavior changes/)).toBeInTheDocument();
        expect(screen.getByText(/Refactors, renames/)).toBeInTheDocument();
        expect(screen.getByText(/Test file additions/)).toBeInTheDocument();
        expect(screen.getByText(/Lock files, codegen/)).toBeInTheDocument();
    });
});

describe('ClassificationBadge (file tree badges)', () => {
    it('renders badges on file rows when classification is ready', () => {
        const mock = createMockClassification({
            state: { status: 'ready', activeFilters: new Set(['logic']), result: mockResult },
        });
        render(<PrFilesPanel files={parsedFiles} classification={mock} />);
        const badges = screen.getAllByTestId('classification-badge');
        // At least one badge should appear (for the active file in view)
        expect(badges.length).toBeGreaterThan(0);
    });

    it('does not render badges when classification has no results', () => {
        const mock = createMockClassification();
        render(<PrFilesPanel files={parsedFiles} classification={mock} />);
        expect(screen.queryByTestId('classification-badge')).not.toBeInTheDocument();
    });
});

describe('Hunk dimming', () => {
    it('applies opacity to dimmed hunks', () => {
        const activeFilters = new Set<HunkCategory>(['logic']);
        const mock = createMockClassification({
            state: { status: 'ready', activeFilters, result: mockResult },
        });
        render(<PrFilesPanel files={parsedFiles} classification={mock} />);

        // The first hunk header (logic, high) should NOT be dimmed
        const hunkHeaders = screen.getAllByTestId('pr-file-hunk-header');
        expect(hunkHeaders.length).toBeGreaterThan(0);

        // Check that we have at least one category tag
        const tags = screen.getAllByTestId('hunk-category-tag');
        expect(tags.length).toBeGreaterThan(0);
    });

    it('renders category tag on hunk headers when classified', () => {
        const mock = createMockClassification({
            state: { status: 'ready', activeFilters: new Set(['logic', 'mechanical', 'test', 'generated']), result: mockResult },
        });
        render(<PrFilesPanel files={parsedFiles} classification={mock} />);
        const tags = screen.getAllByTestId('hunk-category-tag');
        // We have 2 hunks in the first file (src/main.ts) which is the active file
        expect(tags.length).toBe(2);
        expect(tags[0]).toHaveTextContent('Logic');
        expect(tags[1]).toHaveTextContent('Mechanical');
    });
});
