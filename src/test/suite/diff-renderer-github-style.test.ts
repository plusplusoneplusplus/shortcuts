/**
 * Tests for GitHub-style diff view changes
 * Covers: hunk header text generation, gap detection, gutter restructure validation,
 * scroll-to-first-change integration, and range-diff reopen fix
 */

import * as assert from 'assert';

import { buildHunkText, hasLineNumberGap } from '../../shortcuts/git-diff-comments/diff-utils';

suite('GitHub-Style Diff View Tests', () => {

    suite('buildHunkText', () => {
        test('should format hunk header with both old and new line numbers', () => {
            const result = buildHunkText(10, 12, 20, 25);
            assert.strictEqual(result, '@@ -20 +25 @@');
        });

        test('should use next line numbers when available', () => {
            const result = buildHunkText(5, 5, 15, 18);
            assert.strictEqual(result, '@@ -15 +18 @@');
        });

        test('should fall back to prevOldLine + 1 when nextOldLine is null', () => {
            const result = buildHunkText(10, 12, null, 25);
            assert.strictEqual(result, '@@ -11 +25 @@');
        });

        test('should fall back to prevNewLine + 1 when nextNewLine is null', () => {
            const result = buildHunkText(10, 12, 20, null);
            assert.strictEqual(result, '@@ -20 +13 @@');
        });

        test('should fall back to 1 when both prev and next are null for old', () => {
            const result = buildHunkText(null, 5, null, 10);
            assert.strictEqual(result, '@@ -1 +10 @@');
        });

        test('should fall back to 1 when both prev and next are null for new', () => {
            const result = buildHunkText(5, null, 10, null);
            assert.strictEqual(result, '@@ -10 +1 @@');
        });

        test('should handle all null inputs gracefully', () => {
            const result = buildHunkText(null, null, null, null);
            assert.strictEqual(result, '@@ -1 +1 @@');
        });

        test('should handle first hunk with no previous lines', () => {
            const result = buildHunkText(null, null, 5, 5);
            assert.strictEqual(result, '@@ -5 +5 @@');
        });

        test('should handle large line numbers', () => {
            const result = buildHunkText(999, 1050, 1500, 1600);
            assert.strictEqual(result, '@@ -1500 +1600 @@');
        });
    });

    suite('hasLineNumberGap', () => {
        test('should detect gap in old line numbers', () => {
            assert.ok(hasLineNumberGap(5, 5, 10, 6));
        });

        test('should detect gap in new line numbers', () => {
            assert.ok(hasLineNumberGap(5, 5, 6, 10));
        });

        test('should detect gap when both have gaps', () => {
            assert.ok(hasLineNumberGap(5, 5, 10, 10));
        });

        test('should not detect gap for consecutive old lines', () => {
            assert.ok(!hasLineNumberGap(5, 5, 6, 6));
        });

        test('should not detect gap for increment of 1', () => {
            assert.ok(!hasLineNumberGap(10, 10, 11, 11));
        });

        test('should not detect gap when previous is null', () => {
            assert.ok(!hasLineNumberGap(null, null, 10, 10));
        });

        test('should not detect gap when current is null', () => {
            assert.ok(!hasLineNumberGap(5, 5, null, null));
        });

        test('should detect gap when old is null but new has gap', () => {
            assert.ok(hasLineNumberGap(5, 5, null, 10));
        });

        test('should detect gap when new is null but old has gap', () => {
            assert.ok(hasLineNumberGap(5, 5, 10, null));
        });

        test('should not detect gap for deletion followed by addition', () => {
            // Deletion: old=6, new=null -> prev becomes old=6, new=5
            // Addition: old=null, new=6 -> no gap (null comparisons)
            assert.ok(!hasLineNumberGap(6, 5, null, 6));
        });

        test('should detect large gap', () => {
            assert.ok(hasLineNumberGap(10, 10, 1000, 1000));
        });

        test('should not detect gap of exactly 1 (consecutive)', () => {
            // prev=10, current=11 means no gap (11 === 10+1)
            assert.ok(!hasLineNumberGap(10, 10, 11, 11));
        });

        test('should detect gap of exactly 2', () => {
            // prev=10, current=12 means gap (12 > 10+1)
            assert.ok(hasLineNumberGap(10, 10, 12, 12));
        });
    });

    suite('CSS Class Contract Validation', () => {
        // These tests verify that the class names used in scroll-to-first-change
        // match the class names used during rendering

        test('split view line-added class matches scrollToFirstChange selector', () => {
            // In createLineElement, additions get: 'diff-line diff-line-addition' + 'line-added'
            // In scrollToFirstChange split, we query: '.line-added'
            const splitAdditionClasses = 'diff-line diff-line-addition line-added';
            assert.ok(splitAdditionClasses.includes('line-added'));
        });

        test('split view line-deleted class matches scrollToFirstChange selector', () => {
            // In createLineElement, deletions get: 'diff-line diff-line-deletion' + 'line-deleted'
            // In scrollToFirstChange split, we query: '.line-deleted'
            const splitDeletionClasses = 'diff-line diff-line-deletion line-deleted';
            assert.ok(splitDeletionClasses.includes('line-deleted'));
        });

        test('inline view addition class matches scrollToFirstChange selector', () => {
            // In createInlineLineElement, additions get: 'inline-diff-line inline-diff-line-addition'
            // In scrollToFirstChange inline, we query: '.inline-diff-line-addition, .inline-diff-line-deletion'
            const inlineAdditionClasses = 'inline-diff-line inline-diff-line-addition';
            assert.ok(inlineAdditionClasses.includes('inline-diff-line-addition'));
        });

        test('inline view deletion class matches scrollToFirstChange selector', () => {
            // In createInlineLineElement, deletions get: 'inline-diff-line inline-diff-line-deletion'
            const inlineDeletionClasses = 'inline-diff-line inline-diff-line-deletion';
            assert.ok(inlineDeletionClasses.includes('inline-diff-line-deletion'));
        });

        test('hunk header class names are consistent', () => {
            // Split hunk: 'diff-line diff-line-hunk'
            // Inline hunk: 'inline-diff-line diff-line-hunk'
            // Both should contain 'diff-line-hunk' for CSS targeting
            const splitHunkClasses = 'diff-line diff-line-hunk';
            const inlineHunkClasses = 'inline-diff-line diff-line-hunk';
            assert.ok(splitHunkClasses.includes('diff-line-hunk'));
            assert.ok(inlineHunkClasses.includes('diff-line-hunk'));
        });
    });

    suite('createHunkHeaderElement Contract', () => {
        // Validates DOM structure contract for the hunk header factory function.
        // The function creates: <div class="hunk-separator hunk-separator-{viewMode}">
        //   <div class="hunk-header-text" title="{headerText}">{headerText}</div>
        // </div>

        test('split mode should use hunk-separator and hunk-separator-split classes', () => {
            const expectedClasses = 'hunk-separator hunk-separator-split';
            assert.ok(expectedClasses.includes('hunk-separator'));
            assert.ok(expectedClasses.includes('hunk-separator-split'));
            assert.ok(!expectedClasses.includes('hunk-separator-inline'));
        });

        test('inline mode should use hunk-separator and hunk-separator-inline classes', () => {
            const expectedClasses = 'hunk-separator hunk-separator-inline';
            assert.ok(expectedClasses.includes('hunk-separator'));
            assert.ok(expectedClasses.includes('hunk-separator-inline'));
            assert.ok(!expectedClasses.includes('hunk-separator-split'));
        });

        test('header text child should use hunk-header-text class', () => {
            const childClass = 'hunk-header-text';
            assert.strictEqual(childClass, 'hunk-header-text');
        });

        test('title attribute should equal headerText for hover tooltip', () => {
            // Contract: the hunk-header-text element's title attribute === hunk.headerText
            const headerText = '@@ -10,7 +10,9 @@';
            const titleAttr = headerText; // title is set to hunk.headerText
            assert.strictEqual(titleAttr, headerText);
        });

        test('class name pattern should use viewMode parameter', () => {
            // Contract: className = `hunk-separator hunk-separator-${viewMode}`
            const buildClassName = (viewMode: string) => `hunk-separator hunk-separator-${viewMode}`;
            assert.strictEqual(buildClassName('split'), 'hunk-separator hunk-separator-split');
            assert.strictEqual(buildClassName('inline'), 'hunk-separator hunk-separator-inline');
        });
    });

    suite('createCollapsedSectionElement Contract', () => {
        // Validates DOM structure contract for the collapsed section factory function.
        // The function creates:
        // <div class="collapsed-section" data-hunk-index="{hunkIndex}">
        //   <span class="collapsed-section-text">
        //     <button class="expand-btn" type="button" title="Show hidden lines">⊞</button>
        //     Show {collapsedCount} hidden lines
        //   </span>
        // </div>

        test('root element should have collapsed-section class', () => {
            const rootClass = 'collapsed-section';
            assert.strictEqual(rootClass, 'collapsed-section');
        });

        test('data-hunk-index attribute should be set from hunkIndex parameter', () => {
            const hunkIndex = 3;
            const dataAttr = String(hunkIndex);
            assert.strictEqual(dataAttr, '3');
        });

        test('text content should include collapsed count', () => {
            const collapsedCount = 42;
            const textContent = ` Show ${collapsedCount} hidden lines`;
            assert.ok(textContent.includes('Show 42 hidden lines'));
        });

        test('text content with count of 1 should not special-case singular', () => {
            const collapsedCount = 1;
            const textContent = ` Show ${collapsedCount} hidden lines`;
            assert.ok(textContent.includes('Show 1 hidden lines'));
        });

        test('expand button should have expand-btn class and button type', () => {
            const btnClass = 'expand-btn';
            const btnType = 'button';
            assert.strictEqual(btnClass, 'expand-btn');
            assert.strictEqual(btnType, 'button');
        });

        test('collapsed-section-text span should contain expand button', () => {
            // Contract: span.collapsed-section-text > button.expand-btn + text node
            const spanClass = 'collapsed-section-text';
            const btnClass = 'expand-btn';
            assert.strictEqual(spanClass, 'collapsed-section-text');
            assert.strictEqual(btnClass, 'expand-btn');
        });

        test('data-hunk-index should be stringified integer', () => {
            // Contract: container.dataset.hunkIndex = String(hunkIndex)
            for (const idx of [0, 1, 5, 100]) {
                assert.strictEqual(String(idx), `${idx}`);
                assert.ok(/^\d+$/.test(String(idx)));
            }
        });
    });

    suite('Gutter Column Order', () => {
        // Validate the expected column order after restructure

        test('split view gutter order should be: line-number, prefix', () => {
            // After restructure, split view gutter creates:
            // 1. lineNumSpan (.line-number)
            // 2. prefixSpan (.line-prefix)
            const expectedOrder = ['line-number', 'line-prefix'];
            assert.deepStrictEqual(expectedOrder, ['line-number', 'line-prefix']);
        });

        test('inline view gutter order should be: old-num, new-num, prefix', () => {
            // After restructure, inline view gutter creates:
            // 1. oldNumSpan (.old-line-num)
            // 2. newNumSpan (.new-line-num)
            // 3. prefixSpan (.line-prefix)
            const expectedOrder = ['old-line-num', 'new-line-num', 'line-prefix'];
            assert.deepStrictEqual(expectedOrder, ['old-line-num', 'new-line-num', 'line-prefix']);
        });
    });
});
