/**
 * AC-02: classification-driven hunk collapse in UnifiedDiffViewer.
 *
 * When the trio (filePath, getHunkClassification, activeFilters) is
 * provided, hunks whose category is not in activeFilters collapse into a
 * single compact summary row instead of disappearing. Reviewers can
 * expand an individual collapsed hunk without resetting filters, and
 * setting activeFilters back to all four categories ("Show all") restores
 * everything.
 */

import { describe, it, expect } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import {
    UnifiedDiffViewer,
    computeHunkRanges,
    computeDiffLines,
} from '../../../../src/server/spa/client/react/features/git/diff/UnifiedDiffViewer';
import type {
    HunkCategory,
    HunkClassification,
} from '../../../../src/server/spa/client/react/features/pull-requests/classification-types';
import { HUNK_CATEGORIES } from '../../../../src/server/spa/client/react/features/pull-requests/classification-types';

const TWO_HUNK_DIFF = `diff --git a/foo.ts b/foo.ts
index 0000000..1111111 100644
--- a/foo.ts
+++ b/foo.ts
@@ -1,2 +1,2 @@
-old logic
+new logic
 ctx
@@ -10,2 +10,3 @@
 ctx
+generated 1
+generated 2`;

const HUNKS: HunkClassification[] = [
    { file: 'foo.ts', hunkIndex: 0, category: 'logic', intensity: 'high', reason: 'Touches core logic path' },
    { file: 'foo.ts', hunkIndex: 1, category: 'generated', intensity: 'low', reason: 'Generated boilerplate' },
];

function makeGetHunkClassification() {
    return (file: string, idx: number): HunkClassification | undefined => {
        return HUNKS.find(h => h.file === file && h.hunkIndex === idx);
    };
}

describe('computeHunkRanges', () => {
    it('returns one range per @@ header with correct geometry and changed-line counts', () => {
        const lines = TWO_HUNK_DIFF.split('\n');
        const diffLines = computeDiffLines(lines);
        const ranges = computeHunkRanges(diffLines, 'foo.ts', makeGetHunkClassification());
        expect(ranges).toHaveLength(2);
        expect(ranges[0].hunkIndex).toBe(0);
        expect(ranges[0].changedLines).toBe(2); // -old +new
        expect(ranges[0].classification?.category).toBe('logic');
        expect(ranges[1].hunkIndex).toBe(1);
        expect(ranges[1].changedLines).toBe(2); // 2 generated +
        expect(ranges[1].classification?.category).toBe('generated');
    });

    it('returns empty list when diff has no hunks', () => {
        const ranges = computeHunkRanges(computeDiffLines(['diff --git a/x b/x']), 'x', makeGetHunkClassification());
        expect(ranges).toHaveLength(0);
    });
});

describe('UnifiedDiffViewer — AC-02 hunk collapse', () => {
    it('renders all hunks normally when filters include every category', () => {
        render(
            <UnifiedDiffViewer
                diff={TWO_HUNK_DIFF}
                fileName="foo.ts"
                filePath="foo.ts"
                getHunkClassification={makeGetHunkClassification()}
                activeFilters={new Set<HunkCategory>(HUNK_CATEGORIES)}
            />,
        );
        expect(screen.queryAllByTestId('collapsed-hunk-summary')).toHaveLength(0);
    });

    it('collapses hunks whose category is not in activeFilters into summary rows', () => {
        // Only "logic" active → the generated hunk should collapse.
        render(
            <UnifiedDiffViewer
                diff={TWO_HUNK_DIFF}
                fileName="foo.ts"
                filePath="foo.ts"
                getHunkClassification={makeGetHunkClassification()}
                activeFilters={new Set<HunkCategory>(['logic'])}
            />,
        );
        const summaries = screen.getAllByTestId('collapsed-hunk-summary');
        expect(summaries).toHaveLength(1);
        const row = summaries[0];
        expect(row).toHaveTextContent('Generated');
        expect(row).toHaveTextContent('low');
        expect(row).toHaveTextContent('Generated boilerplate');
        expect(row).toHaveTextContent('~2');
        expect(row.querySelector('[data-testid="collapsed-hunk-expand"]')).not.toBeNull();
        // Generated hunk body should be hidden.
        expect(screen.queryByText('+generated 1')).toBeNull();
    });

    it('expand button restores a single collapsed hunk without affecting others', () => {
        // Both logic and generated filtered out → both collapse.
        render(
            <UnifiedDiffViewer
                diff={TWO_HUNK_DIFF}
                fileName="foo.ts"
                filePath="foo.ts"
                getHunkClassification={makeGetHunkClassification()}
                activeFilters={new Set<HunkCategory>(['mechanical'])}
            />,
        );
        let summaries = screen.getAllByTestId('collapsed-hunk-summary');
        expect(summaries).toHaveLength(2);
        // Expand the first collapsed hunk (logic).
        const firstExpand = summaries[0].querySelector<HTMLButtonElement>('[data-testid="collapsed-hunk-expand"]')!;
        act(() => { fireEvent.click(firstExpand); });
        summaries = screen.queryAllByTestId('collapsed-hunk-summary');
        // Logic hunk is now expanded; only the generated summary remains.
        expect(summaries).toHaveLength(1);
        expect(summaries[0]).toHaveTextContent('Generated');
    });

    it('does not collapse anything when classification props are omitted', () => {
        render(<UnifiedDiffViewer diff={TWO_HUNK_DIFF} fileName="foo.ts" />);
        expect(screen.queryAllByTestId('collapsed-hunk-summary')).toHaveLength(0);
    });

    it('Show all (activeFilters → every category) clears per-hunk expand overrides', () => {
        // Driver: a wrapper that flips activeFilters between {mechanical} and {all}.
        // After the user expands one hunk under the restricted filter, switching
        // to "all" must re-collapse-able again by reapplying the restricted
        // filter — i.e. the override is gone. We verify by transitioning
        // restricted → all → restricted and checking both hunks collapse again.
        function Harness() {
            const [allOn, setAllOn] = useState(false);
            const activeFilters = allOn
                ? new Set<HunkCategory>(HUNK_CATEGORIES)
                : new Set<HunkCategory>(['mechanical']);
            return (
                <div>
                    <button data-testid="toggle-all" onClick={() => setAllOn(v => !v)}>toggle</button>
                    <UnifiedDiffViewer
                        diff={TWO_HUNK_DIFF}
                        fileName="foo.ts"
                        filePath="foo.ts"
                        getHunkClassification={makeGetHunkClassification()}
                        activeFilters={activeFilters}
                    />
                </div>
            );
        }
        render(<Harness />);
        // Restricted filter: both hunks collapsed.
        let summaries = screen.getAllByTestId('collapsed-hunk-summary');
        expect(summaries).toHaveLength(2);
        // Expand the logic hunk.
        const firstExpand = summaries[0].querySelector<HTMLButtonElement>('[data-testid="collapsed-hunk-expand"]')!;
        act(() => { fireEvent.click(firstExpand); });
        expect(screen.queryAllByTestId('collapsed-hunk-summary')).toHaveLength(1);
        // Show all → no collapsed rows.
        act(() => { fireEvent.click(screen.getByTestId('toggle-all')); });
        expect(screen.queryAllByTestId('collapsed-hunk-summary')).toHaveLength(0);
        // Back to restricted filter → expand override should have been cleared,
        // so both hunks collapse again.
        act(() => { fireEvent.click(screen.getByTestId('toggle-all')); });
        expect(screen.getAllByTestId('collapsed-hunk-summary')).toHaveLength(2);
    });
});
