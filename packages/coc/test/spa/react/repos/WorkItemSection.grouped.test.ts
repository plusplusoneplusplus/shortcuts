/**
 * Tests for WorkItemSection — grouped endpoint and per-status infinite scroll.
 *
 * Verifies the component uses the grouped API endpoint, IntersectionObserver
 * for per-status auto-loading, and no "Load more" button.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const SRC_PATH = path.join(
    __dirname,
    '..', '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'features', 'work-items', 'WorkItemSection.tsx',
);

describe('WorkItemSection — grouped endpoint and infinite scroll', () => {
    let src: string;

    beforeEach(() => {
        src = fs.readFileSync(SRC_PATH, 'utf-8');
    });

    it('fetches from grouped endpoint for initial load', () => {
        expect(src).toContain('/work-items/grouped');
    });

    it('dispatches SET_GROUPED_WORK_ITEMS on initial fetch', () => {
        expect(src).toContain("type: 'SET_GROUPED_WORK_ITEMS'");
    });

    it('dispatches APPEND_STATUS_ITEMS for per-status load more', () => {
        expect(src).toContain("type: 'APPEND_STATUS_ITEMS'");
    });

    it('uses IntersectionObserver for auto-loading', () => {
        expect(src).toContain('IntersectionObserver');
    });

    it('has a StatusGroupSentinel component', () => {
        expect(src).toContain('StatusGroupSentinel');
    });

    it('sentinel uses rootMargin for early triggering', () => {
        expect(src).toContain("rootMargin: '200px'");
    });

    it('does not have a Load more button', () => {
        expect(src).not.toContain('work-items-load-more');
        expect(src).not.toContain('handleLoadMore');
    });

    it('has per-status sentinel test IDs', () => {
        expect(src).toContain('work-items-sentinel-');
    });

    it('uses per-status pagination from context', () => {
        expect(src).toContain('pagination?.[status]');
    });

    it('shows per-group total count in badge', () => {
        // Badge should show statusTotal (from pagination), not just loaded group.length
        expect(src).toContain('statusTotal');
    });

    it('loads more for a specific status using flat endpoint with status filter', () => {
        // The load-more function should use the flat endpoint with status query param
        expect(src).toContain("params.set('status', status)");
    });

    it('guards against concurrent loads per status', () => {
        expect(src).toContain('loadingStatusesRef');
    });

    it('cleans up IntersectionObserver on unmount', () => {
        expect(src).toContain('observer.disconnect()');
    });

    it('passes search query to both grouped and flat endpoints', () => {
        // Both fetchGroupedWorkItems and loadMoreForStatus should support search
        const groupedFetchMatch = src.includes("params.set('q', query)");
        const loadMoreMatch = src.includes("params.set('q', searchQuery)");
        expect(groupedFetchMatch).toBe(true);
        expect(loadMoreMatch).toBe(true);
    });

    it('re-fetches grouped data when search query changes', () => {
        expect(src).toContain('prevSearchRef.current !== searchQuery');
        expect(src).toContain('fetchGroupedWorkItems(searchQuery');
    });

    it('renders sentinel only when group has more items', () => {
        // StatusGroupSentinel should check hasMore
        expect(src).toContain('if (!hasMore) return null');
    });
});
