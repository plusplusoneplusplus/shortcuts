/**
 * @vitest-environment jsdom
 *
 * Mobile-parity render tests for PrStatusCard (AC-06 — same React card renders
 * correctly at the 375×812 mobile viewport: rows stay legible and the
 * expandable sections work with touch).
 *
 * The card is the SAME component the dashboard SPA and mobile both mount inside
 * `ConversationArea`, so "mobile parity" is verified by rendering under a 375px
 * viewport and asserting (a) the header cannot overflow (it wraps, controls stay
 * intact), (b) long titles/branches stay legible via truncation, (c) the CI
 * checks and collapse sections expand on tap, and (d) the auto-merge indicator
 * wraps rather than pushing the row past the viewport edge.
 *
 * `ConversationArea` clips horizontal overflow (`overflow-x-hidden`), so a header
 * that overflowed would be silently cut off on mobile — hence the wrap assertions.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, fireEvent, within } from '@testing-library/react';
import { mockViewport } from '../helpers/viewport-mock';
import {
    PrStatusCard,
    type PrStatusCardItem,
} from '../../../src/server/spa/client/react/features/chat/conversation/PrStatusCard';
import type { PrCheckRow, CheckStatus } from '../../../src/server/spa/client/react/features/pull-requests/pr-derived-data';

const MOBILE_WIDTH = 375;

let viewportCleanup: (() => void) | undefined;

afterEach(() => {
    viewportCleanup?.();
    viewportCleanup = undefined;
});

function readyItem(overrides: Partial<PrStatusCardItem> = {}): PrStatusCardItem {
    return {
        key: 'origin-1:101',
        repoId: 'ws-abc',
        number: 101,
        state: 'ready',
        pr: {
            number: 101,
            title: 'Add PR status card',
            status: 'open',
            sourceBranch: 'feature/card',
            targetBranch: 'main',
        },
        ...overrides,
    };
}

function checkRow(status: CheckStatus, name: string, overrides: Partial<PrCheckRow> = {}): PrCheckRow {
    return { id: `${name}-${status}`, name, status, duration: '', interpretation: '', ...overrides };
}

describe('PrStatusCard — mobile parity at 375px (AC-06)', () => {
    it('renders a collapsed card at a 375px viewport and expands from the top row', () => {
        viewportCleanup = mockViewport(MOBILE_WIDTH);
        const { getByTestId, queryByText } = render(<PrStatusCard items={[readyItem()]} />);
        const card = getByTestId('pr-status-card');
        expect(card).toBeTruthy();
        expect(card.textContent).toContain('1 pull request');
        expect(card.textContent).not.toContain('Add PR status card');
        expect(queryByText('Add PR status card')).toBeNull();

        fireEvent.click(getByTestId('pr-status-card-toggle'));
        expect(card.textContent).toContain('Add PR status card');
    });

    it('header wraps so the freshness label + refresh control cannot overflow off-screen', () => {
        viewportCleanup = mockViewport(MOBILE_WIDTH);
        const onRefresh = vi.fn();
        const { getByTestId } = render(
            // The overflow-prone case: count label + "updated …" + Refresh control all present.
            <PrStatusCard items={[readyItem()]} onRefresh={onRefresh} lastUpdatedAt={Date.now()} />,
        );

        // The header is the toggle's parent flex row; it must allow wrapping.
        const header = getByTestId('pr-status-card-toggle').parentElement!;
        expect(header.className).toContain('flex-wrap');

        // The control cluster stays intact as a unit (shrink-0) and is still present
        // (not clipped) alongside the freshness label.
        const refresh = getByTestId('pr-status-card-refresh');
        const cluster = refresh.parentElement!;
        expect(cluster.className).toContain('shrink-0');
        expect(getByTestId('pr-status-card-updated')).toBeTruthy();

        // The toggle can shrink rather than forcing horizontal overflow.
        expect(getByTestId('pr-status-card-toggle').className).toContain('min-w-0');
    });

    it('keeps a long title and long branches legible via truncation (no horizontal overflow)', () => {
        viewportCleanup = mockViewport(MOBILE_WIDTH);
        const item = readyItem({
            pr: {
                number: 101,
                title: 'A very long pull request title that would otherwise blow past the 375px mobile viewport width',
                status: 'open',
                sourceBranch: 'feature/a-really-long-source-branch-name-for-mobile',
                targetBranch: 'release/another-long-target-branch-name',
            },
        });
        const { getByTestId, getByTitle } = render(<PrStatusCard items={[item]} />);
        fireEvent.click(getByTestId('pr-status-card-toggle'));

        // Title truncates within a min-w-0 flex parent so it never pushes the row wider.
        const title = getByTitle(item.pr!.title);
        expect(title.className).toContain('truncate');
        expect(title.parentElement!.className).toContain('min-w-0');

        // Branch pair truncates; its meta line wraps so the auto-merge chip can drop below.
        const branches = getByTestId(`pr-status-card-branches-${item.key}`);
        expect(branches.className).toContain('truncate');
        expect(branches.parentElement!.className).toContain('flex-wrap');
    });

    it('CI checks section expands on tap at 375px and shows summary + per-check rows', () => {
        viewportCleanup = mockViewport(MOBILE_WIDTH);
        const onExpandChecks = vi.fn();
        const item = readyItem({
            checksState: 'ready',
            checks: [
                checkRow('success', 'build', { detailsUrl: 'https://ci/build' }),
                checkRow('failure', 'unit'),
                checkRow('pending', 'e2e'),
            ],
        });
        const { getByTestId } = render(<PrStatusCard items={[item]} onExpandChecks={onExpandChecks} />);
        fireEvent.click(getByTestId('pr-status-card-toggle'));

        // Collapsed by default — the panel is absent until tapped.
        expect(() => getByTestId(`pr-status-card-checks-${item.key}`)).toThrow();

        fireEvent.click(getByTestId(`pr-status-card-checks-toggle-${item.key}`));
        expect(onExpandChecks).toHaveBeenCalledWith(item.key);

        const panel = getByTestId(`pr-status-card-checks-${item.key}`);
        // Summary chips wrap (flex-wrap) and the per-check rows render — readable on mobile.
        const summary = within(panel).getByTestId(`pr-checks-compact-${item.key}-summary`);
        expect(summary.className).toContain('flex-wrap');
        expect(within(panel).getAllByTestId(`pr-checks-compact-${item.key}-row`)).toHaveLength(3);
    });

    it('auto-merge indicator stays on the wrapping meta line so it cannot overflow', () => {
        viewportCleanup = mockViewport(MOBILE_WIDTH);
        const item = readyItem({
            pr: {
                number: 101,
                title: 'Add PR status card',
                status: 'open',
                sourceBranch: 'feature/card',
                targetBranch: 'main',
                url: 'https://github.com/o/r/pull/101',
                autoMerge: { enabled: true, state: 'armed', mergeMethod: 'squash', enabledBy: { displayName: 'Carol' } },
            },
        });
        const { getByTestId } = render(<PrStatusCard items={[item]} />);
        fireEvent.click(getByTestId('pr-status-card-toggle'));

        const badge = getByTestId(`pr-status-card-automerge-${item.key}`);
        expect(badge.textContent).toContain('Auto-merge armed');
        // The badge does not stretch the row: it is shrink-0 inside a flex-wrap meta line.
        expect(badge.className).toContain('shrink-0');
        expect(badge.parentElement!.className).toContain('flex-wrap');
    });

    it('multiple PRs collapse to a count and expand on tap at 375px', () => {
        viewportCleanup = mockViewport(MOBILE_WIDTH);
        const items = [1, 2, 3].map(n => readyItem({
            key: `o:${n}`,
            number: n,
            pr: { number: n, title: `PR ${n}`, status: 'open', sourceBranch: `b${n}`, targetBranch: 'main' },
        }));
        const { getByTestId, queryByTestId } = render(<PrStatusCard items={items} />);

        const toggle = getByTestId('pr-status-card-toggle');
        expect(toggle.textContent).toContain('3 pull requests');
        // Collapsed by default on mobile → rows hidden.
        expect(queryByTestId('pr-status-card-row-o:1')).toBeNull();

        fireEvent.click(toggle);
        expect(getByTestId('pr-status-card-row-o:1')).toBeTruthy();
    });
});
