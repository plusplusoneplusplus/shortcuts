/**
 * @vitest-environment jsdom
 *
 * Tests for the shared compact checks renderer (AC-03 — CI checks display).
 *
 * Covers:
 *   - summarizeCheckRows: correct per-bucket counts for a mixed-state PR
 *     (passing / failing / pending / skipped + warning / cancelled / unknown,
 *     with `running` folding into `pending`); lossless `total`.
 *   - PrChecksCompact: a mixed-state PR shows the summary counts and per-check
 *     rows with working detail links (DoD #1/#2); empty / loading / error+retry.
 *   - checkStatusLabel is the single shared label fn (also used by PrChecksTable).
 */
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, within } from '@testing-library/react';
import {
    PrChecksCompact,
    summarizeCheckRows,
    checkStatusLabel,
    checkStatusEmoji,
} from '../../../../../src/server/spa/client/react/features/pull-requests/PrChecksSummary';
import type { PrCheckRow, CheckStatus } from '../../../../../src/server/spa/client/react/features/pull-requests/pr-derived-data';

function row(status: CheckStatus, overrides: Partial<PrCheckRow> = {}): PrCheckRow {
    return {
        id: overrides.id ?? `${status}-${Math.random().toString(36).slice(2, 7)}`,
        name: overrides.name ?? `check-${status}`,
        status,
        duration: overrides.duration ?? '',
        interpretation: overrides.interpretation ?? '',
        ...overrides,
    };
}

const MIXED_ROWS: PrCheckRow[] = [
    row('success', { id: 'c1', name: 'build', detailsUrl: 'https://ci/build' }),
    row('success', { id: 'c2', name: 'lint' }),
    row('failure', { id: 'c3', name: 'unit', detailsUrl: 'https://ci/unit' }),
    row('pending', { id: 'c4', name: 'e2e' }),
    row('running', { id: 'c5', name: 'integration' }),
    row('skipped', { id: 'c6', name: 'deploy' }),
    row('warning', { id: 'c7', name: 'coverage' }),
    row('cancelled', { id: 'c8', name: 'canary' }),
    row('unknown', { id: 'c9', name: 'mystery' }),
];

describe('summarizeCheckRows', () => {
    it('tallies a mixed-state PR into the right buckets (running folds into pending)', () => {
        expect(summarizeCheckRows(MIXED_ROWS)).toEqual({
            total: 9,
            passing: 2,
            failing: 1,
            pending: 2, // pending + running
            skipped: 1,
            warning: 1,
            cancelled: 1,
            unknown: 1,
        });
    });

    it('returns an all-zero summary for no rows', () => {
        expect(summarizeCheckRows([])).toEqual({
            total: 0, passing: 0, failing: 0, pending: 0, skipped: 0, warning: 0, cancelled: 0, unknown: 0,
        });
    });

    it('total equals the sum of the per-status buckets (lossless)', () => {
        const s = summarizeCheckRows(MIXED_ROWS);
        const sum = s.passing + s.failing + s.pending + s.skipped + s.warning + s.cancelled + s.unknown;
        expect(sum).toBe(s.total);
    });
});

describe('checkStatusLabel / checkStatusEmoji (shared with PrChecksTable)', () => {
    it('maps each status to a stable human label', () => {
        expect(checkStatusLabel('success')).toBe('Passed');
        expect(checkStatusLabel('failure')).toBe('Failed');
        expect(checkStatusLabel('pending')).toBe('Pending');
        expect(checkStatusLabel('running')).toBe('Running');
        expect(checkStatusLabel('skipped')).toBe('Skipped');
        expect(checkStatusLabel('warning')).toBe('Needs review');
        expect(checkStatusLabel('cancelled')).toBe('Cancelled');
        expect(checkStatusLabel('unknown')).toBe('Unknown');
    });

    it('returns a non-empty glyph for every status', () => {
        for (const status of ['success', 'failure', 'pending', 'running', 'skipped', 'warning', 'cancelled', 'unknown'] as CheckStatus[]) {
            expect(checkStatusEmoji(status).length).toBeGreaterThan(0);
        }
    });
});

describe('PrChecksCompact', () => {
    it('ready (mixed): renders summary counts and per-check rows with detail links (DoD #1/#2)', () => {
        const { getByTestId, getAllByTestId } = render(<PrChecksCompact state="ready" rows={MIXED_ROWS} />);

        // Summary chips for the non-zero buckets, each carrying its count.
        const summary = getByTestId('pr-checks-compact-summary');
        expect(within(summary).getByTestId('pr-checks-compact-count-passing').getAttribute('data-count')).toBe('2');
        expect(within(summary).getByTestId('pr-checks-compact-count-failing').getAttribute('data-count')).toBe('1');
        expect(within(summary).getByTestId('pr-checks-compact-count-pending').getAttribute('data-count')).toBe('2');
        expect(within(summary).getByTestId('pr-checks-compact-count-skipped').getAttribute('data-count')).toBe('1');
        expect(within(summary).getByTestId('pr-checks-compact-count-passing').textContent).toContain('2 passing');

        // One list row per check, with the check name.
        const rows = getAllByTestId('pr-checks-compact-row');
        expect(rows).toHaveLength(9);
        expect(rows.map(r => r.textContent).join(' ')).toContain('build');

        // Detail links open the provider's check page in a new tab.
        const links = getAllByTestId('pr-checks-compact-link') as HTMLAnchorElement[];
        expect(links).toHaveLength(2); // only the two rows with detailsUrl
        const buildLink = links.find(a => a.textContent === 'build')!;
        expect(buildLink.getAttribute('href')).toBe('https://ci/build');
        expect(buildLink.getAttribute('target')).toBe('_blank');
    });

    it('ready (empty): shows the "no checks reported" placeholder, no summary', () => {
        const { getByTestId, queryByTestId } = render(<PrChecksCompact state="ready" rows={[]} />);
        expect(getByTestId('pr-checks-compact-empty')).toBeTruthy();
        expect(queryByTestId('pr-checks-compact-summary')).toBeNull();
    });

    it('loading: shows a loading indicator', () => {
        const { getByTestId } = render(<PrChecksCompact state="loading" rows={[]} />);
        expect(getByTestId('pr-checks-compact-loading').textContent).toContain('Loading checks');
    });

    it('error: shows the message and a working retry', () => {
        const onRetry = vi.fn();
        const { getByTestId } = render(
            <PrChecksCompact state="error" rows={[]} error="checks unavailable" onRetry={onRetry} />,
        );
        expect(getByTestId('pr-checks-compact-error').textContent).toContain('checks unavailable');
        fireEvent.click(getByTestId('pr-checks-compact-retry'));
        expect(onRetry).toHaveBeenCalledTimes(1);
    });

    it('error: omits retry when no handler is given', () => {
        const { queryByTestId } = render(<PrChecksCompact state="error" rows={[]} error="boom" />);
        expect(queryByTestId('pr-checks-compact-retry')).toBeNull();
    });

    it('namespaces test ids via the testId prop', () => {
        const { getByTestId } = render(<PrChecksCompact state="ready" rows={MIXED_ROWS} testId="pr-checks-compact-x:1" />);
        expect(getByTestId('pr-checks-compact-x:1-summary')).toBeTruthy();
    });
});
